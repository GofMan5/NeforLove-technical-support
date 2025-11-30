/**
 * Database Connection and Migration
 */

import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import * as path from 'path';

export interface DatabaseConnection {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  migrate(): void;
  close(): void;
}

export function createDatabase(dbPath: string, migrationsFolder?: string): DatabaseConnection {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Default migrations folder is ./drizzle relative to project root
  const defaultMigrationsFolder = path.resolve(process.cwd(), 'drizzle');

  return {
    db,
    sqlite,
    migrate() {
      const folder = migrationsFolder ?? defaultMigrationsFolder;
      drizzleMigrate(db, { migrationsFolder: folder });
    },
    close() {
      sqlite.close();
    },
  };
}

export * from './schema.js';
