/**
 * Custom Bot Context
 * Extends grammY context with session, i18n, and database access
 */

import { Context } from 'grammy';
import { eq } from 'drizzle-orm';
import type { SessionManager } from '../services/session.js';
import type { I18nSystem } from '../services/i18n.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../database/schema.js';
import type { Logger } from '../core/logger.js';
import type { BotConfig } from '../core/config.js';

/**
 * Cached user data to avoid repeated DB queries
 */
export interface CachedUser {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  role: 'user' | 'support' | 'owner';
  locale: string | null;
}

/**
 * Custom context properties added to grammY context
 */
export interface BotContextFlavor {
  /** Session manager for user state */
  sessionManager: SessionManager;
  /** i18n system for translations */
  i18n: I18nSystem;
  /** Audit logger for administrative actions */
  auditLogger: AuditLogger;
  /** Database instance */
  db: BetterSQLite3Database<typeof schema>;
  /** Logger instance */
  logger: Logger;
  /** Bot config */
  config: BotConfig;
  /** Current user's locale */
  locale: string;
  /** Cached user data (loaded once per request) */
  cachedUser?: CachedUser;
  /** Translate a key using user's locale */
  t(key: string, params?: Record<string, string>): string;
  /** Get or create user with caching */
  getUser(): CachedUser | null;
  /** Index signature for compatibility with CommandContext/MiddlewareContext */
  [key: string]: unknown;
}

/**
 * Full bot context type combining grammY Context with custom flavor
 */
export type BotContext = Context & BotContextFlavor;

/**
 * Creates the context flavor middleware that adds custom properties
 */
export function createContextFlavor(deps: {
  sessionManager: SessionManager;
  i18n: I18nSystem;
  auditLogger: AuditLogger;
  db: BetterSQLite3Database<typeof schema>;
  logger: Logger;
  config: BotConfig;
}) {
  return async (ctx: Context, next: () => Promise<void>) => {
    const botCtx = ctx as BotContext;
    
    // Add dependencies to context
    botCtx.sessionManager = deps.sessionManager;
    botCtx.i18n = deps.i18n;
    botCtx.auditLogger = deps.auditLogger;
    botCtx.db = deps.db;
    botCtx.logger = deps.logger;
    botCtx.config = deps.config;
    
    // Load locale from session if user has explicitly set preference
    // For new users without saved locale, use detectLocale (based on Telegram language)
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    
    if (userId && chatId) {
      try {
        const session = await deps.sessionManager.get(userId, chatId);
        // Use session locale if explicitly set, otherwise detect from Telegram
        if (session.locale) {
          botCtx.locale = session.locale;
        } else {
          // For users without explicit locale preference, detect from Telegram
          botCtx.locale = deps.i18n.detectLocale(ctx);
        }
      } catch {
        botCtx.locale = deps.i18n.detectLocale(ctx);
      }
    } else {
      botCtx.locale = deps.i18n.detectLocale(ctx);
    }
    
    // Add translation helper
    botCtx.t = (key: string, params?: Record<string, string>) => {
      return deps.i18n.t(key, botCtx.locale, params);
    };
    
    // Add cached user getter
    botCtx.getUser = () => {
      if (botCtx.cachedUser) {
        return botCtx.cachedUser;
      }
      
      const telegramId = ctx.from?.id;
      if (!telegramId) return null;
      
      const isOwnerFromEnv = deps.config.bot.adminIds.includes(telegramId);
      const currentUsername = ctx.from?.username || null;
      const currentFirstName = ctx.from?.first_name || null;
      
      let user = deps.db.select().from(schema.users).where(eq(schema.users.telegramId, telegramId)).get();
      
      if (!user) {
        // Use INSERT OR IGNORE to handle race condition
        try {
          deps.db.insert(schema.users).values({
            telegramId,
            username: currentUsername,
            firstName: currentFirstName,
            role: isOwnerFromEnv ? 'owner' : 'user',
            createdAt: new Date(),
          }).onConflictDoNothing().run();
        } catch {
          // Ignore duplicate key errors
        }
        user = deps.db.select().from(schema.users).where(eq(schema.users.telegramId, telegramId)).get()!;
      } else {
        // Update profile info if changed
        const updates: Record<string, unknown> = {};
        if (currentUsername !== user.username) updates.username = currentUsername;
        if (currentFirstName !== user.firstName) updates.firstName = currentFirstName;
        if (isOwnerFromEnv && user.role !== 'owner') updates.role = 'owner';
        
        if (Object.keys(updates).length > 0) {
          deps.db.update(schema.users).set(updates).where(eq(schema.users.telegramId, telegramId)).run();
          user = deps.db.select().from(schema.users).where(eq(schema.users.telegramId, telegramId)).get()!;
        }
      }
      
      botCtx.cachedUser = {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        role: user.role as 'user' | 'support' | 'owner',
        locale: user.locale,
      };
      
      return botCtx.cachedUser;
    };
    
    await next();
  };
}
