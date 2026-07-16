// MountSQLI — Cache warming and background refresh engine.
//
// Automatic cache warming for frequently-used patterns, and
// stale-while-revalidate background refresh to avoid cache stampedes.

import type { CacheManager } from "./manager.js";
import type { WarmingConfig, BackgroundRefreshConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Cache warmer
// ---------------------------------------------------------------------------

export interface WarmingJob {
  /** Unique job name. */
  name: string;
  /** Fetch function to populate the cache. */
  fetch: () => Promise<unknown>;
  /** Cache key to store the result under. */
  cacheKey: string;
  /** TTL in seconds. */
  ttl?: number;
  /** Tags to attach. */
  tags?: string[];
  /** Interval in ms between warm cycles (default 300000). */
  intervalMs?: number;
  /** Only warm during these hours (0-23, optional). */
  scheduleHours?: number[];
}

export class CacheWarmer {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = false;

  constructor(
    private manager: CacheManager,
    private config: WarmingConfig = {},
  ) {}

  /** Start warming a specific job. */
  start(job: WarmingJob): void {
    if (this.timers.has(job.name)) return; // already running

    const interval = job.intervalMs ?? this.config.interval ?? 300_000;

    const run = async () => {
      if (this.running) return; // avoid concurrent runs
      this.running = true;
      try {
        const value = await job.fetch();
        await this.manager.set(job.cacheKey, value, {
          ttl: job.ttl,
          tags: job.tags,
        });
      } catch (e) {
        // Log but don't crash
        console.error(`[cache:warm] ${job.name} failed:`, (e as Error).message);
      } finally {
        this.running = false;
      }
    };

    // Run immediately, then on interval
    run();
    const timer = setInterval(run, interval);
    if (typeof timer === "object" && "unref" in timer) (timer as NodeJS.Timeout).unref();
    this.timers.set(job.name, timer);
  }

  /** Stop a warming job. */
  stop(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(name);
    }
  }

  /** Stop all warming jobs. */
  stopAll(): void {
    for (const [name] of this.timers) this.stop(name);
  }

  /** Whether a job is active. */
  isRunning(name: string): boolean {
    return this.timers.has(name);
  }

  /** List active job names. */
  activeJobs(): string[] {
    return [...this.timers.keys()];
  }
}

// ---------------------------------------------------------------------------
// Background refresh (stale-while-revalidate)
// ---------------------------------------------------------------------------

export interface RefreshEntry<T> {
  /** The value (possibly stale). */
  value: T;
  /** When the value was last refreshed. */
  refreshedAt: number;
  /** The refresh TTL — after this, serve stale and refresh in bg. */
  refreshTtlMs: number;
  /** The stale TTL — after this, reject entirely. */
  staleTtlMs: number;
}

export class BackgroundRefresher {
  private pendingRefreshes = new Map<string, Promise<unknown>>();
  private concurrent = 0;

  constructor(
    private config: BackgroundRefreshConfig = {},
  ) {}

  /**
   * Resolve a value with stale-while-revalidate semantics.
   *
   * 1) If the cached value is fresh (age < refreshTtl), return it.
   * 2) If the cached value is stale but acceptable (age < staleTtl),
   *    return it AND trigger a background refresh.
   * 3) If the cached value is too old or missing, wait for a fresh fetch.
   */
  async resolve<T>(
    key: string,
    fetch: () => Promise<T>,
    getCached: () => Promise<{ value: T; age: number } | undefined>,
    opts: { refreshTtlMs: number; staleTtlMs: number },
  ): Promise<{ value: T; fromCache: boolean; stale: boolean }> {
    const maxConcurrent = this.config.maxConcurrent ?? 5;
    const cached = await getCached();

    if (cached) {
      const age = cached.age;

      // Fresh enough — return immediately
      if (age < opts.refreshTtlMs) {
        return { value: cached.value, fromCache: true, stale: false };
      }

      // Stale but acceptable — return stale and refresh in background
      if (age < opts.staleTtlMs) {
        this.refreshInBackground(key, fetch, maxConcurrent);
        return { value: cached.value, fromCache: true, stale: true };
      }
    }

    // Too stale or missing — fetch fresh
    const value = await fetch();
    return { value, fromCache: false, stale: false };
  }

  private refreshInBackground<T>(key: string, fetch: () => Promise<T>, maxConcurrent: number): void {
    if (this.pendingRefreshes.has(key)) return; // already refreshing
    if (this.concurrent >= maxConcurrent) return;

    this.concurrent++;
    const promise = fetch().finally(() => {
      this.pendingRefreshes.delete(key);
      this.concurrent--;
    });
    this.pendingRefreshes.set(key, promise);
  }
}
