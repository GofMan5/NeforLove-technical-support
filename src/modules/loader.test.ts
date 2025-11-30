/**
 * Property-based tests for Module Loader
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  type BotModule,
  type HandlerDefinition,
  validateModule,
  createModuleLoader,
  ModuleValidationError,
  ModuleLoaderImpl,
} from './loader.js';
import { type CommandDefinition, type CommandContext } from '../commands/registry.js';
import { type MiddlewareDefinition, type MiddlewareContext } from '../middleware/pipeline.js';

/**
 * Arbitrary for generating valid module names
 */
const validModuleNameArbitrary = fc.string({ minLength: 1, maxLength: 30 })
  .filter(s => s.trim().length > 0);

/**
 * Arbitrary for generating valid command definitions
 */
const commandDefinitionArbitrary = fc.record({
  name: fc.constantFrom('start', 'help', 'settings', 'info', 'status'),
  description: fc.string({ minLength: 1, maxLength: 50 }),
  handler: fc.constant(async () => {}),
});

/**
 * Arbitrary for generating valid handler definitions
 */
const handlerDefinitionArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  event: fc.constantFrom('message', 'callback_query', 'inline_query', 'edited_message'),
  handler: fc.constant(async () => {}),
});

/**
 * Arbitrary for generating valid middleware definitions
 */
const middlewareDefinitionArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  priority: fc.integer({ min: 0, max: 100 }),
  handler: fc.constant(async (_ctx: MiddlewareContext, next: () => Promise<void>) => { await next(); }),
});


/**
 * Arbitrary for generating valid bot modules
 */
const validModuleArbitrary = fc.record({
  name: validModuleNameArbitrary,
  enabled: fc.boolean(),
  commands: fc.array(commandDefinitionArbitrary, { minLength: 0, maxLength: 5 }),
  handlers: fc.array(handlerDefinitionArbitrary, { minLength: 0, maxLength: 5 }),
  middlewares: fc.option(fc.array(middlewareDefinitionArbitrary, { minLength: 0, maxLength: 3 }), { nil: undefined }),
});

/**
 * Arbitrary for generating invalid module structures
 */
const invalidModuleArbitrary = fc.oneof(
  // Missing name
  fc.record({
    enabled: fc.boolean(),
    commands: fc.array(commandDefinitionArbitrary),
    handlers: fc.array(handlerDefinitionArbitrary),
  }),
  // Empty name
  fc.record({
    name: fc.constant(''),
    enabled: fc.boolean(),
    commands: fc.array(commandDefinitionArbitrary),
    handlers: fc.array(handlerDefinitionArbitrary),
  }),
  // Missing enabled
  fc.record({
    name: validModuleNameArbitrary,
    commands: fc.array(commandDefinitionArbitrary),
    handlers: fc.array(handlerDefinitionArbitrary),
  }),
  // Invalid enabled type
  fc.record({
    name: validModuleNameArbitrary,
    enabled: fc.string(),
    commands: fc.array(commandDefinitionArbitrary),
    handlers: fc.array(handlerDefinitionArbitrary),
  }),
  // Missing commands
  fc.record({
    name: validModuleNameArbitrary,
    enabled: fc.boolean(),
    handlers: fc.array(handlerDefinitionArbitrary),
  }),
  // Commands not an array
  fc.record({
    name: validModuleNameArbitrary,
    enabled: fc.boolean(),
    commands: fc.string(),
    handlers: fc.array(handlerDefinitionArbitrary),
  }),
  // Missing handlers
  fc.record({
    name: validModuleNameArbitrary,
    enabled: fc.boolean(),
    commands: fc.array(commandDefinitionArbitrary),
  }),
  // Handlers not an array
  fc.record({
    name: validModuleNameArbitrary,
    enabled: fc.boolean(),
    commands: fc.array(commandDefinitionArbitrary),
    handlers: fc.string(),
  }),
  // null value
  fc.constant(null),
  // undefined value
  fc.constant(undefined),
  // primitive value
  fc.string(),
  // number value
  fc.integer(),
);

describe('Module Loader Property Tests', () => {
  describe('Module Registration Completeness', () => {
    it('should register module with correct command and handler counts', async () => {
      await fc.assert(
        fc.property(validModuleArbitrary, (moduleData) => {
          const loader = createModuleLoader();
          const module = moduleData as BotModule;
          
          loader.register(module);
          
          const registered = loader.getModule(module.name);
          expect(registered).toBeDefined();
          expect(registered?.commands.length).toBe(module.commands.length);
          expect(registered?.handlers.length).toBe(module.handlers.length);
          
          const info = loader.getRegisteredModuleInfo();
          const moduleInfo = info.find(m => m.name === module.name);
          expect(moduleInfo).toBeDefined();
          expect(moduleInfo?.commandCount).toBe(module.commands.length);
          expect(moduleInfo?.handlerCount).toBe(module.handlers.length);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve all command definitions after registration', async () => {
      await fc.assert(
        fc.property(validModuleArbitrary, (moduleData) => {
          const loader = createModuleLoader();
          const module = moduleData as BotModule;
          
          loader.register(module);
          
          const registered = loader.getModule(module.name);
          expect(registered?.commands).toEqual(module.commands);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve all handler definitions after registration', async () => {
      await fc.assert(
        fc.property(validModuleArbitrary, (moduleData) => {
          const loader = createModuleLoader();
          const module = moduleData as BotModule;
          
          loader.register(module);
          
          const registered = loader.getModule(module.name);
          expect(registered?.handlers).toEqual(module.handlers);
        }),
        { numRuns: 100 }
      );
    });
  });


  describe('Module Isolation on Disable', () => {
    it('should only return enabled modules from getEnabledModules', async () => {
      await fc.assert(
        fc.property(
          fc.array(validModuleArbitrary, { minLength: 1, maxLength: 5 })
            .map(modules => {
              // Ensure unique names
              const seen = new Set<string>();
              return modules.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
              });
            })
            .filter(modules => modules.length >= 1),
          (modulesData) => {
            const loader = createModuleLoader();
            const modules = modulesData as BotModule[];
            
            for (const module of modules) {
              loader.register(module);
            }
            
            const enabledModules = loader.getEnabledModules();
            const expectedEnabled = modules.filter(m => m.enabled);
            
            expect(enabledModules.length).toBe(expectedEnabled.length);
            for (const em of enabledModules) {
              expect(em.enabled).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not affect other modules when disabling one', async () => {
      await fc.assert(
        fc.property(
          fc.array(validModuleArbitrary.map(m => ({ ...m, enabled: true })), { minLength: 2, maxLength: 5 })
            .map(modules => {
              const seen = new Set<string>();
              return modules.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
              });
            })
            .filter(modules => modules.length >= 2),
          (modulesData) => {
            const loader = createModuleLoader();
            const modules = modulesData as BotModule[];
            
            for (const module of modules) {
              loader.register(module);
            }
            
            // Disable the first module
            const disabledName = modules[0].name;
            loader.disable(disabledName);
            
            // Check that other modules are still enabled
            for (let i = 1; i < modules.length; i++) {
              const m = loader.getModule(modules[i].name);
              expect(m?.enabled).toBe(true);
            }
            
            // Check that disabled module is disabled
            const disabled = loader.getModule(disabledName);
            expect(disabled?.enabled).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should re-enable module without affecting others', async () => {
      await fc.assert(
        fc.property(
          fc.array(validModuleArbitrary.map(m => ({ ...m, enabled: false })), { minLength: 2, maxLength: 5 })
            .map(modules => {
              const seen = new Set<string>();
              return modules.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
              });
            })
            .filter(modules => modules.length >= 2),
          (modulesData) => {
            const loader = createModuleLoader();
            const modules = modulesData as BotModule[];
            
            for (const module of modules) {
              loader.register(module);
            }
            
            // Enable the first module
            const enabledName = modules[0].name;
            loader.enable(enabledName);
            
            // Check that other modules are still disabled
            for (let i = 1; i < modules.length; i++) {
              const m = loader.getModule(modules[i].name);
              expect(m?.enabled).toBe(false);
            }
            
            // Check that enabled module is enabled
            const enabled = loader.getModule(enabledName);
            expect(enabled?.enabled).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  describe('Module Validation Correctness', () => {
    it('should return true for valid module structures', async () => {
      await fc.assert(
        fc.property(validModuleArbitrary, (moduleData) => {
          const isValid = validateModule(moduleData);
          expect(isValid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return false for invalid module structures', async () => {
      await fc.assert(
        fc.property(invalidModuleArbitrary, (invalidData) => {
          const isValid = validateModule(invalidData);
          expect(isValid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should throw ModuleValidationError when registering invalid module', async () => {
      await fc.assert(
        fc.property(invalidModuleArbitrary, (invalidData) => {
          const loader = createModuleLoader();
          expect(() => loader.register(invalidData as BotModule)).toThrow(ModuleValidationError);
        }),
        { numRuns: 100 }
      );
    });

    it('should successfully register valid modules', async () => {
      await fc.assert(
        fc.property(validModuleArbitrary, (moduleData) => {
          const loader = createModuleLoader();
          const module = moduleData as BotModule;
          
          expect(() => loader.register(module)).not.toThrow();
          expect(loader.getModule(module.name)).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should validate command structure within module', async () => {
      // Module with invalid command (missing handler)
      const invalidCommandModule = {
        name: 'test',
        enabled: true,
        commands: [{ name: 'cmd', description: 'desc' }], // missing handler
        handlers: [],
      };
      
      expect(validateModule(invalidCommandModule)).toBe(false);
    });

    it('should validate handler structure within module', async () => {
      // Module with invalid handler (missing event)
      const invalidHandlerModule = {
        name: 'test',
        enabled: true,
        commands: [],
        handlers: [{ name: 'handler', handler: async () => {} }], // missing event
      };
      
      expect(validateModule(invalidHandlerModule)).toBe(false);
    });
  });


  describe('Module Error Isolation', () => {
    it('should isolate errors and continue processing other modules', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 4 }), // Index of module that will throw
          fc.integer({ min: 2, max: 5 }), // Total number of modules
          async (errorIndex, totalModules) => {
            // Ensure errorIndex is valid
            const actualErrorIndex = errorIndex % totalModules;
            
            const loader = new ModuleLoaderImpl();
            const executedHandlers: string[] = [];
            
            // Create modules with handlers
            for (let i = 0; i < totalModules; i++) {
              const shouldThrow = i === actualErrorIndex;
              const module: BotModule = {
                name: `module_${i}`,
                enabled: true,
                commands: [],
                handlers: [{
                  name: `handler_${i}`,
                  event: 'message',
                  handler: async () => {
                    if (shouldThrow) {
                      throw new Error(`Error from module_${i}`);
                    }
                    executedHandlers.push(`module_${i}`);
                  },
                }],
              };
              loader.register(module);
            }
            
            const result = await loader.executeHandlersWithIsolation('message', {});
            
            // All non-throwing modules should have executed
            expect(executedHandlers.length).toBe(totalModules - 1);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0].moduleName).toBe(`module_${actualErrorIndex}`);
            
            // Verify the correct modules executed
            for (let i = 0; i < totalModules; i++) {
              if (i !== actualErrorIndex) {
                expect(executedHandlers).toContain(`module_${i}`);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should capture error details in ModuleExecutionError', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          async (errorMessage) => {
            const loader = new ModuleLoaderImpl();
            
            const module: BotModule = {
              name: 'error_module',
              enabled: true,
              commands: [],
              handlers: [{
                name: 'error_handler',
                event: 'test',
                handler: async () => {
                  throw new Error(errorMessage);
                },
              }],
            };
            loader.register(module);
            
            const result = await loader.executeHandlersWithIsolation('test', {});
            
            expect(result.errors.length).toBe(1);
            expect(result.errors[0].moduleName).toBe('error_module');
            expect(result.errors[0].originalError.message).toBe(errorMessage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should call onError callback for each error', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }), // Number of modules that will throw
          async (errorCount) => {
            const loader = new ModuleLoaderImpl();
            const errorCallbackCalls: string[] = [];
            
            // Create modules that throw errors
            for (let i = 0; i < errorCount; i++) {
              const module: BotModule = {
                name: `error_module_${i}`,
                enabled: true,
                commands: [],
                handlers: [{
                  name: `error_handler_${i}`,
                  event: 'test',
                  handler: async () => {
                    throw new Error(`Error ${i}`);
                  },
                }],
              };
              loader.register(module);
            }
            
            await loader.executeHandlersWithIsolation('test', {}, (error) => {
              errorCallbackCalls.push(error.moduleName);
            });
            
            expect(errorCallbackCalls.length).toBe(errorCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should skip disabled modules during execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (totalModules) => {
            const loader = new ModuleLoaderImpl();
            const executedHandlers: string[] = [];
            
            for (let i = 0; i < totalModules; i++) {
              const module: BotModule = {
                name: `module_${i}`,
                enabled: i % 2 === 0, // Only even-indexed modules are enabled
                commands: [],
                handlers: [{
                  name: `handler_${i}`,
                  event: 'message',
                  handler: async () => {
                    executedHandlers.push(`module_${i}`);
                  },
                }],
              };
              loader.register(module);
            }
            
            await loader.executeHandlersWithIsolation('message', {});
            
            // Only enabled modules should have executed
            const expectedCount = Math.ceil(totalModules / 2);
            expect(executedHandlers.length).toBe(expectedCount);
            
            for (const name of executedHandlers) {
              const index = parseInt(name.split('_')[1]);
              expect(index % 2).toBe(0); // Only even-indexed
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only execute handlers matching the event', async () => {
      const loader = new ModuleLoaderImpl();
      const executedHandlers: string[] = [];
      
      const module: BotModule = {
        name: 'multi_handler',
        enabled: true,
        commands: [],
        handlers: [
          {
            name: 'message_handler',
            event: 'message',
            handler: async () => { executedHandlers.push('message'); },
          },
          {
            name: 'callback_handler',
            event: 'callback_query',
            handler: async () => { executedHandlers.push('callback'); },
          },
        ],
      };
      loader.register(module);
      
      await loader.executeHandlersWithIsolation('message', {});
      
      expect(executedHandlers).toEqual(['message']);
    });
  });
});

describe('Module Loader Unit Tests', () => {
  it('should throw when registering duplicate module name', () => {
    const loader = createModuleLoader();
    const module: BotModule = {
      name: 'test',
      enabled: true,
      commands: [],
      handlers: [],
    };
    
    loader.register(module);
    expect(() => loader.register(module)).toThrow(ModuleValidationError);
  });

  it('should unregister module by name', () => {
    const loader = createModuleLoader();
    const module: BotModule = {
      name: 'test',
      enabled: true,
      commands: [],
      handlers: [],
    };
    
    loader.register(module);
    expect(loader.getModule('test')).toBeDefined();
    
    loader.unregister('test');
    expect(loader.getModule('test')).toBeUndefined();
  });

  it('should return all registered modules', () => {
    const loader = createModuleLoader();
    
    loader.register({ name: 'a', enabled: true, commands: [], handlers: [] });
    loader.register({ name: 'b', enabled: false, commands: [], handlers: [] });
    
    const all = loader.getAllModules();
    expect(all.length).toBe(2);
    expect(all.map(m => m.name).sort()).toEqual(['a', 'b']);
  });
});
