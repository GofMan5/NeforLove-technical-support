/**
 * Property-based tests for Config System
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  loadConfigFromEnv,
  validateConfig,
  ConfigurationError,
  type BotConfig,
  type LogLevel,
} from './config.js';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

// Arbitrary for generating valid environment variables
const validEnvArbitrary = fc.record({
  BOT_TOKEN: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
  ADMIN_IDS: fc.array(fc.integer({ min: 1, max: 999999999 }), { minLength: 0, maxLength: 5 })
    .map(ids => ids.join(',')),
  DATABASE_PATH: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
  LOG_LEVEL: fc.constantFrom(...LOG_LEVELS),
  DEFAULT_LOCALE: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'n', 'r', 'u', '-', '_'), { minLength: 2, maxLength: 5 })
    .filter(s => s.trim().length > 0),
  LOCALES_PATH: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
  SUPPORT_GROUP_ID: fc.integer({ min: -9999999999999, max: -1 }).map(id => String(id)),
});

// Arbitrary for generating valid BotConfig objects
const validConfigArbitrary = fc.record({
  bot: fc.record({
    token: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
    adminIds: fc.array(fc.integer({ min: 1, max: 999999999 }), { minLength: 0, maxLength: 5 }),
    supportGroupId: fc.integer({ min: -9999999999999, max: -1 }),
  }),
  database: fc.record({
    path: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
  }),
  logging: fc.record({
    level: fc.constantFrom<LogLevel>(...LOG_LEVELS),
  }),
  i18n: fc.record({
    defaultLocale: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'n', 'r', 'u', '-', '_'), { minLength: 2, maxLength: 5 })
      .filter(s => s.trim().length > 0),
    localesPath: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
  }),
});


describe('Config System Property Tests', () => {
  describe('Config Loading Completeness', () => {
    it('should correctly map all environment variables to config object', () => {
      fc.assert(
        fc.property(validEnvArbitrary, (env) => {
          const config = loadConfigFromEnv(env);

          // Verify bot section
          expect(config.bot.token).toBe(env.BOT_TOKEN.trim());
          
          const expectedAdminIds = env.ADMIN_IDS === '' 
            ? [] 
            : env.ADMIN_IDS.split(',').map(id => parseInt(id.trim(), 10));
          expect(config.bot.adminIds).toEqual(expectedAdminIds);
          expect(config.bot.supportGroupId).toBe(parseInt(env.SUPPORT_GROUP_ID, 10));

          // Verify database section
          expect(config.database.path).toBe(env.DATABASE_PATH.trim());

          // Verify logging section
          expect(config.logging.level).toBe(env.LOG_LEVEL);

          // Verify i18n section
          expect(config.i18n.defaultLocale).toBe(env.DEFAULT_LOCALE.trim());
          expect(config.i18n.localesPath).toBe(env.LOCALES_PATH.trim());
        }),
        { numRuns: 100 }
      );
    });

    it('should produce a valid BotConfig structure', () => {
      fc.assert(
        fc.property(validEnvArbitrary, (env) => {
          const config = loadConfigFromEnv(env);

          // Verify structure exists
          expect(config).toHaveProperty('bot');
          expect(config).toHaveProperty('database');
          expect(config).toHaveProperty('logging');
          expect(config).toHaveProperty('i18n');

          // Verify types
          expect(typeof config.bot.token).toBe('string');
          expect(Array.isArray(config.bot.adminIds)).toBe(true);
          expect(typeof config.bot.supportGroupId).toBe('number');
          expect(typeof config.database.path).toBe('string');
          expect(LOG_LEVELS).toContain(config.logging.level);
          expect(typeof config.i18n.defaultLocale).toBe('string');
          expect(typeof config.i18n.localesPath).toBe('string');
        }),
        { numRuns: 100 }
      );
    });
  });


  describe('Config Validation Strictness', () => {
    it('should accept all valid config objects', () => {
      fc.assert(
        fc.property(validConfigArbitrary, (config) => {
          expect(() => validateConfig(config)).not.toThrow();
          expect(validateConfig(config)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with missing bot section', () => {
      fc.assert(
        fc.property(validConfigArbitrary, (config) => {
          const invalidConfig = { ...config };
          delete (invalidConfig as Record<string, unknown>).bot;
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
          expect(() => validateConfig(invalidConfig)).toThrow(/bot/i);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with missing database section', () => {
      fc.assert(
        fc.property(validConfigArbitrary, (config) => {
          const invalidConfig = { ...config };
          delete (invalidConfig as Record<string, unknown>).database;
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
          expect(() => validateConfig(invalidConfig)).toThrow(/database/i);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with missing logging section', () => {
      fc.assert(
        fc.property(validConfigArbitrary, (config) => {
          const invalidConfig = { ...config };
          delete (invalidConfig as Record<string, unknown>).logging;
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
          expect(() => validateConfig(invalidConfig)).toThrow(/logging/i);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with missing i18n section', () => {
      fc.assert(
        fc.property(validConfigArbitrary, (config) => {
          const invalidConfig = { ...config };
          delete (invalidConfig as Record<string, unknown>).i18n;
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
          expect(() => validateConfig(invalidConfig)).toThrow(/i18n/i);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with invalid log level', () => {
      const invalidLogLevels = fc.string().filter(s => !LOG_LEVELS.includes(s as LogLevel));
      
      fc.assert(
        fc.property(validConfigArbitrary, invalidLogLevels, (config, invalidLevel) => {
          const invalidConfig = {
            ...config,
            logging: { level: invalidLevel },
          };
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with empty token', () => {
      fc.assert(
        fc.property(validConfigArbitrary, (config) => {
          const invalidConfig = {
            ...config,
            bot: { ...config.bot, token: '' },
          };
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
          expect(() => validateConfig(invalidConfig)).toThrow(/token/i);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with non-integer admin IDs', () => {
      fc.assert(
        fc.property(validConfigArbitrary, fc.string({ minLength: 1 }), (config, invalidId) => {
          const invalidConfig = {
            ...config,
            bot: { ...config.bot, adminIds: [invalidId] },
          };
          
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject non-object configs', () => {
      const nonObjects = fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.array(fc.anything())
      );

      fc.assert(
        fc.property(nonObjects, (invalidConfig) => {
          expect(() => validateConfig(invalidConfig)).toThrow(ConfigurationError);
        }),
        { numRuns: 100 }
      );
    });
  });
});
