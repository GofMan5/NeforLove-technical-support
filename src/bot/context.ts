/**
 * Custom Bot Context
 * Extends grammY context with session, i18n, and database access
 */

import { Context } from 'grammy';
import type { SessionManager } from '../services/session.js';
import type { I18nSystem } from '../services/i18n.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';
import type { Logger } from '../core/logger.js';
import type { BotConfig } from '../core/config.js';

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
  /** Translate a key using user's locale */
  t(key: string, params?: Record<string, string>): string;
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
    
    await next();
  };
}
