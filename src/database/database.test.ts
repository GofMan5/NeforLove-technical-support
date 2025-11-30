/**
 * Property-based tests for Database Layer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { eq } from 'drizzle-orm';
import { createDatabase, users, sessions, type DatabaseConnection } from './index';
import * as fs from 'fs';
import * as path from 'path';

// Test database path
const TEST_DB_PATH = './data/test-db.sqlite';

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

// Arbitrary for generating valid user data with unique telegramId using UUID-based approach
const validUserArbitrary = fc.record({
  telegramId: fc.integer({ min: 1, max: 2000000000 }),
  username: fc.option(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/),
    { nil: undefined }
  ),
  locale: fc.stringMatching(/^[a-z]{2,5}$/),
});

// Arbitrary for generating valid session data
const validSessionDataArbitrary = fc.dictionary(
  fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,19}$/),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null)
  ),
  { minKeys: 0, maxKeys: 5 }
);

describe('Database Property Tests', () => {
  let dbConnection: DatabaseConnection;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    dbConnection = createDatabase(TEST_DB_PATH);
    dbConnection.migrate();
  });

  afterEach(() => {
    dbConnection.close();
    cleanupTestDb();
  });

  describe('Database Round-Trip', () => {
    it('should round-trip user data correctly', () => {
      fc.assert(
        fc.property(validUserArbitrary, (userData) => {
          const { db } = dbConnection;
          const createdAt = new Date();

          // Clean any existing user with same telegramId first
          db.delete(users).where(eq(users.telegramId, userData.telegramId)).run();

          // Insert user
          db.insert(users).values({
            telegramId: userData.telegramId,
            username: userData.username ?? null,
            locale: userData.locale,
            createdAt,
          }).run();

          // Retrieve user
          const retrieved = db.select().from(users)
            .where(eq(users.telegramId, userData.telegramId))
            .get();

          // Verify round-trip
          expect(retrieved).toBeDefined();
          expect(retrieved!.telegramId).toBe(userData.telegramId);
          expect(retrieved!.username).toBe(userData.username ?? null);
          expect(retrieved!.locale).toBe(userData.locale);
          // Compare timestamps at second precision (SQLite stores as integer seconds)
          expect(Math.floor(retrieved!.createdAt.getTime() / 1000))
            .toBe(Math.floor(createdAt.getTime() / 1000));

          // Cleanup for next iteration
          db.delete(users).where(eq(users.telegramId, userData.telegramId)).run();
        }),
        { numRuns: 100 }
      );
    });

    it('should round-trip session data correctly', () => {
      fc.assert(
        fc.property(
          validUserArbitrary,
          fc.integer({ min: 1, max: 999999999 }),
          validSessionDataArbitrary,
          (userData, chatId, sessionData) => {
            const { db } = dbConnection;
            const createdAt = new Date();

            // Clean any existing user with same telegramId first
            const existingUser = db.select().from(users)
              .where(eq(users.telegramId, userData.telegramId))
              .get();
            if (existingUser) {
              db.delete(sessions).where(eq(sessions.userId, existingUser.id)).run();
              db.delete(users).where(eq(users.telegramId, userData.telegramId)).run();
            }

            // Create a user
            db.insert(users).values({
              telegramId: userData.telegramId,
              username: userData.username ?? null,
              locale: userData.locale,
              createdAt,
            }).run();

            const user = db.select().from(users)
              .where(eq(users.telegramId, userData.telegramId))
              .get();

            // Insert session
            db.insert(sessions).values({
              userId: user!.id,
              chatId,
              data: sessionData,
              expiresAt: null,
            }).run();

            // Retrieve session
            const retrieved = db.select().from(sessions)
              .where(eq(sessions.userId, user!.id))
              .get();

            // Verify round-trip
            expect(retrieved).toBeDefined();
            expect(retrieved!.userId).toBe(user!.id);
            expect(retrieved!.chatId).toBe(chatId);
            expect(retrieved!.data).toEqual(sessionData);

            // Cleanup for next iteration
            db.delete(sessions).where(eq(sessions.userId, user!.id)).run();
            db.delete(users).where(eq(users.telegramId, userData.telegramId)).run();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve session expiration timestamps', () => {
      fc.assert(
        fc.property(
          validUserArbitrary,
          fc.integer({ min: 1, max: 999999999 }),
          fc.date({ min: new Date('2024-01-01'), max: new Date('2030-12-31') }),
          (userData, chatId, expiresAt) => {
            const { db } = dbConnection;
            const createdAt = new Date();

            // Clean any existing user with same telegramId first
            const existingUser = db.select().from(users)
              .where(eq(users.telegramId, userData.telegramId))
              .get();
            if (existingUser) {
              db.delete(sessions).where(eq(sessions.userId, existingUser.id)).run();
              db.delete(users).where(eq(users.telegramId, userData.telegramId)).run();
            }

            // Create user
            db.insert(users).values({
              telegramId: userData.telegramId,
              username: userData.username ?? null,
              locale: userData.locale,
              createdAt,
            }).run();

            const user = db.select().from(users)
              .where(eq(users.telegramId, userData.telegramId))
              .get();

            // Insert session with expiration
            db.insert(sessions).values({
              userId: user!.id,
              chatId,
              data: {},
              expiresAt,
            }).run();

            // Retrieve session
            const retrieved = db.select().from(sessions)
              .where(eq(sessions.userId, user!.id))
              .get();

            // Verify expiration timestamp round-trip
            expect(retrieved).toBeDefined();
            expect(retrieved!.expiresAt).toBeDefined();
            // Compare timestamps (truncated to seconds due to SQLite storage)
            expect(Math.floor(retrieved!.expiresAt!.getTime() / 1000))
              .toBe(Math.floor(expiresAt.getTime() / 1000));

            // Cleanup
            db.delete(sessions).where(eq(sessions.userId, user!.id)).run();
            db.delete(users).where(eq(users.telegramId, userData.telegramId)).run();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
