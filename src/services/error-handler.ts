/**
 * Error Handler
 * Catches errors, logs with context, sends user-friendly messages
 */

import { Logger, createLogger } from '../core/logger.js';

/**
 * Minimal context interface for error handling
 * Contains user ID and chat ID for logging context
 */
export interface ErrorContext {
  userId?: number;
  chatId?: number;
}

/**
 * Error callback type for custom error handling
 */
export type ErrorCallback = (error: Error, ctx: ErrorContext) => void;

export interface ErrorHandler {
  handle(error: Error, ctx: ErrorContext): Promise<void>;
  setUserMessage(message: string): void;
  getUserMessage(): string;
  onError(callback: ErrorCallback): void;
  getLastLoggedError(): ErrorLogEntry | null;
}

export interface ErrorLogEntry {
  errorMessage: string;
  stackTrace: string | undefined;
  userId: number | undefined;
  chatId: number | undefined;
  timestamp: Date;
}

/**
 * Default user-friendly error message (in Russian as per design doc)
 */
const DEFAULT_USER_MESSAGE = 'Произошла ошибка. Попробуйте позже.';


/**
 * Error Handler implementation
 * Catches errors, logs with context, user-friendly messages
 */
export class ErrorHandlerImpl implements ErrorHandler {
  private logger: Logger;
  private userMessage: string;
  private callbacks: ErrorCallback[] = [];
  private lastLoggedError: ErrorLogEntry | null = null;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger('error');
    this.userMessage = DEFAULT_USER_MESSAGE;
  }

  /**
   * Handle an error by logging it with context and notifying callbacks
   */
  async handle(error: Error, ctx: ErrorContext): Promise<void> {
    // Create log entry with all required context
    const logEntry: ErrorLogEntry = {
      errorMessage: error.message,
      stackTrace: error.stack,
      userId: ctx.userId,
      chatId: ctx.chatId,
      timestamp: new Date(),
    };

    // Store for testing purposes
    this.lastLoggedError = logEntry;

    // Log the error with full context
    this.logger.error('Handler error occurred', error, {
      userId: ctx.userId,
      chatId: ctx.chatId,
    });

    // Notify all registered callbacks
    for (const callback of this.callbacks) {
      try {
        callback(error, ctx);
      } catch (callbackError) {
        // Don't let callback errors propagate
        this.logger.warn('Error callback threw an exception', {
          callbackError: callbackError instanceof Error ? callbackError.message : String(callbackError),
        });
      }
    }
  }

  /**
   * Set the user-friendly message to display when errors occur
   */
  setUserMessage(message: string): void {
    this.userMessage = message;
  }

  /**
   * Get the current user-friendly error message
   */
  getUserMessage(): string {
    return this.userMessage;
  }

  /**
   * Register a callback to be notified when errors occur
   */
  onError(callback: ErrorCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Get the last logged error entry (for testing)
   */
  getLastLoggedError(): ErrorLogEntry | null {
    return this.lastLoggedError;
  }
}

/**
 * Create a new error handler instance
 */
export function createErrorHandler(logger?: Logger): ErrorHandler {
  return new ErrorHandlerImpl(logger);
}

/**
 * Validates that an error log entry contains all required fields
 */
export function validateErrorLogEntry(entry: ErrorLogEntry | null): {
  hasErrorMessage: boolean;
  hasStackTrace: boolean;
  hasUserId: boolean;
  hasChatId: boolean;
  isComplete: boolean;
} {
  if (!entry) {
    return {
      hasErrorMessage: false,
      hasStackTrace: false,
      hasUserId: false,
      hasChatId: false,
      isComplete: false,
    };
  }

  const hasErrorMessage = typeof entry.errorMessage === 'string' && entry.errorMessage.length > 0;
  const hasStackTrace = entry.stackTrace !== undefined;
  const hasUserId = entry.userId !== undefined;
  const hasChatId = entry.chatId !== undefined;

  return {
    hasErrorMessage,
    hasStackTrace,
    hasUserId,
    hasChatId,
    isComplete: hasErrorMessage && hasStackTrace && hasUserId && hasChatId,
  };
}
