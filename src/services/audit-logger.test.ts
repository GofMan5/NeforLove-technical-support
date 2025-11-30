/**
 * Property-based and unit tests for Audit Logger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from '../database';
import { createAuditLogger, type AuditLogger, type AuditAction, type AuditEntityType } from './audit-logger';
import * as fs from 'fs';
import * as path from 'path';

// Test database path
const TEST_DB_PATH = './data/test-audit-logger.sqlite';

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

// All valid audit actions
const auditActions: AuditAction[] = [
  'ticket_created',
  'ticket_closed_by_user',
  'ticket_closed_by_admin',
  'user_banned',
  'user_unbanned',
  'role_granted',
  'role_revoked',
  'message_sent',
  'message_delivery_failed',
];

// All valid entity types
const entityTypes: AuditEntityType[] = ['ticket', 'user', 'message'];

// Arbitrary for generating valid audit actions
const auditActionArbitrary = fc.constantFrom(...auditActions);

// Arbitrary for generating valid entity types
const entityTypeArbitrary = fc.constantFrom(...entityTypes);

// Arbitrary for generating valid Telegram user IDs
const telegramIdArbitrary = fc.integer({ min: 1, max: 2000000000 });

// Arbitrary for generating valid entity IDs
const entityIdArbitrary = fc.integer({ min: 1, max: 999999999 });

// Arbitrary for generating metadata
const metadataArbitrary = fc.option(
  fc.dictionary(
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,19}$/),
    fc.oneof(
      fc.string({ maxLength: 100 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null)
    ),
    { minKeys: 0, maxKeys: 5 }
  ),
  { nil: undefined }
);

describe('Audit Logger Property Tests', () => {
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

  describe('Audit Log Completeness', () => {
    it('should log all required fields for any admin action', async () => {
      await fc.assert(
        fc.asyncProperty(
          auditActionArbitrary,
          telegramIdArbitrary,
          fc.option(telegramIdArbitrary, { nil: undefined }),
          entityTypeArbitrary,
          fc.option(entityIdArbitrary, { nil: undefined }),
          metadataArbitrary,
          async (action, actorId, targetId, entityType, entityId, metadata) => {
            // Log the action
            const entry = await auditLogger.log({
              action,
              actorId,
              targetId,
              entityType,
              entityId,
              metadata,
            });

            // Verify all required fields are present
            expect(entry.id).toBeGreaterThan(0);
            expect(entry.action).toBe(action);
            expect(entry.actorId).toBe(actorId);
            expect(entry.entityType).toBe(entityType);
            expect(entry.createdAt).toBeInstanceOf(Date);

            // Verify optional fields
            if (targetId !== undefined) {
              expect(entry.targetId).toBe(targetId);
            }
            if (entityId !== undefined) {
              expect(entry.entityId).toBe(entityId);
            }
            if (metadata !== undefined) {
              expect(entry.metadata).toEqual(metadata);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should persist and retrieve audit logs correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          auditActionArbitrary,
          telegramIdArbitrary,
          telegramIdArbitrary,
          entityTypeArbitrary,
          async (action, actorId, targetId, entityType) => {
            // Log the action
            const logged = await auditLogger.log({
              action,
              actorId,
              targetId,
              entityType,
            });

            // Retrieve by actor
            const byActor = await auditLogger.getByActor(actorId);
            const foundByActor = byActor.find(e => e.id === logged.id);
            expect(foundByActor).toBeDefined();
            expect(foundByActor?.action).toBe(action);
            expect(foundByActor?.actorId).toBe(actorId);

            // Retrieve by target
            const byTarget = await auditLogger.getByTarget(targetId);
            const foundByTarget = byTarget.find(e => e.id === logged.id);
            expect(foundByTarget).toBeDefined();
            expect(foundByTarget?.targetId).toBe(targetId);

            // Retrieve by action
            const byAction = await auditLogger.getByAction(action);
            const foundByAction = byAction.find(e => e.id === logged.id);
            expect(foundByAction).toBeDefined();
            expect(foundByAction?.action).toBe(action);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


describe('Audit Logger Unit Tests', () => {
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

  describe('log()', () => {
    it('should create an audit log entry with all fields', async () => {
      const entry = await auditLogger.log({
        action: 'ticket_created',
        actorId: 123456,
        targetId: 789012,
        entityType: 'ticket',
        entityId: 1,
        metadata: { subject: 'Test ticket' },
      });

      expect(entry.id).toBeGreaterThan(0);
      expect(entry.action).toBe('ticket_created');
      expect(entry.actorId).toBe(123456);
      expect(entry.targetId).toBe(789012);
      expect(entry.entityType).toBe('ticket');
      expect(entry.entityId).toBe(1);
      expect(entry.metadata).toEqual({ subject: 'Test ticket' });
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it('should create an audit log entry with minimal fields', async () => {
      const entry = await auditLogger.log({
        action: 'user_banned',
        actorId: 111111,
        entityType: 'user',
      });

      expect(entry.id).toBeGreaterThan(0);
      expect(entry.action).toBe('user_banned');
      expect(entry.actorId).toBe(111111);
      expect(entry.targetId).toBeNull();
      expect(entry.entityType).toBe('user');
      expect(entry.entityId).toBeNull();
      expect(entry.metadata).toBeNull();
    });

    it('should create multiple entries with unique IDs', async () => {
      const entry1 = await auditLogger.log({
        action: 'role_granted',
        actorId: 100,
        entityType: 'user',
      });

      const entry2 = await auditLogger.log({
        action: 'role_revoked',
        actorId: 100,
        entityType: 'user',
      });

      expect(entry1.id).not.toBe(entry2.id);
    });
  });

  describe('getByActor()', () => {
    it('should return entries for a specific actor', async () => {
      const actorId = 555555;

      await auditLogger.log({ action: 'ticket_created', actorId, entityType: 'ticket' });
      await auditLogger.log({ action: 'ticket_closed_by_admin', actorId, entityType: 'ticket' });
      await auditLogger.log({ action: 'user_banned', actorId: 999999, entityType: 'user' });

      const entries = await auditLogger.getByActor(actorId);

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.actorId === actorId)).toBe(true);
    });

    it('should return empty array for non-existent actor', async () => {
      const entries = await auditLogger.getByActor(999999999);
      expect(entries).toHaveLength(0);
    });

    it('should respect limit parameter', async () => {
      const actorId = 666666;

      for (let i = 0; i < 5; i++) {
        await auditLogger.log({ action: 'message_sent', actorId, entityType: 'message' });
      }

      const entries = await auditLogger.getByActor(actorId, 3);
      expect(entries).toHaveLength(3);
    });

    it('should return entries ordered by createdAt descending', async () => {
      const actorId = 777777;

      await auditLogger.log({ action: 'ticket_created', actorId, entityType: 'ticket' });
      await auditLogger.log({ action: 'ticket_closed_by_user', actorId, entityType: 'ticket' });

      const entries = await auditLogger.getByActor(actorId);

      // Verify entries are ordered by createdAt descending (or same timestamp)
      expect(entries).toHaveLength(2);
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i].createdAt.getTime()).toBeGreaterThanOrEqual(entries[i + 1].createdAt.getTime());
      }
    });
  });

  describe('getByTarget()', () => {
    it('should return entries for a specific target', async () => {
      const targetId = 888888;

      await auditLogger.log({ action: 'user_banned', actorId: 100, targetId, entityType: 'user' });
      await auditLogger.log({ action: 'user_unbanned', actorId: 100, targetId, entityType: 'user' });
      await auditLogger.log({ action: 'user_banned', actorId: 100, targetId: 111111, entityType: 'user' });

      const entries = await auditLogger.getByTarget(targetId);

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.targetId === targetId)).toBe(true);
    });

    it('should return empty array for non-existent target', async () => {
      const entries = await auditLogger.getByTarget(999999999);
      expect(entries).toHaveLength(0);
    });
  });

  describe('getByAction()', () => {
    it('should return entries for a specific action type', async () => {
      await auditLogger.log({ action: 'user_banned', actorId: 100, entityType: 'user' });
      await auditLogger.log({ action: 'user_banned', actorId: 200, entityType: 'user' });
      await auditLogger.log({ action: 'user_unbanned', actorId: 100, entityType: 'user' });

      const entries = await auditLogger.getByAction('user_banned');

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.action === 'user_banned')).toBe(true);
    });

    it('should return empty array for action with no entries', async () => {
      const entries = await auditLogger.getByAction('message_delivery_failed');
      expect(entries).toHaveLength(0);
    });
  });
});
