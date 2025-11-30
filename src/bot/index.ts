/**
 * Bot module exports
 * Contains main bot class, context types, and factory
 */

export {
  type BotContext,
  type BotContextFlavor,
  createContextFlavor,
} from './context.js';

export {
  type BotDependencies,
  type BotOptions,
  TelegramBot,
} from './bot.js';

export {
  type BotFactoryOptions,
  createBot,
  createBotDependencies,
} from './factory.js';
