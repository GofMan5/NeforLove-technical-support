/**
 * Property-based tests for Command Registry
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  type CommandContext,
  type CommandDefinition,
  validateCommandName,
  extractCommandFromText,
  createCommandRegistry,
  CommandValidationError,
} from './registry.js';

// Test context that tracks handler calls
interface TestContext extends CommandContext {
  handledBy?: string;
}

/**
 * Arbitrary for generating valid command names
 * Must match pattern /^[a-z][a-z0-9_]{0,31}$/
 */
const validCommandNameArbitrary = fc
  .tuple(
    // First character: lowercase letter
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    // Remaining characters: lowercase letters, digits, underscores (0-31 chars)
    fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
      { minLength: 0, maxLength: 31 }
    )
  )
  .map(([first, rest]) => first + rest);

/**
 * Arbitrary for generating invalid command names
 */
const invalidCommandNameArbitrary = fc.oneof(
  // Empty string
  fc.constant(''),
  // Starts with digit
  fc.tuple(
    fc.constantFrom(...'0123456789'.split('')),
    fc.string({ minLength: 0, maxLength: 10 })
  ).map(([first, rest]) => first + rest),
  // Starts with uppercase
  fc.tuple(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    fc.string({ minLength: 0, maxLength: 10 })
  ).map(([first, rest]) => first + rest),
  // Starts with underscore
  fc.tuple(
    fc.constant('_'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), { minLength: 0, maxLength: 10 })
  ).map(([first, rest]) => first + rest),
  // Contains uppercase letters
  fc.tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { minLength: 1, maxLength: 5 })
  ).map(([first, rest]) => first + rest),
  // Contains special characters
  fc.tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.constantFrom(...'!@#$%^&*()-+=[]{}|;:,.<>?/~`'.split(''))
  ).map(([first, special]) => first + special),
  // Too long (more than 32 characters)
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    { minLength: 33, maxLength: 50 }
  )
);

describe('Command Registry Property Tests', () => {
  describe('Command Name Validation', () => {
    it('should accept valid command names matching the pattern', async () => {
      await fc.assert(
        fc.property(validCommandNameArbitrary, (name) => {
          const isValid = validateCommandName(name);
          const matchesPattern = /^[a-z][a-z0-9_]{0,31}$/.test(name);
          
          expect(isValid).toBe(true);
          expect(isValid).toBe(matchesPattern);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject invalid command names not matching the pattern', async () => {
      await fc.assert(
        fc.property(invalidCommandNameArbitrary, (name) => {
          const isValid = validateCommandName(name);
          const matchesPattern = /^[a-z][a-z0-9_]{0,31}$/.test(name);
          
          expect(isValid).toBe(false);
          expect(isValid).toBe(matchesPattern);
        }),
        { numRuns: 100 }
      );
    });

    it('should throw error when registering command with invalid name', async () => {
      await fc.assert(
        fc.property(invalidCommandNameArbitrary, (name) => {
          const registry = createCommandRegistry<TestContext>();
          const command: CommandDefinition<TestContext> = {
            name,
            description: 'Test command',
            handler: async () => {},
          };

          expect(() => registry.register(command)).toThrow(CommandValidationError);
        }),
        { numRuns: 100 }
      );
    });

    it('should successfully register command with valid name', async () => {
      await fc.assert(
        fc.property(validCommandNameArbitrary, (name) => {
          const registry = createCommandRegistry<TestContext>();
          const command: CommandDefinition<TestContext> = {
            name,
            description: 'Test command',
            handler: async () => {},
          };

          expect(() => registry.register(command)).not.toThrow();
          expect(registry.getCommand(name)).toBeDefined();
          expect(registry.getCommand(name)?.name).toBe(name);
        }),
        { numRuns: 100 }
      );
    });
  });


  describe('Command Routing Correctness', () => {
    it('should route /N to command N handler', async () => {
      await fc.assert(
        fc.asyncProperty(validCommandNameArbitrary, async (name) => {
          const registry = createCommandRegistry<TestContext>();
          let handlerCalled = false;
          let receivedCtx: TestContext | null = null;

          const command: CommandDefinition<TestContext> = {
            name,
            description: 'Test command',
            handler: async (ctx) => {
              handlerCalled = true;
              receivedCtx = ctx;
              ctx.handledBy = name;
            },
          };

          registry.register(command);

          const ctx: TestContext = {
            message: { text: `/${name}` },
          };

          const handled = await registry.route(ctx);

          expect(handled).toBe(true);
          expect(handlerCalled).toBe(true);
          expect(receivedCtx).toBe(ctx);
          expect(ctx.handledBy).toBe(name);
        }),
        { numRuns: 100 }
      );
    });

    it('should route /N@botname to command N handler', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCommandNameArbitrary,
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          async (name, botName) => {
            const registry = createCommandRegistry<TestContext>();
            let handlerCalled = false;

            const command: CommandDefinition<TestContext> = {
              name,
              description: 'Test command',
              handler: async (ctx) => {
                handlerCalled = true;
                ctx.handledBy = name;
              },
            };

            registry.register(command);

            const ctx: TestContext = {
              message: { text: `/${name}@${botName}` },
            };

            const handled = await registry.route(ctx);

            expect(handled).toBe(true);
            expect(handlerCalled).toBe(true);
            expect(ctx.handledBy).toBe(name);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return false for unregistered commands', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCommandNameArbitrary,
          validCommandNameArbitrary.filter(n => n !== 'registered'),
          async (registeredName, unregisteredName) => {
            // Skip if names are the same
            if (registeredName === unregisteredName) return;

            const registry = createCommandRegistry<TestContext>();

            const command: CommandDefinition<TestContext> = {
              name: registeredName,
              description: 'Test command',
              handler: async () => {},
            };

            registry.register(command);

            const ctx: TestContext = {
              message: { text: `/${unregisteredName}` },
            };

            const handled = await registry.route(ctx);

            expect(handled).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return false for non-command messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCommandNameArbitrary,
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.startsWith('/')),
          async (name, messageText) => {
            const registry = createCommandRegistry<TestContext>();

            const command: CommandDefinition<TestContext> = {
              name,
              description: 'Test command',
              handler: async () => {},
            };

            registry.register(command);

            const ctx: TestContext = {
              message: { text: messageText },
            };

            const handled = await registry.route(ctx);

            expect(handled).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return false for messages without text', async () => {
      await fc.assert(
        fc.asyncProperty(validCommandNameArbitrary, async (name) => {
          const registry = createCommandRegistry<TestContext>();

          const command: CommandDefinition<TestContext> = {
            name,
            description: 'Test command',
            handler: async () => {},
          };

          registry.register(command);

          // Context without message text
          const ctx1: TestContext = { message: {} };
          const ctx2: TestContext = {};

          expect(await registry.route(ctx1)).toBe(false);
          expect(await registry.route(ctx2)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should route to correct handler among multiple registered commands', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validCommandNameArbitrary, { minLength: 2, maxLength: 5 })
            .map(names => [...new Set(names)]) // Ensure unique names
            .filter(names => names.length >= 2),
          async (names) => {
            const registry = createCommandRegistry<TestContext>();
            const handlerCalls: string[] = [];

            // Register all commands
            for (const name of names) {
              const command: CommandDefinition<TestContext> = {
                name,
                description: `Command ${name}`,
                handler: async (ctx) => {
                  handlerCalls.push(name);
                  ctx.handledBy = name;
                },
              };
              registry.register(command);
            }

            // Pick a random command to invoke
            const targetName = names[0];
            const ctx: TestContext = {
              message: { text: `/${targetName}` },
            };

            const handled = await registry.route(ctx);

            expect(handled).toBe(true);
            expect(handlerCalls).toEqual([targetName]);
            expect(ctx.handledBy).toBe(targetName);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('extractCommandFromText', () => {
  it('should extract command name from /command format', () => {
    expect(extractCommandFromText('/start')).toBe('start');
    expect(extractCommandFromText('/help')).toBe('help');
  });

  it('should extract command name from /command@bot format', () => {
    expect(extractCommandFromText('/start@mybot')).toBe('start');
    expect(extractCommandFromText('/help@testbot')).toBe('help');
  });

  it('should extract command name ignoring arguments', () => {
    expect(extractCommandFromText('/start arg1 arg2')).toBe('start');
    expect(extractCommandFromText('/help topic')).toBe('help');
  });

  it('should return null for non-command text', () => {
    expect(extractCommandFromText('hello')).toBe(null);
    expect(extractCommandFromText('not a command')).toBe(null);
  });

  it('should return null for empty command', () => {
    expect(extractCommandFromText('/')).toBe(null);
  });
});
