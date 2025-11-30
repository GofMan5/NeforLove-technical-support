/**
 * Main Bot Class
 * Integrates all components: grammY, middleware, commands, modules, services
 */

import { Bot } from 'grammy';
import type { BotConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import type { SessionManager } from '../services/session.js';
import type { I18nSystem } from '../services/i18n.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { ErrorHandler } from '../services/error-handler.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { MiddlewarePipeline } from '../middleware/pipeline.js';
import { type ModuleLoader, type BotModule, ModuleLoaderImpl } from '../modules/loader.js';
import type { DatabaseConnection } from '../database/connection.js';
import { BotContext, createContextFlavor } from './context.js';

/**
 * Bot dependencies required for initialization
 */
export interface BotDependencies {
  config: BotConfig;
  logger: Logger;
  database: DatabaseConnection;
  sessionManager: SessionManager;
  i18n: I18nSystem;
  auditLogger: AuditLogger;
  errorHandler: ErrorHandler;
  commandRegistry: CommandRegistry<BotContext>;
  middlewarePipeline: MiddlewarePipeline<BotContext>;
  moduleLoader: ModuleLoader<BotContext, BotContext>;
}

/**
 * Bot initialization options
 */
export interface BotOptions {
  /** Whether to register commands with Telegram on start */
  registerCommands?: boolean;
}

/**
 * Main bot class integrating all components
 */
export class TelegramBot {
  private bot: Bot<BotContext>;
  private deps: BotDependencies;
  private options: BotOptions;
  private isRunning: boolean = false;

  constructor(deps: BotDependencies, options: BotOptions = {}) {
    this.deps = deps;
    this.options = {
      registerCommands: true,
      ...options,
    };
    
    // Create grammY bot instance
    this.bot = new Bot<BotContext>(deps.config.bot.token);
    
    this.setupMiddleware();
    this.setupErrorHandling();
  }


  private setupMiddleware(): void {
    const { logger, sessionManager, i18n, auditLogger, database, middlewarePipeline, config } = this.deps;
    
    // Add context flavor middleware (highest priority)
    this.bot.use(createContextFlavor({
      sessionManager,
      i18n,
      auditLogger,
      db: database.db,
      logger,
      config,
    }));
    
    // Add logging middleware
    this.bot.use(async (ctx, next) => {
      const startTime = Date.now();
      const userId = ctx.from?.id;
      const chatId = ctx.chat?.id;
      
      logger.debug('Incoming update', {
        updateId: ctx.update.update_id,
        userId,
        chatId,
        type: this.getUpdateType(ctx),
      });
      
      await next();
      
      const duration = Date.now() - startTime;
      logger.debug('Update processed', {
        updateId: ctx.update.update_id,
        duration: `${duration}ms`,
      });
    });
    
    // Execute custom middleware pipeline
    this.bot.use(async (ctx, next) => {
      await middlewarePipeline.execute(ctx);
      await next();
    });
  }

  private setupErrorHandling(): void {
    const { errorHandler, logger } = this.deps;
    
    this.bot.catch(async (err) => {
      const ctx = err.ctx as BotContext;
      const error = err.error instanceof Error ? err.error : new Error(String(err.error));
      
      // Handle error through error handler
      await errorHandler.handle(error, {
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
      });
      
      // Send user-friendly message
      try {
        await ctx.reply(errorHandler.getUserMessage());
      } catch (replyError) {
        logger.warn('Failed to send error message to user', {
          error: replyError instanceof Error ? replyError.message : String(replyError),
        });
      }
    });
  }

  /**
   * Get update type for logging
   */
  private getUpdateType(ctx: BotContext): string {
    if (ctx.message?.text?.startsWith('/')) return 'command';
    if (ctx.message?.text) return 'message';
    if (ctx.callbackQuery) return 'callback_query';
    if (ctx.inlineQuery) return 'inline_query';
    return 'other';
  }

  registerModule(module: BotModule<BotContext, BotContext>): void {
    const { moduleLoader, commandRegistry, middlewarePipeline, logger } = this.deps;
    
    // Register module with loader
    moduleLoader.register(module);
    
    // Register module commands
    for (const command of module.commands) {
      commandRegistry.register(command);
      logger.debug(`Registered command: /${command.name}`, { module: module.name });
    }
    
    // Register module middlewares
    if (module.middlewares) {
      for (const middleware of module.middlewares) {
        middlewarePipeline.use(middleware);
        logger.debug(`Registered middleware: ${middleware.name}`, { module: module.name });
      }
    }
    
    logger.info(`Module registered: ${module.name}`, {
      commands: module.commands.length,
      handlers: module.handlers.length,
      middlewares: module.middlewares?.length ?? 0,
    });
  }


  private setupCommands(): void {
    const { commandRegistry, logger, moduleLoader } = this.deps;
    const loader = moduleLoader as ModuleLoaderImpl<BotContext, BotContext>;
    
    // Handle all text messages
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      
      if (text.startsWith('/')) {
        // Route through command registry
        const handled = await commandRegistry.route(ctx);
        if (!handled) {
          logger.debug('Unknown command', { command: text.split(' ')[0] });
        }
      } else {
        // Non-command text - route to message handlers
        await loader.executeHandlersWithIsolation('message', ctx, (error) => {
          logger.warn('Module handler error', { module: error.moduleName, error: error.message });
        });
      }
    });
    
    // Handle all media messages
    const mediaHandler = async (ctx: BotContext) => {
      await loader.executeHandlersWithIsolation('message', ctx, (error) => {
        logger.warn('Module handler error', { module: error.moduleName, error: error.message });
      });
    };
    
    this.bot.on('message:photo', mediaHandler);
    this.bot.on('message:video', mediaHandler);
    this.bot.on('message:animation', mediaHandler);
    this.bot.on('message:sticker', mediaHandler);
    this.bot.on('message:voice', mediaHandler);
    this.bot.on('message:video_note', mediaHandler);
    this.bot.on('message:document', mediaHandler);
    
    // Handle callback queries through module handlers
    this.bot.on('callback_query:data', async (ctx) => {
      await loader.executeHandlersWithIsolation('callback_query', ctx, (error) => {
        logger.warn('Module handler error', { module: error.moduleName, error: error.message });
      });
    });
  }

  async registerCommandsWithTelegram(): Promise<void> {
    const { commandRegistry, logger } = this.deps;
    
    // Filter out hidden commands - they still work but don't appear in menu
    const commands = commandRegistry.getAllCommands()
      .filter(cmd => !cmd.hidden)
      .map(cmd => ({
        command: cmd.name,
        description: cmd.description,
      }));
    
    if (commands.length > 0) {
      await this.bot.api.setMyCommands(commands);
      logger.info('Commands registered with Telegram', { count: commands.length });
    }
  }

  async initializeModules(): Promise<void> {
    const { moduleLoader, logger, config, database, i18n } = this.deps;
    
    const modules = moduleLoader.getEnabledModules();
    
    for (const module of modules) {
      if (module.onInit) {
        try {
          await module.onInit({
            db: database.db,
            config,
            logger,
            i18n,
          });
          logger.debug(`Module initialized: ${module.name}`);
        } catch (error) {
          logger.error(`Failed to initialize module: ${module.name}`, 
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    const { logger } = this.deps;
    
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }
    
    // Setup command handlers
    this.setupCommands();
    
    // Initialize modules
    await this.initializeModules();
    
    // Register commands with Telegram if enabled
    if (this.options.registerCommands) {
      await this.registerCommandsWithTelegram();
    }
    
    // Start polling
    this.isRunning = true;
    logger.info('Bot starting...');
    
    this.bot.start({
      onStart: (botInfo) => {
        logger.info(`Bot started: @${botInfo.username}`);
      },
    });
  }

  /**
   * Stop the bot gracefully
   */
  async stop(): Promise<void> {
    const { moduleLoader, database, logger } = this.deps;
    
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping bot...');
    
    // Shutdown modules
    const modules = moduleLoader.getAllModules();
    for (const module of modules) {
      if (module.onShutdown) {
        try {
          await module.onShutdown();
          logger.debug(`Module shutdown: ${module.name}`);
        } catch (error) {
          logger.warn(`Error shutting down module: ${module.name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    
    // Stop bot
    await this.bot.stop();
    
    // Close database
    database.close();
    
    this.isRunning = false;
    logger.info('Bot stopped');
  }

  /**
   * Get the underlying grammY bot instance
   */
  getBot(): Bot<BotContext> {
    return this.bot;
  }

  /**
   * Check if bot is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}
