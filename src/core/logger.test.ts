/**
 * Property-based tests for Logger System
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  type LogLevel,
  type LogEntry,
  LoggerImpl,
  shouldLog,
  createLogger,
} from './logger.js';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Arbitrary for generating valid log levels
const logLevelArbitrary = fc.constantFrom<LogLevel>(...LOG_LEVELS);

// Arbitrary for generating log messages
const logMessageArbitrary = fc.string({ minLength: 1, maxLength: 200 });

// Arbitrary for generating context objects
const logContextArbitrary = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean())
  ),
  { nil: undefined }
);

describe('Logger System Property Tests', () => {
  describe('Log Level Filtering', () => {
    it('should output entries with level >= configured level', () => {
      fc.assert(
        fc.property(
          logLevelArbitrary,
          logLevelArbitrary,
          (configuredLevel, entryLevel) => {
            const result = shouldLog(entryLevel, configuredLevel);
            const expected = LOG_LEVEL_PRIORITY[entryLevel] >= LOG_LEVEL_PRIORITY[configuredLevel];
            
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should always output entries at or above configured level', () => {
      fc.assert(
        fc.property(logLevelArbitrary, (configuredLevel) => {
          const configuredPriority = LOG_LEVEL_PRIORITY[configuredLevel];
          
          for (const entryLevel of LOG_LEVELS) {
            const entryPriority = LOG_LEVEL_PRIORITY[entryLevel];
            const result = shouldLog(entryLevel, configuredLevel);
            
            if (entryPriority >= configuredPriority) {
              expect(result).toBe(true);
            } else {
              expect(result).toBe(false);
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should filter log entries correctly through logger instance', () => {
      fc.assert(
        fc.property(
          logLevelArbitrary,
          logMessageArbitrary,
          logContextArbitrary,
          (configuredLevel, message, context) => {
            const loggedEntries: LogEntry[] = [];
            const captureOutput = (entry: LogEntry) => {
              loggedEntries.push(entry);
            };

            const logger = createLogger(configuredLevel, captureOutput);

            // Log at all levels
            logger.debug(message, context);
            logger.info(message, context);
            logger.warn(message, context);
            logger.error(message, undefined, context);

            // Verify only entries at or above configured level were logged
            for (const entry of loggedEntries) {
              expect(LOG_LEVEL_PRIORITY[entry.level]).toBeGreaterThanOrEqual(
                LOG_LEVEL_PRIORITY[configuredLevel]
              );
            }

            // Verify correct number of entries
            const expectedCount = LOG_LEVELS.filter(
              level => LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel]
            ).length;
            expect(loggedEntries.length).toBe(expectedCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect level changes via setLevel', () => {
      fc.assert(
        fc.property(
          logLevelArbitrary,
          logLevelArbitrary,
          logMessageArbitrary,
          (initialLevel, newLevel, message) => {
            const loggedEntries: LogEntry[] = [];
            const captureOutput = (entry: LogEntry) => {
              loggedEntries.push(entry);
            };

            const logger = new LoggerImpl(initialLevel, captureOutput);
            
            // Verify initial level
            expect(logger.getLevel()).toBe(initialLevel);
            
            // Change level
            logger.setLevel(newLevel);
            expect(logger.getLevel()).toBe(newLevel);

            // Clear entries and log at all levels
            loggedEntries.length = 0;
            logger.debug(message);
            logger.info(message);
            logger.warn(message);
            logger.error(message);

            // Verify filtering based on new level
            for (const entry of loggedEntries) {
              expect(LOG_LEVEL_PRIORITY[entry.level]).toBeGreaterThanOrEqual(
                LOG_LEVEL_PRIORITY[newLevel]
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('debug level should output all entries', () => {
      fc.assert(
        fc.property(logMessageArbitrary, (message) => {
          const loggedEntries: LogEntry[] = [];
          const logger = createLogger('debug', (entry) => loggedEntries.push(entry));

          logger.debug(message);
          logger.info(message);
          logger.warn(message);
          logger.error(message);

          expect(loggedEntries.length).toBe(4);
          expect(loggedEntries.map(e => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
        }),
        { numRuns: 100 }
      );
    });

    it('error level should only output error entries', () => {
      fc.assert(
        fc.property(logMessageArbitrary, (message) => {
          const loggedEntries: LogEntry[] = [];
          const logger = createLogger('error', (entry) => loggedEntries.push(entry));

          logger.debug(message);
          logger.info(message);
          logger.warn(message);
          logger.error(message);

          expect(loggedEntries.length).toBe(1);
          expect(loggedEntries[0].level).toBe('error');
        }),
        { numRuns: 100 }
      );
    });
  });
});
