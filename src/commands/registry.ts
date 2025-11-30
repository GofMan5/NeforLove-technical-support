/**
 * Command Registry
 * Provides command registration, validation, and routing
 */

/**
 * Minimal context interface for command handlers
 * In production, this would be extended from grammY's Context
 */
export interface CommandContext {
  message?: {
    text?: string;
  };
  [key: string]: unknown;
}

/**
 * Command handler function type
 */
export type CommandHandler<T extends CommandContext = CommandContext> = (
  ctx: T
) => Promise<void>;

export interface CommandDefinition<T extends CommandContext = CommandContext> {
  name: string;
  description: string;
  usage?: string;
  handler: CommandHandler<T>;
  hidden?: boolean; // If true, command won't appear in bot menu but still works
}

/**
 * Command registry interface
 */
export interface CommandRegistry<T extends CommandContext = CommandContext> {
  register(command: CommandDefinition<T>): void;
  unregister(commandName: string): void;
  getCommand(name: string): CommandDefinition<T> | undefined;
  getAllCommands(): CommandDefinition<T>[];
  validateCommandName(name: string): boolean;
  route(ctx: T): Promise<boolean>;
}

/**
 * Command validation error
 */
export class CommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandValidationError';
  }
}


/**
 * Command name validation pattern
 * Telegram command names must:
 * - Start with a lowercase letter
 * - Contain only lowercase letters, digits, and underscores
 * - Be 1-32 characters long
 */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Validates a command name against Telegram's requirements
 * @param name - The command name to validate
 * @returns true if valid, false otherwise
 */
export function validateCommandName(name: string): boolean {
  return COMMAND_NAME_PATTERN.test(name);
}

/**
 * Extracts command name from message text
 * @param text - The message text (e.g., "/start" or "/help@botname")
 * @returns The command name without slash and bot mention, or null if not a command
 */
export function extractCommandFromText(text: string): string | null {
  if (!text.startsWith('/')) {
    return null;
  }

  // Remove the leading slash
  const withoutSlash = text.slice(1);

  // Split by space to get just the command part
  const commandPart = withoutSlash.split(/\s/)[0];

  // Remove bot mention if present (e.g., "start@mybot" -> "start")
  const commandName = commandPart.split('@')[0];

  return commandName || null;
}

export class CommandRegistryImpl<T extends CommandContext = CommandContext>
  implements CommandRegistry<T>
{
  private commands: Map<string, CommandDefinition<T>> = new Map();

  /**
   * Register a command with validation
   */
  register(command: CommandDefinition<T>): void {
    if (!this.validateCommandName(command.name)) {
      throw new CommandValidationError(
        `Invalid command name "${command.name}". Command names must start with a lowercase letter, ` +
        `contain only lowercase letters, digits, and underscores, and be 1-32 characters long.`
      );
    }

    this.commands.set(command.name, command);
  }

  /**
   * Unregister a command by name
   */
  unregister(commandName: string): void {
    this.commands.delete(commandName);
  }

  /**
   * Get a command by name
   */
  getCommand(name: string): CommandDefinition<T> | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all registered commands
   */
  getAllCommands(): CommandDefinition<T>[] {
    return Array.from(this.commands.values());
  }

  /**
   * Validate a command name
   */
  validateCommandName(name: string): boolean {
    return validateCommandName(name);
  }

  /**
   * Route a command to its handler
   * @returns true if command was handled, false otherwise
   */
  async route(ctx: T): Promise<boolean> {
    const text = ctx.message?.text;
    if (!text) {
      return false;
    }

    const commandName = extractCommandFromText(text);
    if (!commandName) {
      return false;
    }

    const command = this.commands.get(commandName);
    if (!command) {
      return false;
    }

    await command.handler(ctx);
    return true;
  }
}

/**
 * Factory function to create a new command registry
 */
export function createCommandRegistry<T extends CommandContext = CommandContext>(): CommandRegistry<T> {
  return new CommandRegistryImpl<T>();
}
