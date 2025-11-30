/**
 * Property-based tests for Middleware Pipeline
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  type MiddlewareContext,
  type MiddlewareDefinition,
  createMiddlewarePipeline,
} from './pipeline.js';

// Test context that tracks execution order
interface TestContext extends MiddlewareContext {
  executionOrder: string[];
}

// Arbitrary for generating unique middleware names
const middlewareNameArbitrary = fc.string({ minLength: 1, maxLength: 20 })
  .filter(s => s.trim().length > 0);

// Arbitrary for generating priorities
const priorityArbitrary = fc.integer({ min: -1000, max: 1000 });

// Arbitrary for generating a list of unique middleware definitions
const middlewareListArbitrary = fc
  .array(
    fc.record({
      name: middlewareNameArbitrary,
      priority: priorityArbitrary,
    }),
    { minLength: 1, maxLength: 10 }
  )
  .map((items) => {
    // Ensure unique names by appending index
    return items.map((item, index) => ({
      name: `${item.name}_${index}`,
      priority: item.priority,
    }));
  });

describe('Middleware Pipeline Property Tests', () => {
  describe('Middleware Execution Order', () => {
    it('should execute middlewares in priority order (ascending)', async () => {
      await fc.assert(
        fc.asyncProperty(middlewareListArbitrary, async (middlewareSpecs) => {
          const pipeline = createMiddlewarePipeline<TestContext>();
          const ctx: TestContext = { executionOrder: [] };

          // Register middlewares that call next() and track execution
          for (const spec of middlewareSpecs) {
            const middleware: MiddlewareDefinition<TestContext> = {
              name: spec.name,
              priority: spec.priority,
              handler: async (context, next) => {
                context.executionOrder.push(spec.name);
                await next();
              },
            };
            pipeline.use(middleware);
          }

          await pipeline.execute(ctx);

          // Expected order: sorted by priority ascending
          const expectedOrder = [...middlewareSpecs]
            .sort((a, b) => a.priority - b.priority)
            .map((m) => m.name);

          expect(ctx.executionOrder).toEqual(expectedOrder);
        }),
        { numRuns: 100 }
      );
    });

    it('should stop chain when next() is not called', async () => {
      await fc.assert(
        fc.asyncProperty(
          middlewareListArbitrary,
          fc.integer({ min: 0, max: 9 }),
          async (middlewareSpecs, stopIndex) => {
            // Ensure stopIndex is within bounds
            const actualStopIndex = stopIndex % middlewareSpecs.length;
            
            const pipeline = createMiddlewarePipeline<TestContext>();
            const ctx: TestContext = { executionOrder: [] };

            // Sort specs by priority to know the execution order
            const sortedSpecs = [...middlewareSpecs].sort(
              (a, b) => a.priority - b.priority
            );

            // Register middlewares
            for (let i = 0; i < sortedSpecs.length; i++) {
              const spec = sortedSpecs[i];
              const shouldStop = i === actualStopIndex;

              const middleware: MiddlewareDefinition<TestContext> = {
                name: spec.name,
                priority: spec.priority,
                handler: async (context, next) => {
                  context.executionOrder.push(spec.name);
                  if (!shouldStop) {
                    await next();
                  }
                  // Not calling next() stops the chain
                },
              };
              pipeline.use(middleware);
            }

            await pipeline.execute(ctx);

            // Only middlewares up to and including stopIndex should execute
            const expectedOrder = sortedSpecs
              .slice(0, actualStopIndex + 1)
              .map((m) => m.name);

            expect(ctx.executionOrder).toEqual(expectedOrder);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should pass control to next middleware when next() is called', async () => {
      await fc.assert(
        fc.asyncProperty(middlewareListArbitrary, async (middlewareSpecs) => {
          const pipeline = createMiddlewarePipeline<TestContext>();
          const ctx: TestContext = { executionOrder: [] };
          let nextCallCount = 0;

          // Register middlewares that always call next()
          for (const spec of middlewareSpecs) {
            const middleware: MiddlewareDefinition<TestContext> = {
              name: spec.name,
              priority: spec.priority,
              handler: async (context, next) => {
                context.executionOrder.push(spec.name);
                nextCallCount++;
                await next();
              },
            };
            pipeline.use(middleware);
          }

          await pipeline.execute(ctx);

          // All middlewares should have executed
          expect(ctx.executionOrder.length).toBe(middlewareSpecs.length);
          expect(nextCallCount).toBe(middlewareSpecs.length);
        }),
        { numRuns: 100 }
      );
    });

    it('should support priority-based ordering during registration', async () => {
      await fc.assert(
        fc.asyncProperty(middlewareListArbitrary, async (middlewareSpecs) => {
          const pipeline = createMiddlewarePipeline<TestContext>();

          // Register in random order
          for (const spec of middlewareSpecs) {
            const middleware: MiddlewareDefinition<TestContext> = {
              name: spec.name,
              priority: spec.priority,
              handler: async (_ctx, next) => {
                await next();
              },
            };
            pipeline.use(middleware);
          }

          // Get ordered middlewares
          const ordered = pipeline.getOrderedMiddlewares();

          // Verify they are sorted by priority
          for (let i = 1; i < ordered.length; i++) {
            expect(ordered[i].priority).toBeGreaterThanOrEqual(ordered[i - 1].priority);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty pipeline gracefully', async () => {
      const pipeline = createMiddlewarePipeline<TestContext>();
      const ctx: TestContext = { executionOrder: [] };

      // Should not throw
      await expect(pipeline.execute(ctx)).resolves.toBeUndefined();
      expect(ctx.executionOrder).toEqual([]);
    });

    it('should allow middleware removal', async () => {
      await fc.assert(
        fc.asyncProperty(
          middlewareListArbitrary.filter((specs) => specs.length >= 2),
          async (middlewareSpecs) => {
            const pipeline = createMiddlewarePipeline<TestContext>();
            const ctx: TestContext = { executionOrder: [] };

            // Register all middlewares
            for (const spec of middlewareSpecs) {
              const middleware: MiddlewareDefinition<TestContext> = {
                name: spec.name,
                priority: spec.priority,
                handler: async (context, next) => {
                  context.executionOrder.push(spec.name);
                  await next();
                },
              };
              pipeline.use(middleware);
            }

            // Remove the first middleware (by sorted order)
            const sortedSpecs = [...middlewareSpecs].sort(
              (a, b) => a.priority - b.priority
            );
            const removedName = sortedSpecs[0].name;
            pipeline.remove(removedName);

            await pipeline.execute(ctx);

            // Removed middleware should not be in execution order
            expect(ctx.executionOrder).not.toContain(removedName);
            expect(ctx.executionOrder.length).toBe(middlewareSpecs.length - 1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
