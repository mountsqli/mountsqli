/**
 * Rate limiter — prevents brute force attacks.
 */

export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
}

export interface RateLimiterConfig {
  /** Max requests per window (default: 5) */
  maxRequests?: number;
  /** Window duration in ms (default: 15 minutes) */
  windowMs?: number;
}

/**
 * In-memory sliding window rate limiter.
 * For production, use Redis-backed implementation.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();
  private maxRequests: number;
  private windowMs: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config?: RateLimiterConfig) {
    this.maxRequests = config?.maxRequests ?? 5;
    this.windowMs = config?.windowMs ?? 15 * 60 * 1000; // 15 minutes

    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  async check(key: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      // New window
      const resetAt = now + this.windowMs;
      this.store.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt: new Date(resetAt),
      };
    }

    // Existing window
    entry.count++;
    return {
      allowed: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetAt: new Date(entry.resetAt),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
