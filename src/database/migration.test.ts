/**
 * Property-based tests for Database Migrations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createDatabase, type DatabaseConnection } from './index';
import * as fs from 'fs';
import * as path from 'path';

// Interface for migration journal entry
interface MigrationJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

// Interface for migration journal
interface MigrationJournal {
  version: string;
  dialect: string;
  entries: MigrationJournalEntry[];
}

// Test database path
const TEST_DB_PATH = './data/test-migration.sqlite';

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

// Helper to get all table names from database
function getTableNames(db: DatabaseConnection): string[] {
  const result = db.sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as { name: string }[];
  return result.map(r => r.name);
}

// Helper to get table schema (columns and their types)
function getTableSchema(db: DatabaseConnection, tableName: string): string {
  const result = db.sqlite.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName) as { sql: string } | undefined;
  return result?.sql ?? '';
}

// Helper to get all indexes for a table
function getTableIndexes(db: DatabaseConnection, tableName: string): string[] {
  const result = db.sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? ORDER BY name`
  ).all(tableName) as { name: string }[];
  return result.map(r => r.name);
}

// Helper to get complete database state (tables, schemas, indexes)
function getDatabaseState(db: DatabaseConnection): {
  tables: string[];
  schemas: Record<string, string>;
  indexes: Record<string, string[]>;
} {
  const tables = getTableNames(db);
  const schemas: Record<string, string> = {};
  const indexes: Record<string, string[]> = {};
  
  for (const table of tables) {
    schemas[table] = getTableSchema(db, table);
    indexes[table] = getTableIndexes(db, table);
  }
  
  return { tables, schemas, indexes };
}

describe('Migration Property Tests', () => {
  describe('Migration Order Preservation', () => {
    beforeEach(() => {
      ensureDataDir();
      cleanupTestDb();
    });

    afterEach(() => {
      cleanupTestDb();
    });

    it('should apply migrations in ascending timestamp order', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Read the migration journal to get expected order
          const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
          const journal: MigrationJournal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
          
          // Get expected migration count from journal (sorted by timestamp/when)
          const expectedOrder = [...journal.entries]
            .sort((a, b) => a.when - b.when);
          
          // Create database and apply migrations
          const db = createDatabase(TEST_DB_PATH);
          db.migrate();
          
          // Get applied migrations from tracking table (ordered by created_at)
          const appliedMigrations = db.sqlite.prepare(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC"
          ).all() as { hash: string; created_at: number }[];
          
          db.close();
          
          // Verify migrations were applied in the expected order
          expect(appliedMigrations.length).toBe(expectedOrder.length);
          
          // Verify the order is preserved - created_at timestamps should be non-decreasing
          for (let i = 1; i < appliedMigrations.length; i++) {
            const currentMigration = appliedMigrations[i];
            const previousMigration = appliedMigrations[i - 1];
            
            // Ensure both migrations have valid hash values
            expect(currentMigration.hash).toBeDefined();
            expect(previousMigration.hash).toBeDefined();
            expect(typeof currentMigration.hash).toBe('string');
            expect(typeof previousMigration.hash).toBe('string');
            
            // created_at timestamps should be non-decreasing (order preserved)
            expect(currentMigration.created_at).toBeGreaterThanOrEqual(
              previousMigration.created_at
            );
          }
          
          // Verify each migration has a unique hash (no duplicates)
          const uniqueHashes = new Set(appliedMigrations.map(m => m.hash));
          expect(uniqueHashes.size).toBe(appliedMigrations.length);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve index ordering across multiple migrations', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Read the migration journal
          const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
          const journal: MigrationJournal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
          
          // Verify journal entries are ordered by idx
          const sortedByIdx = [...journal.entries].sort((a, b) => a.idx - b.idx);
          const sortedByWhen = [...journal.entries].sort((a, b) => a.when - b.when);
          
          // idx order should match timestamp order
          for (let i = 0; i < sortedByIdx.length; i++) {
            expect(sortedByIdx[i].tag).toBe(sortedByWhen[i].tag);
          }
          
          // Apply migrations and verify they're tracked in order
          const db = createDatabase(TEST_DB_PATH);
          db.migrate();
          
          const appliedMigrations = db.sqlite.prepare(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC"
          ).all() as { hash: string; created_at: number }[];
          
          db.close();
          
          // created_at timestamps should be non-decreasing (order preserved)
          for (let i = 1; i < appliedMigrations.length; i++) {
            const currentMigration = appliedMigrations[i];
            const previousMigration = appliedMigrations[i - 1];
            
            // Ensure both migrations have valid hash values
            expect(currentMigration.hash).toBeDefined();
            expect(previousMigration.hash).toBeDefined();
            expect(typeof currentMigration.hash).toBe('string');
            expect(typeof previousMigration.hash).toBe('string');
            
            // created_at timestamps should be non-decreasing (order preserved)
            expect(currentMigration.created_at).toBeGreaterThanOrEqual(
              previousMigration.created_at
            );
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Migration Idempotency', () => {
    beforeEach(() => {
      ensureDataDir();
      cleanupTestDb();
    });

    afterEach(() => {
      cleanupTestDb();
    });

    it('should produce same state when migrations applied twice', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Create fresh database and apply migrations once
          const db1 = createDatabase(TEST_DB_PATH);
          db1.migrate();
          const stateAfterFirst = getDatabaseState(db1);
          db1.close();
          
          // Apply migrations again on same database
          const db2 = createDatabase(TEST_DB_PATH);
          
          // This should not throw - migrations should be idempotent
          expect(() => db2.migrate()).not.toThrow();
          
          const stateAfterSecond = getDatabaseState(db2);
          db2.close();
          
          // States should be identical
          expect(stateAfterSecond.tables).toEqual(stateAfterFirst.tables);
          expect(stateAfterSecond.schemas).toEqual(stateAfterFirst.schemas);
          expect(stateAfterSecond.indexes).toEqual(stateAfterFirst.indexes);
        }),
        { numRuns: 100 }
      );
    });

    it('should not create duplicate migration records', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Create fresh database and apply migrations
          const db1 = createDatabase(TEST_DB_PATH);
          db1.migrate();
          
          // Get migration count after first apply
          const countAfterFirst = db1.sqlite.prepare(
            "SELECT COUNT(*) as count FROM __drizzle_migrations"
          ).get() as { count: number };
          db1.close();
          
          // Apply migrations again
          const db2 = createDatabase(TEST_DB_PATH);
          db2.migrate();
          
          // Get migration count after second apply
          const countAfterSecond = db2.sqlite.prepare(
            "SELECT COUNT(*) as count FROM __drizzle_migrations"
          ).get() as { count: number };
          db2.close();
          
          // Migration count should be the same (no duplicates)
          expect(countAfterSecond.count).toBe(countAfterFirst.count);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Migration Tracking Consistency', () => {
    beforeEach(() => {
      ensureDataDir();
      cleanupTestDb();
    });

    afterEach(() => {
      cleanupTestDb();
    });

    it('should have exactly one tracking record per migration', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Read the migration journal to get all migrations
          const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
          const journal: MigrationJournal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
          const expectedMigrationCount = journal.entries.length;
          
          // Create database and apply migrations
          const db = createDatabase(TEST_DB_PATH);
          db.migrate();
          
          // Get all tracking records
          const trackingRecords = db.sqlite.prepare(
            "SELECT hash, COUNT(*) as count FROM __drizzle_migrations GROUP BY hash"
          ).all() as { hash: string; count: number }[];
          
          db.close();
          
          // Total number of unique migrations should match journal entries
          expect(trackingRecords.length).toBe(expectedMigrationCount);
          
          // Each migration should have exactly one record (no duplicates)
          for (const record of trackingRecords) {
            expect(record.count).toBe(1);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should track all migrations from journal', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Read the migration journal
          const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
          const journal: MigrationJournal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
          const expectedMigrationCount = journal.entries.length;
          
          // Create database and apply migrations
          const db = createDatabase(TEST_DB_PATH);
          db.migrate();
          
          // Get all tracked migrations
          const trackedMigrations = db.sqlite.prepare(
            "SELECT hash FROM __drizzle_migrations"
          ).all() as { hash: string }[];
          
          db.close();
          
          // Every migration from journal should be tracked
          expect(trackedMigrations.length).toBe(expectedMigrationCount);
          
          // Each tracked migration should have a unique hash
          const uniqueHashes = new Set(trackedMigrations.map(m => m.hash));
          expect(uniqueHashes.size).toBe(expectedMigrationCount);
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain tracking consistency across restarts', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Read the migration journal
          const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
          const journal: MigrationJournal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
          
          // First run - apply migrations
          const db1 = createDatabase(TEST_DB_PATH);
          db1.migrate();
          
          const trackingBefore = db1.sqlite.prepare(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY hash"
          ).all() as { hash: string; created_at: number }[];
          
          db1.close();
          
          // Second run - simulate restart
          const db2 = createDatabase(TEST_DB_PATH);
          db2.migrate();
          
          const trackingAfter = db2.sqlite.prepare(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY hash"
          ).all() as { hash: string; created_at: number }[];
          
          db2.close();
          
          // Tracking records should be identical (same hashes, same timestamps)
          expect(trackingAfter.length).toBe(trackingBefore.length);
          expect(trackingAfter.length).toBe(journal.entries.length);
          
          for (let i = 0; i < trackingBefore.length; i++) {
            expect(trackingAfter[i].hash).toBe(trackingBefore[i].hash);
            expect(trackingAfter[i].created_at).toBe(trackingBefore[i].created_at);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
