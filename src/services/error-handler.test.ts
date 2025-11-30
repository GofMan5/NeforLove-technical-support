/**
 * Property-based tests for Error Handler
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ErrorHandlerImpl,
  createErrorHandler,
  validateErrorLogEntry,
  type ErrorContext,
  type ErrorLogEntry,
} from './error-handler.js';
import { createLogger, type LogEntry } from '../core/logger.js';

// Arbitrary for generating error messages
const errorMessageArbitrary = fc.string({ minLength: 1, maxLength: 200 });

// Arbitrary for generating user IDs (positive integers)
const userIdArbitrary = fc.integer({ min: 1, max: 2147483647 });

// Arbitrary for generating chat IDs (can be negative for groups)
const chatIdArbitrary = fc.integer({ min: -2147483647, max: 2147483647 });

// Arbitrary for generating error context
const errorContextArbitrary = fc.record({
  userId: userIdArbitrary,
  chatId: chatIdArbitrary,
});

describe('Error Handler Property Tests', () => {
  describe('Error Logging Completeness', () => {
    it('should log error with all required context fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorMessageArbitrary,
          errorContextArbitrary,
          async (errorMessage, ctx) => {
            const loggedEntries: LogEntry[] = [];
            const captureOutput = (entry: LogEntry) => {
              loggedEntries.push(entry);
            };

            const logger = createLogger('debug', captureOutput);
            const errorHandler = new ErrorHandlerImpl(logger);

            const error = new Error(errorMessage);
            await errorHandler.handle(error, ctx);

            // Verify error was logged
            expect(loggedEntries.length).toBeGreaterThanOrEqual(1);

            // Get the last logged error entry
            const lastEntry = errorHandler.getLastLoggedError();
            expect(lastEntry).not.toBeNull();

            // Validate completeness using helper
            const validation = validateErrorLogEntry(lastEntry);
            
            expect(validation.hasErrorMessage).toBe(true);
            expect(lastEntry!.errorMessage).toBe(errorMessage);

            expect(validation.hasStackTrace).toBe(true);

            expect(validation.hasUserId).toBe(true);
            expect(lastEntry!.userId).toBe(ctx.userId);

            expect(validation.hasChatId).toBe(true);
            expect(lastEntry!.chatId).toBe(ctx.chatId);

            // Overall completeness check
            expect(validation.isComplete).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include error message and stack trace in log output', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorMessageArbitrary,
          errorContextArbitrary,
          async (errorMessage, ctx) => {
            const loggedEntries: LogEntry[] = [];
            const captureOutput = (entry: LogEntry) => {
              loggedEntries.push(entry);
            };

            const logger = createLogger('debug', captureOutput);
            const errorHandler = new ErrorHandlerImpl(logger);

            const error = new Error(errorMessage);
            await errorHandler.handle(error, ctx);

            // Find the error log entry
            const errorEntry = loggedEntries.find(e => e.level === 'error');
            expect(errorEntry).toBeDefined();

            // Verify context contains error details
            expect(errorEntry!.context).toBeDefined();
            expect(errorEntry!.context!.errorMessage).toBe(errorMessage);
            expect(errorEntry!.context!.errorStack).toBeDefined();

            // Verify context contains user and chat IDs
            expect(errorEntry!.context!.userId).toBe(ctx.userId);
            expect(errorEntry!.context!.chatId).toBe(ctx.chatId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve error message exactly as provided', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorMessageArbitrary,
          userIdArbitrary,
          chatIdArbitrary,
          async (errorMessage, userId, chatId) => {
            const errorHandler = createErrorHandler();
            const error = new Error(errorMessage);

            await errorHandler.handle(error, { userId, chatId });

            const lastEntry = errorHandler.getLastLoggedError();
            expect(lastEntry).not.toBeNull();
            expect(lastEntry!.errorMessage).toBe(errorMessage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should record timestamp for each error', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorMessageArbitrary,
          errorContextArbitrary,
          async (errorMessage, ctx) => {
            const beforeTime = new Date();
            
            const errorHandler = createErrorHandler();
            const error = new Error(errorMessage);
            await errorHandler.handle(error, ctx);

            const afterTime = new Date();
            const lastEntry = errorHandler.getLastLoggedError();

            expect(lastEntry).not.toBeNull();
            expect(lastEntry!.timestamp).toBeInstanceOf(Date);
            expect(lastEntry!.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            expect(lastEntry!.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Error Handler Callbacks', () => {
    it('should notify all registered callbacks on error', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorMessageArbitrary,
          errorContextArbitrary,
          fc.integer({ min: 1, max: 5 }),
          async (errorMessage, ctx, callbackCount) => {
            const errorHandler = createErrorHandler();
            const callbackResults: Array<{ error: Error; ctx: ErrorContext }> = [];

            // Register multiple callbacks
            for (let i = 0; i < callbackCount; i++) {
              errorHandler.onError((error, context) => {
                callbackResults.push({ error, ctx: context });
              });
            }

            const error = new Error(errorMessage);
            await errorHandler.handle(error, ctx);

            // All callbacks should have been called
            expect(callbackResults.length).toBe(callbackCount);

            // Each callback should receive the same error and context
            for (const result of callbackResults) {
              expect(result.error.message).toBe(errorMessage);
              expect(result.ctx.userId).toBe(ctx.userId);
              expect(result.ctx.chatId).toBe(ctx.chatId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should continue processing even if a callback throws', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorMessageArbitrary,
          errorContextArbitrary,
          async (errorMessage, ctx) => {
            const loggedEntries: LogEntry[] = [];
            const captureOutput = (entry: LogEntry) => {
              loggedEntries.push(entry);
            };

            const logger = createLogger('debug', captureOutput);
            const errorHandler = new ErrorHandlerImpl(logger);

            let secondCallbackCalled = false;

            // First callback throws
            errorHandler.onError(() => {
              throw new Error('Callback error');
            });

            // Second callback should still be called
            errorHandler.onError(() => {
              secondCallbackCalled = true;
            });

            const error = new Error(errorMessage);
            await errorHandler.handle(error, ctx);

            expect(secondCallbackCalled).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('User Message Configuration', () => {
    it('should allow setting and getting user message', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }),
          (customMessage) => {
            const errorHandler = createErrorHandler();
            
            // Default message should be set
            const defaultMessage = errorHandler.getUserMessage();
            expect(defaultMessage).toBe('Произошла ошибка. Попробуйте позже.');

            // Set custom message
            errorHandler.setUserMessage(customMessage);
            expect(errorHandler.getUserMessage()).toBe(customMessage);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('validateErrorLogEntry helper', () => {
    it('should correctly validate complete entries', () => {
      fc.assert(
        fc.property(
          errorMessageArbitrary,
          userIdArbitrary,
          chatIdArbitrary,
          (errorMessage, userId, chatId) => {
            const entry: ErrorLogEntry = {
              errorMessage,
              stackTrace: 'Error: test\n    at test.ts:1:1',
              userId,
              chatId,
              timestamp: new Date(),
            };

            const validation = validateErrorLogEntry(entry);
            expect(validation.isComplete).toBe(true);
            expect(validation.hasErrorMessage).toBe(true);
            expect(validation.hasStackTrace).toBe(true);
            expect(validation.hasUserId).toBe(true);
            expect(validation.hasChatId).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return false for null entries', () => {
      const validation = validateErrorLogEntry(null);
      expect(validation.isComplete).toBe(false);
      expect(validation.hasErrorMessage).toBe(false);
      expect(validation.hasStackTrace).toBe(false);
      expect(validation.hasUserId).toBe(false);
      expect(validation.hasChatId).toBe(false);
    });

    it('should detect missing fields', () => {
      fc.assert(
        fc.property(
          errorMessageArbitrary,
          (errorMessage) => {
            // Entry with missing userId and chatId
            const entry: ErrorLogEntry = {
              errorMessage,
              stackTrace: 'Error: test',
              userId: undefined,
              chatId: undefined,
              timestamp: new Date(),
            };

            const validation = validateErrorLogEntry(entry);
            expect(validation.hasErrorMessage).toBe(true);
            expect(validation.hasStackTrace).toBe(true);
            expect(validation.hasUserId).toBe(false);
            expect(validation.hasChatId).toBe(false);
            expect(validation.isComplete).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
