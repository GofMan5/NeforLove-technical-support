/**
 * Database Schema Definitions
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// User roles
export type UserRole = 'user' | 'support' | 'owner';

/**
 * Users table with roles
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  role: text('role').$type<UserRole>().default('user').notNull(),
  locale: text('locale'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Sessions table
 */
export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  chatId: integer('chat_id').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
});

/**
 * Tickets table
 */
export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull(),
  topicId: integer('topic_id'),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
});

/**
 * Banned users table
 */
export const bannedUsers = sqliteTable('banned_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  reason: text('reason'),
  bannedAt: integer('banned_at', { mode: 'timestamp' }).notNull(),
});

// Media types
export type MediaType = 'text' | 'photo' | 'video' | 'animation' | 'sticker' | 'voice' | 'video_note' | 'document';

/**
 * Messages table with all media types
 */
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').references(() => tickets.id).notNull(),
  telegramId: integer('telegram_id').notNull(),
  userMessageId: integer('user_message_id'),
  topicMessageId: integer('topic_message_id'),
  mediaType: text('media_type').$type<MediaType>().default('text'),
  text: text('text'),
  fileId: text('file_id'), // Universal file ID for any media
  isAdmin: integer('is_admin', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Audit action types
export type AuditAction =
  | 'ticket_created'
  | 'ticket_closed_by_user'
  | 'ticket_closed_by_admin'
  | 'user_banned'
  | 'user_unbanned'
  | 'role_granted'
  | 'role_revoked'
  | 'message_sent'
  | 'message_delivery_failed';

// Audit entity types
export type AuditEntityType = 'ticket' | 'user' | 'message';

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').$type<AuditAction>().notNull(),
  actorId: integer('actor_id').notNull(),
  targetId: integer('target_id'),
  entityType: text('entity_type').$type<AuditEntityType>().notNull(),
  entityId: integer('entity_id'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type BannedUser = typeof bannedUsers.$inferSelect;
export type NewBannedUser = typeof bannedUsers.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
