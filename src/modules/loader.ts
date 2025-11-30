/**
 * Module Loader
 * Provides module registration, validation, enable/disable, and error isolation
 */

import { CommandDefinition, CommandContext } from '../commands/registry.js';
import { MiddlewareDefinition, MiddlewareContext } from '../middleware/pipeline.js';

/**
 * Handler definition for non-command event handlers
 */
export interface HandlerDefinition<T = unknown> {
  name: string;
  event: string;
  handler: (ctx: T) => Promise<void>;
}

/**
 * Module context provided during initialization
 */
export interface ModuleContext {
  [key: string]: unknown;
}

export interface BotModule<
  TCmd extends CommandContext = CommandContext,
  TMw extends MiddlewareContext = MiddlewareContext
> {
  name: string;
  enabled: boolean;
  commands: CommandDefinition<TCmd>[];
  handlers: HandlerDefinition[];
  middlewares?: MiddlewareDefinition<TMw>[];
  onInit?(ctx: ModuleContext): Promise<void>;
  onShutdown?(): Promise<void>;
}

/**
 * Registered module info
 */
export interface RegisteredModule {
  name: string;
  enabled: boolean;
  commandCount: number;
  handlerCount: number;
}

/**
 * Module loader interface
 */
export interface ModuleLoader<
  TCmd extends CommandContext = CommandContext,
  TMw extends MiddlewareContext = MiddlewareContext
> {
  register(module: BotModule<TCmd, TMw>): void;
  unregister(moduleName: string): void;
  enable(moduleName: string): void;
  disable(moduleName: string): void;
  getModule(name: string): BotModule<TCmd, TMw> | undefined;
  getAllModules(): BotModule<TCmd, TMw>[];
  getEnabledModules(): BotModule<TCmd, TMw>[];
  validateModule(module: unknown): module is BotModule<TCmd, TMw>;
  getRegisteredModuleInfo(): RegisteredModule[];
}


/**
 * Module validation error
 */
export class ModuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleValidationError';
  }
}

/**
 * Module execution error - wraps errors from module handlers
 */
export class ModuleExecutionError extends Error {
  public readonly moduleName: string;
  public readonly originalError: Error;

  constructor(moduleName: string, originalError: Error) {
    super(`Error in module "${moduleName}": ${originalError.message}`);
    this.name = 'ModuleExecutionError';
    this.moduleName = moduleName;
    this.originalError = originalError;
  }
}

/**
 * Validates that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates that a value is a boolean
 */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Validates that a value is an array
 */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Validates that a value is a function
 */
function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

/**
 * Validates a command definition structure
 */
function isValidCommandDefinition(cmd: unknown): cmd is CommandDefinition {
  if (typeof cmd !== 'object' || cmd === null) return false;
  const c = cmd as Record<string, unknown>;
  return (
    isNonEmptyString(c.name) &&
    isNonEmptyString(c.description) &&
    isFunction(c.handler)
  );
}

/**
 * Validates a handler definition structure
 */
function isValidHandlerDefinition(handler: unknown): handler is HandlerDefinition {
  if (typeof handler !== 'object' || handler === null) return false;
  const h = handler as Record<string, unknown>;
  return (
    isNonEmptyString(h.name) &&
    isNonEmptyString(h.event) &&
    isFunction(h.handler)
  );
}

/**
 * Validates a middleware definition structure
 */
function isValidMiddlewareDefinition(mw: unknown): mw is MiddlewareDefinition {
  if (typeof mw !== 'object' || mw === null) return false;
  const m = mw as Record<string, unknown>;
  return (
    isNonEmptyString(m.name) &&
    typeof m.priority === 'number' &&
    isFunction(m.handler)
  );
}

/**
 * Validates a module structure
 */
export function validateModule(module: unknown): module is BotModule {
  if (typeof module !== 'object' || module === null) {
    return false;
  }

  const m = module as Record<string, unknown>;

  // Required fields
  if (!isNonEmptyString(m.name)) return false;
  if (!isBoolean(m.enabled)) return false;
  if (!isArray(m.commands)) return false;
  if (!isArray(m.handlers)) return false;

  // Validate all commands
  for (const cmd of m.commands) {
    if (!isValidCommandDefinition(cmd)) return false;
  }

  // Validate all handlers
  for (const handler of m.handlers) {
    if (!isValidHandlerDefinition(handler)) return false;
  }

  // Validate middlewares if present
  if (m.middlewares !== undefined) {
    if (!isArray(m.middlewares)) return false;
    for (const mw of m.middlewares) {
      if (!isValidMiddlewareDefinition(mw)) return false;
    }
  }

  // Validate optional lifecycle hooks
  if (m.onInit !== undefined && !isFunction(m.onInit)) return false;
  if (m.onShutdown !== undefined && !isFunction(m.onShutdown)) return false;

  return true;
}


export class ModuleLoaderImpl<
  TCmd extends CommandContext = CommandContext,
  TMw extends MiddlewareContext = MiddlewareContext
> implements ModuleLoader<TCmd, TMw> {
  private modules: Map<string, BotModule<TCmd, TMw>> = new Map();

  /**
   * Register a module with validation
   */
  register(module: BotModule<TCmd, TMw>): void {
    if (!this.validateModule(module)) {
      throw new ModuleValidationError(
        `Invalid module structure for "${(module as { name?: string })?.name || 'unknown'}". ` +
        `Module must have: name (string), enabled (boolean), commands (array), handlers (array).`
      );
    }

    if (this.modules.has(module.name)) {
      throw new ModuleValidationError(
        `Module "${module.name}" is already registered.`
      );
    }

    this.modules.set(module.name, module);
  }

  /**
   * Unregister a module by name
   */
  unregister(moduleName: string): void {
    this.modules.delete(moduleName);
  }

  /**
   * Enable a module
   */
  enable(moduleName: string): void {
    const module = this.modules.get(moduleName);
    if (module) {
      module.enabled = true;
    }
  }

  /**
   * Disable a module
   */
  disable(moduleName: string): void {
    const module = this.modules.get(moduleName);
    if (module) {
      module.enabled = false;
    }
  }

  /**
   * Get a module by name
   */
  getModule(name: string): BotModule<TCmd, TMw> | undefined {
    return this.modules.get(name);
  }

  /**
   * Get all registered modules
   */
  getAllModules(): BotModule<TCmd, TMw>[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get only enabled modules
   */
  getEnabledModules(): BotModule<TCmd, TMw>[] {
    return Array.from(this.modules.values()).filter(m => m.enabled);
  }

  /**
   * Validate a module structure
   */
  validateModule(module: unknown): module is BotModule<TCmd, TMw> {
    return validateModule(module);
  }

  /**
   * Get registered module info
   */
  getRegisteredModuleInfo(): RegisteredModule[] {
    return Array.from(this.modules.values()).map(m => ({
      name: m.name,
      enabled: m.enabled,
      commandCount: m.commands.length,
      handlerCount: m.handlers.length,
    }));
  }

  /**
   * Execute a handler with error isolation
   */
  async executeWithIsolation<T>(
    moduleName: string,
    fn: () => Promise<T>
  ): Promise<{ success: true; result: T } | { success: false; error: ModuleExecutionError }> {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { success: false, error: new ModuleExecutionError(moduleName, error) };
    }
  }

  /**
   * Execute handlers across all enabled modules with error isolation
   */
  async executeHandlersWithIsolation<TCtx>(
    event: string,
    ctx: TCtx,
    onError?: (error: ModuleExecutionError) => void
  ): Promise<{ handled: string[]; errors: ModuleExecutionError[] }> {
    const handled: string[] = [];
    const errors: ModuleExecutionError[] = [];

    for (const module of this.getEnabledModules()) {
      const matchingHandlers = module.handlers.filter(h => h.event === event);
      
      for (const handler of matchingHandlers) {
        const result = await this.executeWithIsolation(module.name, async () => {
          await handler.handler(ctx);
        });

        if (result.success) {
          handled.push(`${module.name}:${handler.name}`);
        } else {
          errors.push(result.error);
          onError?.(result.error);
        }
      }
    }

    return { handled, errors };
  }
}

/**
 * Factory function to create a new module loader
 */
export function createModuleLoader<
  TCmd extends CommandContext = CommandContext,
  TMw extends MiddlewareContext = MiddlewareContext
>(): ModuleLoader<TCmd, TMw> {
  return new ModuleLoaderImpl<TCmd, TMw>();
}
