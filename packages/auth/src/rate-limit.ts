// MountSQLI — brute-force protection for the auth login path.
//
// The password verify itself is constant-time (scrypt), but without rate limiting
// an attacker can hammer `login` online. This provides a fixed-window limiter
// with an auto lockout after `maxAttempts` within `windowSec`. It is OPT-IN:
// pass `rateLimit` in your AuthConfig; without it, behavior is unchanged.

export interface RateLimiter {
  /** Record a failed attempt for `key` (e.g. userId or IP). Returns true if
   * the key is now locked out and further attempts should be rejected. */
  recordFailure(key: string): boolean;
  /** Returns true if `key` is currently locked out. */
  isLocked(key: string): boolean;
  /** Clear failures for `key` (call after a successful login). */
  reset(key: string): void;
}

export interface RateLimitConfig {
  /** Window length in seconds. */
  windowSec: number;
  /** Max failed attempts allowed within the window before lockout. */
  maxAttempts: number;
  /** How long a lockout lasts, in seconds. */
  lockoutSec: number;
}

interface Bucket {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

/** In-memory fixed-window limiter. Safe for a single process / instance. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private cfg: RateLimitConfig) {}

  private nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  isLocked(key: string): boolean {
    const b = this.buckets.get(key);
    if (!b) return false;
    if (b.lockedUntil > this.nowSec()) return true;
    // Lock expired — clear it so a fresh window can start.
    if (b.lockedUntil !== 0) {
      this.buckets.delete(key);
    }
    return false;
  }

  recordFailure(key: string): boolean {
    const now = this.nowSec();
    let b = this.buckets.get(key);
    if (!b || now - b.windowStart >= this.cfg.windowSec) {
      b = { count: 0, windowStart: now, lockedUntil: 0 };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (b.count >= this.cfg.maxAttempts) {
      b.lockedUntil = now + this.cfg.lockoutSec;
      return true;
    }
    return false;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
