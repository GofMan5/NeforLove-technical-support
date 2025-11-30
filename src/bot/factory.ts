/**
 * Bot Factory
 * Creates and configures the bot with all dependencies
 */

import { loadConfigFromEnv, type BotConfig } from '../core/config.js';
import { createLogger, type Logger } from '../core/logger.js';
import { createDatabase } from '../database/connection.js';
import { createSessionManager } from '../services/session.js';
import { I18nSystem } from '../services/i18n.js';
import { createAuditLogger } from '../services/audit-logger.js';
import { createErrorHandler } from '../services/error-handler.js';
import { createCommandRegistry } from '../commands/registry.js';
import { createMiddlewarePipeline } from '../middleware/pipeline.js';
import { createModuleLoader } from '../modules/loader.js';
import { TelegramBot, type BotDependencies, type BotOptions } from './bot.js';
import type { BotContext } from './context.js';

/**
 * Factory options for creating the bot
 */
export interface BotFactoryOptions {
  /** Custom config (defaults to loading from env) */
  config?: BotConfig;
  /** Custom logger */
  logger?: Logger;
  /** Bot options */
  botOptions?: BotOptions;
}

/**
 * Creates a fully configured bot instance with all dependencies
 */
export function createBot(options: BotFactoryOptions = {}): TelegramBot {
  // Load or use provided config
  const config = options.config ?? loadConfigFromEnv();
  
  // Create logger
  const logger = options.logger ?? createLogger(config.logging.level);
  
  // Create database connection
  const database = createDatabase(config.database.path);
  
  try {
    database.migrate();
    logger.info('Database migrations applied successfully');
  } catch (error) {
    const migrationError = error instanceof Error ? error : new Error(String(error));
    logger.error('Database migration failed', migrationError);
    throw new Error(`Database migration failed: ${migrationError.message}`);
  }
  
  // Create session manager
  const sessionManager = createSessionManager(database.db);
  
  // Create i18n system
  const i18n = new I18nSystem({
    defaultLocale: config.i18n.defaultLocale,
    localesPath: config.i18n.localesPath,
  });
  i18n.loadTranslations();
  
  // Create audit logger
  const auditLogger = createAuditLogger(database.db);
  
  // Create error handler
  const errorHandler = createErrorHandler(logger);
  
  // Create command registry
  const commandRegistry = createCommandRegistry<BotContext>();
  
  // Create middleware pipeline
  const middlewarePipeline = createMiddlewarePipeline<BotContext>();
  
  // Create module loader
  const moduleLoader = createModuleLoader<BotContext, BotContext>();
  
  // Assemble dependencies
  const deps: BotDependencies = {
    config,
    logger,
    database,
    sessionManager,
    i18n,
    auditLogger,
    errorHandler,
    commandRegistry,
    middlewarePipeline,
    moduleLoader,
  };
  
  // Create and return bot
  return new TelegramBot(deps, options.botOptions);
}

/**
 * Creates bot dependencies without creating the bot itself
 * Useful for testing or custom bot setup
 */
export function createBotDependencies(options: BotFactoryOptions = {}): BotDependencies {
  const config = options.config ?? loadConfigFromEnv();
  const logger = options.logger ?? createLogger(config.logging.level);
  
  const database = createDatabase(config.database.path);
  
  try {
    database.migrate();
    logger.info('Database migrations applied successfully');
  } catch (error) {
    const migrationError = error instanceof Error ? error : new Error(String(error));
    logger.error('Database migration failed', migrationError);
    throw new Error(`Database migration failed: ${migrationError.message}`);
  }
  
  const sessionManager = createSessionManager(database.db);
  
  const i18n = new I18nSystem({
    defaultLocale: config.i18n.defaultLocale,
    localesPath: config.i18n.localesPath,
  });
  i18n.loadTranslations();
  
  const auditLogger = createAuditLogger(database.db);
  
  const errorHandler = createErrorHandler(logger);
  const commandRegistry = createCommandRegistry<BotContext>();
  const middlewarePipeline = createMiddlewarePipeline<BotContext>();
  const moduleLoader = createModuleLoader<BotContext, BotContext>();
  
  return {
    config,
    logger,
    database,
    sessionManager,
    i18n,
    auditLogger,
    errorHandler,
    commandRegistry,
    middlewarePipeline,
    moduleLoader,
  };
}
