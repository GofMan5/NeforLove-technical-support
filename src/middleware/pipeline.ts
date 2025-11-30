/**
 * Middleware Pipeline
 * Provides priority-based middleware execution with next() chain control
 */

/**
 * Minimal context interface for middleware execution
 * In production, this would be extended from grammY's Context
 */
export interface MiddlewareContext {
  [key: string]: unknown;
}

/**
 * Next function type - calls the next middleware in the chain
 */
export type NextFunction = () => Promise<void>;

/**
 * Middleware handler function type
 */
export type MiddlewareHandler<T extends MiddlewareContext = MiddlewareContext> = (
  ctx: T,
  next: NextFunction
) => Promise<void>;

/**
 * Middleware definition with name, priority, and handler
 */
export interface MiddlewareDefinition<T extends MiddlewareContext = MiddlewareContext> {
  name: string;
  priority: number;
  handler: MiddlewareHandler<T>;
}

/**
 * Middleware pipeline interface
 */
export interface MiddlewarePipeline<T extends MiddlewareContext = MiddlewareContext> {
  use(middleware: MiddlewareDefinition<T>): void;
  remove(name: string): void;
  execute(ctx: T): Promise<void>;
  getOrderedMiddlewares(): MiddlewareDefinition<T>[];
}

export class MiddlewarePipelineImpl<T extends MiddlewareContext = MiddlewareContext>
  implements MiddlewarePipeline<T>
{
  private middlewares: Map<string, MiddlewareDefinition<T>> = new Map();

  /**
   * Register a middleware with priority-based ordering
   */
  use(middleware: MiddlewareDefinition<T>): void {
    this.middlewares.set(middleware.name, middleware);
  }

  /**
   * Remove a middleware by name
   */
  remove(name: string): void {
    this.middlewares.delete(name);
  }

  /**
   * Get middlewares sorted by priority (ascending)
   */
  getOrderedMiddlewares(): MiddlewareDefinition<T>[] {
    return Array.from(this.middlewares.values()).sort((a, b) => a.priority - b.priority);
  }

  async execute(ctx: T): Promise<void> {
    const ordered = this.getOrderedMiddlewares();
    
    if (ordered.length === 0) {
      return;
    }

    let index = 0;

    const runNext = async (): Promise<void> => {
      if (index >= ordered.length) {
        return;
      }

      const current = ordered[index];
      index++;

      await current.handler(ctx, runNext);
    };

    await runNext();
  }
}

/**
 * Factory function to create a new middleware pipeline
 */
export function createMiddlewarePipeline<T extends MiddlewareContext = MiddlewareContext>(): MiddlewarePipeline<T> {
  return new MiddlewarePipelineImpl<T>();
}
