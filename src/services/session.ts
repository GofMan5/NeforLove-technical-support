/**
 * Session Manager
 * Manages user sessions with database persistence
 */

import { eq, and, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sessions, users } from '../database/schema.js';
import * as schema from '../database/schema.js';

/**
 * Session data structure
 */
export interface SessionData {
  userId: number;
  chatId: number;
  locale: string;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

/**
 * Session Manager interface
 */
export interface SessionManager {
  get(userId: number, chatId: number): Promise<SessionData>;
  set(userId: number, chatId: number, data: Partial<SessionData>): Promise<void>;
  delete(userId: number, chatId: number): Promise<void>;
  cleanup(): Promise<number>;
}

/**
 * Default session expiration time (24 hours in milliseconds)
 */
const DEFAULT_SESSION_TTL = 24 * 60 * 60 * 1000;

/**
 * Creates a session manager instance
 * @param db - Drizzle database instance
 * @param defaultTTL - Default session TTL in milliseconds
 * @returns SessionManager instance
 */
export function createSessionManager(
  db: BetterSQLite3Database<typeof schema>,
  defaultTTL: number = DEFAULT_SESSION_TTL
): SessionManager {
  return {
    async get(userId: number, chatId: number): Promise<SessionData> {
      // Try to find existing session
      const existingSession = db.select()
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(
          eq(users.telegramId, userId),
          eq(sessions.chatId, chatId)
        ))
        .get();

      if (existingSession) {
        const session = existingSession.sessions;
        const user = existingSession.users;
        
        // Check if session is expired
        if (session.expiresAt && session.expiresAt < new Date()) {
          // Session expired, delete and create new one
          db.delete(sessions).where(eq(sessions.id, session.id)).run();
        } else {
          // Return existing session
          const data = (session.data || {}) as Record<string, unknown>;
          return {
            userId,
            chatId,
            locale: user.locale || '',  // Empty string means locale not explicitly set
            state: data,
            createdAt: user.createdAt,
            updatedAt: new Date(),
            expiresAt: session.expiresAt || undefined,
          };
        }
      }

      // Create new user if doesn't exist
      let user = db.select().from(users)
        .where(eq(users.telegramId, userId))
        .get();

      if (!user) {
        const now = new Date();
        db.insert(users).values({
          telegramId: userId,
          createdAt: now,
        }).run();
        user = db.select().from(users)
          .where(eq(users.telegramId, userId))
          .get()!;
      }

      // Create new session
      const now = new Date();
      const expiresAt = new Date(now.getTime() + defaultTTL);
      
      db.insert(sessions).values({
        userId: user.id,
        chatId,
        data: {},
        expiresAt,
      }).run();

      return {
        userId,
        chatId,
        locale: user.locale || '',  // Empty string means locale not explicitly set
        state: {},
        createdAt: user.createdAt,
        updatedAt: now,
        expiresAt,
      };
    },

    async set(userId: number, chatId: number, data: Partial<SessionData>): Promise<void> {
      // Ensure user exists
      let user = db.select().from(users)
        .where(eq(users.telegramId, userId))
        .get();

      if (!user) {
        const now = new Date();
        db.insert(users).values({
          telegramId: userId,
          locale: data.locale || null,
          createdAt: now,
        }).run();
        user = db.select().from(users)
          .where(eq(users.telegramId, userId))
          .get()!;
      }

      // Update user locale if provided
      if (data.locale) {
        db.update(users)
          .set({ locale: data.locale })
          .where(eq(users.id, user.id))
          .run();
      }

      // Find existing session
      const existingSession = db.select()
        .from(sessions)
        .where(and(
          eq(sessions.userId, user.id),
          eq(sessions.chatId, chatId)
        ))
        .get();

      if (existingSession) {
        // Replace state data completely (not merge)
        const newState = data.state !== undefined ? data.state : existingSession.data;
        
        db.update(sessions)
          .set({
            data: newState,
            expiresAt: data.expiresAt || existingSession.expiresAt,
          })
          .where(eq(sessions.id, existingSession.id))
          .run();
      } else {
        // Create new session
        const now = new Date();
        const expiresAt = data.expiresAt || new Date(now.getTime() + defaultTTL);
        
        db.insert(sessions).values({
          userId: user.id,
          chatId,
          data: data.state || {},
          expiresAt,
        }).run();
      }
    },

    /**
     * Delete a session
     */
    async delete(userId: number, chatId: number): Promise<void> {
      const user = db.select().from(users)
        .where(eq(users.telegramId, userId))
        .get();

      if (user) {
        db.delete(sessions)
          .where(and(
            eq(sessions.userId, user.id),
            eq(sessions.chatId, chatId)
          ))
          .run();
      }
    },

    async cleanup(): Promise<number> {
      const now = new Date();
      
      // Get count of expired sessions before deletion
      const expiredSessions = db.select()
        .from(sessions)
        .where(lt(sessions.expiresAt, now))
        .all();
      
      const count = expiredSessions.length;
      
      // Delete expired sessions
      if (count > 0) {
        db.delete(sessions)
          .where(lt(sessions.expiresAt, now))
          .run();
      }
      
      return count;
    },
  };
}
