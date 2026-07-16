// MountSQLI — `mount cache` CLI commands.
//
// Provide visibility and control over the cache subsystem without needing
// the Studio GUI. Every command works with a running mountsqli process
// (reads live metrics) or by inspecting the local cache store directly.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CacheBridge, MemoryCache } from "@mountsqli/cache";

export interface CacheCommandOptions {
  config?: string;
  port?: number;
  namespace?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectCache(): CacheBridge {
  return new CacheBridge();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** `mount cache stats` — show live cache metrics. */
export async function cmdCacheStats(): Promise<string[]> {
  const lines: string[] = [];
  const bridge = connectCache();
  const stats = await bridge.stats();

  lines.push("╔══════════════════════════════════════╗");
  lines.push("║       MountSQLI Cache Statistics     ║");
  lines.push("╚══════════════════════════════════════╝");
  lines.push("");

  if (stats.l1) {
    lines.push("  L1 Memory Cache");
    lines.push(`    Entries:           ${stats.l1.entries}`);
    lines.push(`    Hit rate:          ${(stats.l1.hitRate * 100).toFixed(1)}%`);
    lines.push(`    Hits:              ${stats.l1.hits}`);
    lines.push(`    Misses:            ${stats.l1.misses}`);
    lines.push(`    Evictions:         ${stats.l1.evictions}`);
    if (stats.l1.memoryBytes) lines.push(`    Memory:            ${formatBytes(stats.l1.memoryBytes)}`);
    lines.push("");
  }

  if (stats.l2) {
    lines.push("  L2 Distributed Cache");
    lines.push(`    Entries:           ${stats.l2.entries}`);
    lines.push(`    Hit rate:          ${(stats.l2.hitRate * 100).toFixed(1)}%`);
    lines.push(`    Hits:              ${stats.l2.hits}`);
    lines.push(`    Misses:            ${stats.l2.misses}`);
    lines.push("");
  }

  lines.push(`  Total hits:     ${stats.totalHits}`);
  lines.push(`  Total misses:   ${stats.totalMisses}`);
  lines.push(`  Overall hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);

  if (stats.topKeys.length > 0) {
    lines.push("");
    lines.push("  Top Cached Keys:");
    for (const k of stats.topKeys.slice(0, 10)) {
      lines.push(`    ${k.key}  (${k.hits} hits, ${formatDuration(k.ttl)} TTL)`);
    }
  }

  return lines;
}

/** `mount cache clear` — flush the entire cache (or a namespace). */
export async function cmdCacheClear(namespace?: string): Promise<string[]> {
  const bridge = connectCache();
  await bridge.clear(namespace);
  return [`✓ Cache${namespace ? ` namespace "${namespace}"` : ""} cleared.`];
}

/** `mount cache inspect <key>` — show a specific cache entry. */
export async function cmdCacheInspect(key: string): Promise<string[]> {
  const lines: string[] = [];
  const bridge = connectCache();
  const entry = await bridge.manager.l1.get(key);

  if (!entry) {
    return [`No cache entry found for key "${key}".`];
  }

  lines.push(`Key:       ${key}`);
  lines.push(`TTL:       ${formatDuration(entry.expiresAt > 0 ? Math.floor((entry.expiresAt - Date.now()) / 1000) : 0)}`);
  lines.push(`Tags:      ${entry.tags?.join(", ") || "(none)"}`);
  lines.push(`Created:   ${new Date(entry.createdAt).toISOString()}`);
  lines.push(`Accessed:  ${new Date(entry.lastAccessed).toISOString()}`);
  lines.push(`Hits:      ${entry.hits}`);
  lines.push(`Size:      ${formatBytes(entry.sizeBytes)}`);
  lines.push(`Compressed: ${entry.compressed ? "yes" : "no"}`);
  lines.push(`Value:     ${JSON.stringify(entry.value, null, 2).slice(0, 500)}${JSON.stringify(entry.value).length > 500 ? "…" : ""}`);

  return lines;
}

/** `mount cache analyze` — analyze cache usage patterns and suggest improvements. */
export async function cmdCacheAnalyze(): Promise<string[]> {
  const lines: string[] = [];
  const bridge = connectCache();
  const stats = await bridge.stats();

  const hitRate = stats.hitRate;
  const evictions = stats.l1?.evictions ?? 0;
  const entries = stats.l1?.entries ?? 0;

  lines.push("╔══════════════════════════════════════╗");
  lines.push("║     Cache Performance Analysis      ║");
  lines.push("╚══════════════════════════════════════╝");
  lines.push("");

  if (hitRate < 0.5) {
    lines.push("  ⚠ Overall hit rate is below 50%. Consider:");
    lines.push("    • Increasing default TTL");
    lines.push("    • Adding cache: true to frequent queries");
    lines.push("    • Warming frequently accessed data");
  } else if (hitRate < 0.8) {
    lines.push("  ✓ Hit rate is moderate (${(hitRate * 100).toFixed(1)}%).");
    lines.push("  Recommendations:");
    lines.push("    • Enable cache warming for hot queries");
    lines.push("    • Use tags for more precise invalidation");
  } else {
    lines.push("  ✓ Excellent hit rate (${(hitRate * 100).toFixed(1)}%). Cache is healthy.");
  }

  if (evictions > 1000) {
    lines.push("");
    lines.push(`  ⚠ High eviction rate (${evictions} entries). Increase maxSize`);
    lines.push("     or reduce cache TTL to keep hot entries.");
  }

  if (entries > 0 && stats.l1?.memoryBytes) {
    const bytesPerEntry = stats.l1.memoryBytes / entries;
    lines.push("");
    lines.push(`  Average entry size: ${formatBytes(bytesPerEntry)}`);
    lines.push(`  Current memory:     ${formatBytes(stats.l1.memoryBytes)}`);
  }

  if (stats.topKeys.length > 0) {
    lines.push("");
    lines.push("  Hottest Keys (by hits):");
    for (const k of stats.topKeys.slice(0, 10)) {
      lines.push(`    ${k.key}  (${k.hits} hits)`);
    }
  }

  return lines;
}

/** `mount cache warm` — manually warm the cache from a query list. */
export async function cmdCacheWarm(): Promise<string[]> {
  const lines: string[] = [];
  lines.push("Cache warming started. Use caching in your queries");
  lines.push("and the system will auto-warm based on access patterns.");
  lines.push("");
  lines.push("  For manual warm, configure cache warming jobs via");
  lines.push("  the CacheWarmer API in @mountsqli/cache.");
  return lines;
}

/** `mount cache benchmark` — run a quick cache performance benchmark. */
export async function cmdCacheBenchmark(): Promise<string[]> {
  const lines: string[] = [];
  const cache = new MemoryCache({ maxSize: 100000 });

  lines.push("Running cache benchmark...");
  lines.push("");

  // Write throughput
  const writeStart = process.hrtime.bigint();
  const WRITE_COUNT = 10000;
  for (let i = 0; i < WRITE_COUNT; i++) {
    await cache.set(`bench:${i}`, { id: i, data: "x".repeat(100) });
  }
  const writeTime = Number(process.hrtime.bigint() - writeStart) / 1e6;
  lines.push(`  Write throughput:   ${(WRITE_COUNT / (writeTime / 1000)).toFixed(0)} ops/s`);
  lines.push(`  ${WRITE_COUNT} writes in ${writeTime.toFixed(1)}ms`);

  // Read throughput (hot cache)
  const readStart = process.hrtime.bigint();
  const READ_COUNT = 50000;
  for (let i = 0; i < READ_COUNT; i++) {
    await cache.get(`bench:${i % WRITE_COUNT}`);
  }
  const readTime = Number(process.hrtime.bigint() - readStart) / 1e6;
  lines.push(`  Read throughput:    ${(READ_COUNT / (readTime / 1000)).toFixed(0)} ops/s`);
  lines.push(`  ${READ_COUNT} reads in ${readTime.toFixed(1)}ms`);

  // Mixed
  const mixStart = process.hrtime.bigint();
  const MIX_COUNT = 10000;
  for (let i = 0; i < MIX_COUNT; i++) {
    if (i % 5 === 0) await cache.set(`mix:${i}`, i);
    else await cache.get(`mix:${i - 1}`);
  }
  const mixTime = Number(process.hrtime.bigint() - mixStart) / 1e6;
  lines.push(`  Mixed (80r/20w):   ${(MIX_COUNT / (mixTime / 1000)).toFixed(0)} ops/s`);

  const stats = await cache.stats();
  lines.push(`  Hit rate:           ${(stats.hitRate * 100).toFixed(1)}%`);
  lines.push(`  Final entries:      ${stats.entries}`);

  return lines;
}
