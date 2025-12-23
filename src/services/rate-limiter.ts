/**
 * Rate Limiter Service
 * Prevents spam and abuse with sliding window rate limiting
 */

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimiter {
  /** Check if action is allowed, returns true if allowed */
  check(key: string): boolean;
  /** Reset rate limit for a key */
  reset(key: string): void;
  /** Cleanup expired entries */
  cleanup(): number;
}

interface RateLimitEntry {
  timestamps: number[];
  lastCleanup: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60000, // 1 minute
};

// Cleanup interval - run every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
// Max entries before forced cleanup
const MAX_ENTRIES = 10000;

/**
 * Creates a rate limiter instance with automatic cleanup
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}): RateLimiter {
  const { maxRequests, windowMs } = { ...DEFAULT_CONFIG, ...config };
  const entries = new Map<string, RateLimitEntry>();
  let lastGlobalCleanup = Date.now();

  const cleanupEntry = (entry: RateLimitEntry, now: number): number[] => {
    const cutoff = now - windowMs;
    return entry.timestamps.filter(ts => ts > cutoff);
  };

  const maybeGlobalCleanup = () => {
    const now = Date.now();
    if (now - lastGlobalCleanup > CLEANUP_INTERVAL || entries.size > MAX_ENTRIES) {
      cleanup();
      lastGlobalCleanup = now;
    }
  };

  const cleanup = (): number => {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of entries) {
      const valid = cleanupEntry(entry, now);
      if (valid.length === 0) {
        entries.delete(key);
        removed++;
      } else {
        entry.timestamps = valid;
        entry.lastCleanup = now;
      }
    }
    
    return removed;
  };

  return {
    check(key: string): boolean {
      maybeGlobalCleanup();
      
      const now = Date.now();
      let entry = entries.get(key);
      
      if (!entry) {
        entry = { timestamps: [], lastCleanup: now };
        entries.set(key, entry);
      }
      
      // Cleanup old timestamps for this entry
      entry.timestamps = cleanupEntry(entry, now);
      
      // Check if under limit
      if (entry.timestamps.length >= maxRequests) {
        return false;
      }
      
      // Add current timestamp
      entry.timestamps.push(now);
      return true;
    },

    reset(key: string): void {
      entries.delete(key);
    },

    cleanup,
  };
}

// Pre-configured limiters for different actions
export const rateLimiters = {
  /** Ticket creation: 3 per minute */
  ticketCreation: createRateLimiter({ maxRequests: 3, windowMs: 60000 }),
  /** Messages: 20 per minute */
  messages: createRateLimiter({ maxRequests: 20, windowMs: 60000 }),
  /** Callbacks: 30 per minute */
  callbacks: createRateLimiter({ maxRequests: 30, windowMs: 60000 }),
  /** Commands: 10 per minute */
  commands: createRateLimiter({ maxRequests: 10, windowMs: 60000 }),
};
