/**
 * Audit Logger Service
 * Logs administrative actions for audit trail
 */

import { eq, desc, lt, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { auditLogs, type AuditAction, type AuditEntityType } from '../database/schema.js';
import * as schema from '../database/schema.js';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  id: number;
  action: AuditAction;
  actorId: number;
  targetId: number | null;
  entityType: AuditEntityType;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Input for creating a new audit log entry
 */
export interface NewAuditLogEntry {
  action: AuditAction;
  actorId: number;
  targetId?: number;
  entityType: AuditEntityType;
  entityId?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Audit Logger interface
 */
export interface AuditLogger {
  log(entry: NewAuditLogEntry): Promise<AuditLogEntry>;
  getByActor(actorId: number, limit?: number): Promise<AuditLogEntry[]>;
  getByTarget(targetId: number, limit?: number): Promise<AuditLogEntry[]>;
  getByAction(action: AuditAction, limit?: number): Promise<AuditLogEntry[]>;
  /** Cleanup old logs, returns number of deleted entries */
  cleanup(olderThanDays?: number): Promise<number>;
}

/**
 * Default limit for query results
 */
const DEFAULT_LIMIT = 100;

/**
 * Default retention period for audit logs (90 days)
 */
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Creates an audit logger instance
 * @param db - Drizzle database instance
 * @returns AuditLogger instance
 */
export function createAuditLogger(
  db: BetterSQLite3Database<typeof schema>
): AuditLogger {
  return {
    async log(entry: NewAuditLogEntry): Promise<AuditLogEntry> {
      const now = new Date();

      const result = db.insert(auditLogs).values({
        action: entry.action,
        actorId: entry.actorId,
        targetId: entry.targetId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        createdAt: now,
      }).returning().get();

      return {
        id: result.id,
        action: result.action,
        actorId: result.actorId,
        targetId: result.targetId,
        entityType: result.entityType,
        entityId: result.entityId,
        metadata: result.metadata,
        createdAt: result.createdAt,
      };
    },

    async getByActor(actorId: number, limit: number = DEFAULT_LIMIT): Promise<AuditLogEntry[]> {
      const results = db.select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, actorId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .all();

      return results.map(r => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId,
        targetId: r.targetId,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        createdAt: r.createdAt,
      }));
    },

    async getByTarget(targetId: number, limit: number = DEFAULT_LIMIT): Promise<AuditLogEntry[]> {
      const results = db.select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, targetId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .all();

      return results.map(r => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId,
        targetId: r.targetId,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        createdAt: r.createdAt,
      }));
    },

    async getByAction(action: AuditAction, limit: number = DEFAULT_LIMIT): Promise<AuditLogEntry[]> {
      const results = db.select()
        .from(auditLogs)
        .where(eq(auditLogs.action, action))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .all();

      return results.map(r => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId,
        targetId: r.targetId,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        createdAt: r.createdAt,
      }));
    },

    async cleanup(olderThanDays: number = DEFAULT_RETENTION_DAYS): Promise<number> {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      // Get count before deletion
      const countResult = db.select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(lt(auditLogs.createdAt, cutoffDate))
        .get();
      
      const count = countResult?.count || 0;
      
      if (count > 0) {
        db.delete(auditLogs)
          .where(lt(auditLogs.createdAt, cutoffDate))
          .run();
      }
      
      return count;
    },
  };
}

// Re-export types from schema for convenience
export type { AuditAction, AuditEntityType } from '../database/schema.js';
