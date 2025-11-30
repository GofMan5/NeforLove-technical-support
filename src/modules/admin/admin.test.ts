/**
 * Property-based tests for Admin Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from '../../database';
import { createAuditLogger, type AuditLogger, type AuditAction } from '../../services/audit-logger';
import * as fs from 'fs';
import * as path from 'path';

// Test database path
const TEST_DB_PATH = './data/test-admin-module.sqlite';

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

// User status change actions
const userStatusChangeActions: AuditAction[] = [
  'user_banned',
  'user_unbanned',
  'role_granted',
  'role_revoked',
];

// Arbitrary for generating valid user status change actions
const userStatusChangeActionArbitrary = fc.constantFrom(...userStatusChangeActions);

// Arbitrary for generating valid Telegram user IDs
const telegramIdArbitrary = fc.integer({ min: 1, max: 2000000000 });

// Arbitrary for generating role metadata
const roleMetadataArbitrary = fc.record({
  oldRole: fc.constantFrom('user', 'support', 'owner'),
  newRole: fc.constantFrom('user', 'support', 'owner'),
});

describe('Admin Module Property Tests', () => {
  let dbConnection: DatabaseConnection;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    ensureDataDir();
    cleanupTestDb();
    dbConnection = createDatabase(TEST_DB_PATH);
    dbConnection.migrate();
    auditLogger = createAuditLogger(dbConnection.db);
  });

  afterEach(() => {
    dbConnection.close();
    cleanupTestDb();
  });

  describe('User Status Change Notification Completeness', () => {
    it('should log all required fields for any user status change action', async () => {
      await fc.assert(
        fc.asyncProperty(
          userStatusChangeActionArbitrary,
          telegramIdArbitrary,
          telegramIdArbitrary,
          roleMetadataArbitrary,
          async (action, actorId, targetId, roleMetadata) => {
            // For role changes, include metadata; for ban/unban, no metadata needed
            const isRoleChange = action === 'role_granted' || action === 'role_revoked';
            const metadata = isRoleChange ? roleMetadata : undefined;

            // Log the user status change action
            const entry = await auditLogger.log({
              action,
              actorId,
              targetId,
              entityType: 'user',
              metadata,
            });

            // Verify all required fields for notification are present
            // actorId is required for confirmation to the actor
            expect(entry.actorId).toBe(actorId);
            expect(entry.actorId).toBeGreaterThan(0);

            // targetId is required for notification to the affected user
            expect(entry.targetId).toBe(targetId);
            expect(entry.targetId).toBeGreaterThan(0);

            // action is required to determine notification content
            expect(entry.action).toBe(action);
            expect(userStatusChangeActions).toContain(entry.action);

            // timestamp is required for audit trail
            expect(entry.createdAt).toBeInstanceOf(Date);

            // entityType should be 'user' for user status changes
            expect(entry.entityType).toBe('user');

            // For role changes, metadata should contain role information
            if (isRoleChange) {
              expect(entry.metadata).toBeDefined();
              expect(entry.metadata).toHaveProperty('oldRole');
              expect(entry.metadata).toHaveProperty('newRole');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow retrieval of user status changes by target for notification', async () => {
      await fc.assert(
        fc.asyncProperty(
          userStatusChangeActionArbitrary,
          telegramIdArbitrary,
          telegramIdArbitrary,
          async (action, actorId, targetId) => {
            // Log the action
            const logged = await auditLogger.log({
              action,
              actorId,
              targetId,
              entityType: 'user',
            });

            // Should be retrievable by target (for user notification lookup)
            const byTarget = await auditLogger.getByTarget(targetId);
            const found = byTarget.find(e => e.id === logged.id);

            expect(found).toBeDefined();
            expect(found?.targetId).toBe(targetId);
            expect(found?.action).toBe(action);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow retrieval of user status changes by actor for confirmation', async () => {
      await fc.assert(
        fc.asyncProperty(
          userStatusChangeActionArbitrary,
          telegramIdArbitrary,
          telegramIdArbitrary,
          async (action, actorId, targetId) => {
            // Log the action
            const logged = await auditLogger.log({
              action,
              actorId,
              targetId,
              entityType: 'user',
            });

            // Should be retrievable by actor (for actor confirmation lookup)
            const byActor = await auditLogger.getByActor(actorId);
            const found = byActor.find(e => e.id === logged.id);

            expect(found).toBeDefined();
            expect(found?.actorId).toBe(actorId);
            expect(found?.action).toBe(action);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
