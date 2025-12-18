/**
 * Property-based tests for Session Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from '../database';
import { createSessionManager, type SessionManager } from './session';
import * as fs from 'fs';
import * as path from 'path';

// Test database path
const TEST_DB_PATH = './data/test-session.sqlite';

// Ensure data directory exists
function ensureDataDir() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Clean up test database
function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

// Arbitrary for generating valid user IDs (Telegram user IDs)
const userIdArbitrary = fc.integer({ min: 1, max: 2000000000 });

// Arbitrary for generating valid chat IDs
const chatIdArbitrary = fc.integer({ min: 1, max: 999999999 });

// Arbitrary for generating valid session state data
const sessionStateArbitrary = fc.dictionary(
  fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,19}$/),
  fc.oneof(
    fc.string({ maxLength: 100 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null)
  ),
  { minKeys: 0, maxKeys: 5 }
);

// Arbitrary for generating valid locale strings
const localeArbitrary = fc.stringMatching(/^[a-z]{2}$/);

describe('Session Manager Property Tests', () => {
  let dbConnection: DatabaseConnection;
  let sessionManager: SessionManager;


  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    dbConnection = createDatabase(TEST_DB_PATH);
    dbConnection.migrate();
    sessionManager = createSessionManager(dbConnection.db);
  });

  afterEach(() => {
    dbConnection.close();
    cleanupTestDb();
  });

  describe('Session Persistence Round-Trip', () => {
    it('should round-trip session state data correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArbitrary,
          chatIdArbitrary,
          sessionStateArbitrary,
          async (userId, chatId, state) => {
            // Set session with state data
            await sessionManager.set(userId, chatId, { state });

            // Get session back
            const retrieved = await sessionManager.get(userId, chatId);

            // Verify state data round-trip
            expect(retrieved.userId).toBe(userId);
            expect(retrieved.chatId).toBe(chatId);
            expect(retrieved.state).toEqual(state);

            // Cleanup for next iteration
            await sessionManager.delete(userId, chatId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip session locale correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArbitrary,
          chatIdArbitrary,
          localeArbitrary,
          async (userId, chatId, locale) => {
            // Set session with locale
            await sessionManager.set(userId, chatId, { locale });

            // Get session back
            const retrieved = await sessionManager.get(userId, chatId);

            // Verify locale round-trip
            expect(retrieved.userId).toBe(userId);
            expect(retrieved.chatId).toBe(chatId);
            expect(retrieved.locale).toBe(locale);

            // Cleanup for next iteration
            await sessionManager.delete(userId, chatId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should create new session on first get', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArbitrary,
          chatIdArbitrary,
          async (userId, chatId) => {
            // Get session (should create new one)
            const session = await sessionManager.get(userId, chatId);

            // Verify session was created with defaults
            expect(session.userId).toBe(userId);
            expect(session.chatId).toBe(chatId);
            expect(session.locale).toBe(''); // Empty string means locale not explicitly set
            expect(session.state).toEqual({});
            expect(session.expiresAt).toBeDefined();

            // Cleanup for next iteration
            await sessionManager.delete(userId, chatId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Session Expiration Cleanup', () => {
    it('should cleanup expired sessions', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArbitrary,
          chatIdArbitrary,
          sessionStateArbitrary,
          async (userId, chatId, state) => {
            // Create session with past expiration (already expired)
            const pastDate = new Date(Date.now() - 1000); // 1 second ago
            
            await sessionManager.set(userId, chatId, {
              state,
              expiresAt: pastDate,
            });

            // Run cleanup
            const cleanedCount = await sessionManager.cleanup();

            // Verify session was cleaned up
            expect(cleanedCount).toBeGreaterThanOrEqual(1);

            // Getting session should create a new one (old one was deleted)
            const newSession = await sessionManager.get(userId, chatId);
            expect(newSession.state).toEqual({}); // New session has empty state

            // Cleanup for next iteration
            await sessionManager.delete(userId, chatId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not cleanup non-expired sessions', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArbitrary,
          chatIdArbitrary,
          sessionStateArbitrary,
          async (userId, chatId, state) => {
            // Create session with future expiration
            const futureDate = new Date(Date.now() + 60000); // 1 minute from now
            
            await sessionManager.set(userId, chatId, {
              state,
              expiresAt: futureDate,
            });

            // Run cleanup
            await sessionManager.cleanup();

            // Verify session still exists with original state
            const retrieved = await sessionManager.get(userId, chatId);
            expect(retrieved.state).toEqual(state);

            // Cleanup for next iteration
            await sessionManager.delete(userId, chatId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
