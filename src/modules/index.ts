/**
 * Bot modules exports
 * Contains feature modules (user, admin, help, etc.)
 */

export {
  BotModule,
  ModuleLoader,
  ModuleContext,
  HandlerDefinition,
  RegisteredModule,
  ModuleLoaderImpl,
  ModuleValidationError,
  ModuleExecutionError,
  validateModule,
  createModuleLoader,
} from './loader.js';

// Language module for locale switching
export { langModule } from './example/index.js';
