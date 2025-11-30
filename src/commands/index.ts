/**
 * Commands module exports
 * Contains command registry and routing system
 */

export {
  type CommandContext,
  type CommandHandler,
  type CommandDefinition,
  type CommandRegistry,
  CommandValidationError,
  validateCommandName,
  extractCommandFromText,
  CommandRegistryImpl,
  createCommandRegistry,
} from './registry.js';
