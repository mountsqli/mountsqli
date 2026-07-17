// MountSQLI — core umbrella.
// Re-exports the minimal, tree-shakeable surface. Heavy subsystems
// (auth/storage/ai/studio) live in their own packages and are NOT
// re-exported here, keeping `mountsqli` < 100KB.

import { MountError, createDriver, listDrivers } from "@mountsqli/driver";
import type { Driver, TableDef, Transaction } from "@mountsqli/driver";
import { tableQuery, QueryBuilder, sql } from "@mountsqli/query";
import type { SqlQuery } from "@mountsqli/query";
import type { Compiled } from "@mountsqli/driver";
import { NodeSqliteDriver } from "@mountsqli/driver-sqlite";
import type { Table } from "@mountsqli/schema";
import { loadMountConfig, loadMountConfigWithFile, resolveConfigUrl } from "./config.js";
import { CacheManager, CacheBridge } from "@mountsqli/cache";

export interface MountConfig {
  tables: Table<any>[];
  driver?: string;
  url?: string;
  /** Path to a schema folder — auto-detected by loadMountConfig. */
  schema?: string;

  // Subsystem configs (passed through verbatim — each package owns its shape)
  ai?: Record<string, unknown>;
  api?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  realtime?: Record<string, unknown>;
  cache?: Record<string, unknown>;
  /** RLS enforcement (issue 003). */
  rls?: { enforce?: boolean; registry?: { has(name: string): boolean } };
}

export interface Db<TTables extends Table<any>[]> {
  tables: TTables;
  query<T extends Table<any>>(table: T): QueryBuilder<T>;
  sql<T = any>(q: SqlQuery): Promise<T[]>;
  raw(sql: string, params?: unknown[]): Promise<any[]>;
  /** The underlying driver (initialized). Exposed for advanced use. */
  readonly driver: Driver;
  close(): Promise<void>;

  /**
   * Run operations inside a database transaction. The callback receives the
   * same `Db` instance, but all queries use the transaction's connection.
   */
  transaction<R>(fn: (db: this) => Promise<R>): Promise<R>;

  /**
   * Execute multiple queries sequentially inside a transaction.
   * Returns an array of result arrays, one per query.
   */
  batch(queries: SqlQuery[]): Promise<any[][]>;

  /** Optional cache bridge — available when cache config is provided. */
  cache?: import("@mountsqli/cache").CacheBridge;

  /** RLS enforcement state (issue 003). When `rls.enforce` is true, executing
   * a query against a table registered in `rls.registry` without a policy
   * applied (`applyPolicy`) or `.unsafe()` throws. */
  rls?: { enforce: boolean; registry: { has(name: string): boolean } };

  /**
   * Optional subsystems. Attached by `mountsqliExtended` when their config
   * section is present. Declared structurally (no hard deps on auth/realtime/
   * storage packages) so `mountsqli` stays light and tree-shakeable.
   */
  auth?: {
    authenticate(token: string): Promise<{ ok: boolean; user?: { userId: string; role?: string }; reason?: string }>;
    [key: string]: unknown;
  };
  realtime?: {
    channel<TPayload = unknown>(name: string): {
      subscribe(cb: (payload: TPayload) => void): { unsubscribe(): void };
      publish(payload: TPayload): void;
    };
    [key: string]: unknown;
  };
  storage?: {
    upload(key: string, data: Uint8Array | Buffer | string, opts?: Record<string, unknown>): Promise<{ key: string }>;
    [key: string]: unknown;
  };
}

/**
 * Derive a fully-typed `Db` from a `defineConfig({...})` value.
 *
 * ```ts
 * const config = defineConfig({ driver, url, tables: [users, posts] });
 * type AppDb = DbFromConfig<typeof config>;
 * ```
 */
export type DbFromConfig<T> = T extends { tables: infer TTables extends Table<any>[] }
  ? Db<TTables>
  : Db<Table<any>[]>;

/**
 * Optional subsystems attached by `mountsqliExtended`. Declared structurally
 * (no hard deps on auth/realtime/storage) so the base `Db` stays light.
 */
export interface Subsystems {
  auth?: {
    authenticate(token: string): Promise<{ ok: boolean; user?: { userId: string; role?: string }; reason?: string }>;
    [key: string]: unknown;
  };
  realtime?: {
    channel<TPayload = unknown>(name: string): {
      subscribe(cb: (payload: TPayload) => void): { unsubscribe(): void };
      publish(payload: TPayload): void;
    };
    [key: string]: unknown;
  };
  storage?: {
    upload(key: string, data: Uint8Array | Buffer | string, opts?: Record<string, unknown>): Promise<{ key: string }>;
    [key: string]: unknown;
  };
  ai?: unknown;
}

function buildDriver(config: MountConfig): Driver {
  const driverName = config.driver ?? "sqlite:memory";
  const url = config.url;

  // SQLite is a hard dep in core — always available.
  if (driverName === "sqlite" || driverName === "sqlite:memory") {
    const u = url ?? ":memory:";
    if (u.length > 1024) {
      throw new MountError("CONFIG", "Database URL is too long");
    }
    return new NodeSqliteDriver(u) as unknown as Driver;
  }

  // Try the registry first (explicit import by the app).
  const known = listDrivers();
  if (known.includes(driverName)) {
    return createDriver(driverName);
  }

  // Driver not registered — give a clear error telling the user to import it.
  // Node.js CLI users get auto-loading via @mountsqli/cli's makeDriver().
  // Bundler users (Next.js Turbopack) must import the driver package once
  // before calling mountsqli() — see the error message below.
  throw new MountError("CONFIG",
    `MountSQLI: driver "${driverName}" is not registered. ` +
    `Install and import the matching driver package before mountsqli():\n` +
    `  npm i @mountsqli/driver-${driverName}\n` +
    `  import "@mountsqli/driver-${driverName}";`);
}

// ---------------------------------------------------------------------------
// Internal — creates a Db from a resolved MountConfig (not exported directly)
// ---------------------------------------------------------------------------

async function createDb(config: MountConfig): Promise<Db<typeof config.tables>> {
  const rawDriver = buildDriver(config);
  const tableDefs: TableDef[] = config.tables.map((t) => t.def as TableDef);
  // Chain init into the ready promise so await db.driver.ready waits for init.
  // Use Object.defineProperty instead of `(driver as any).ready =` to avoid
  // the race window and the readonly type violation.
  // Build a flat column type map merged from all tables.
  // Used by raw/sql paths to decode booleans when no plan.columnTypes is set.
  const mergedColumnTypes: Record<string, string> = {};
  for (const t of config.tables) {
    for (const [colName, builder] of Object.entries((t as any).__cols ?? {})) {
      const type = (builder as any).def.type ?? "text";
      if (!mergedColumnTypes[colName]) mergedColumnTypes[colName] = type;
    }
  }

  const initPromise = Promise.resolve(rawDriver.init(tableDefs).then(() => {
    // Store flat column types on the driver for raw/sql paths.
    (rawDriver as any).columnTypes = mergedColumnTypes;
  }));
  const origReady = Promise.resolve(rawDriver.ready);
  // Wrap the driver with a proxy that overrides .ready.
  const driver = new Proxy(rawDriver, {
    get(target, prop, receiver) {
      if (prop === "ready") return origReady.then(() => initPromise);
      return Reflect.get(target, prop, receiver);
    },
  });

  // RLS enforcement (issue 003): attach the registry + flag to the driver so
  // the query builder can refuse to run unguarded queries on protected tables.
  if (config.rls?.enforce && config.rls.registry) {
    (driver as any).rls = { enforce: true, registry: config.rls.registry };
  }

  const query = <T extends Table<any>>(table: T) => tableQuery(driver, table, config.tables as any[]);

  // Optionally create a cache bridge when cache config is provided.
  let cacheBridge: CacheBridge | undefined = undefined;
  if (config.cache) {
    const mgr = new CacheManager({ memory: { maxSize: (config.cache as any)?.maxSize ?? 1000 } });
    cacheBridge = new CacheBridge(mgr);
  }

  const db: Db<Table<any>[]> = {
    tables: config.tables,
    query,
    async sql<T = any>(q: SqlQuery): Promise<T[]> {
      await driver.ready;
      const compiled = q.compile();
      // Attach columnTypes from the driver so raw paths get proper bool decoding.
      if (!compiled.columnTypes && driver.columnTypes) {
        compiled.columnTypes = driver.columnTypes as any;
      }
      const r = await driver.query(compiled, "many");
      return r.rows as T[];
    },
    async raw(sqlStr: string, params: unknown[] = []): Promise<any[]> {
      await driver.ready;
      const compiled: Compiled = { sql: sqlStr, params };
      if (driver.columnTypes) {
        compiled.columnTypes = driver.columnTypes as any;
      }
      const r = await driver.query(compiled, "many");
      return r.rows;
    },
    driver,
    async close() {
      await driver.close();
    },
    async transaction<R>(fn: (db: Db<Table<any>[]>) => Promise<R>): Promise<R> {
      return driver.transaction(async (tx: Transaction) => {
        const txDb: any = { ...db };
        txDb.sql = async <T = any>(q: SqlQuery) => {
          const r = await tx.query(q.compile(), "many");
          return r.rows as T[];
        };
        txDb.raw = async (sqlStr: string, params: unknown[] = []) => {
          const r = await tx.query({ sql: sqlStr, params }, "many");
          return r.rows;
        };
        return fn(txDb as Db<Table<any>[]>);
      });
    },
    async batch(queries: SqlQuery[]): Promise<any[][]> {
      await driver.ready;
      const results: any[][] = [];
      for (const q of queries) {
        const r = await driver.query(q.compile(), "many");
        results.push(r.rows);
      }
      return results;
    },
    ...(cacheBridge ? { cache: cacheBridge } : {}),
  };
  return db;
}

/**
 * The one entry point. Works two ways:
 *
 * 1. **Inline config** — pass `{ driver, url, tables }` directly:
 *    ```ts
 *    const db = await mountsqli({ driver: "sqlite", url: ":memory:", tables: [users] });
 *    ```
 *
 * 2. **Zero-config** — no arguments; loads `mountsqli.config.js` (or legacy
 *    `mount.config.js`) by walking up from cwd:
 *    ```ts
 *    const db = await mountsqli();
 *    ```
 *
 * When `override` has a `tables` array, it is treated as an inline config
 * (no file loading). Otherwise `override` is merged on top of the file config
 * (e.g. a test can pass `{ url: ":memory:" }` to swap the database without
 * changing the file).
 *
 * Returns a ready-to-use `Db` with full type inference.
 */
export async function mountsqli(override: Partial<MountConfig> = {}): Promise<Db<Table<any>[]>> {
  // Inline config path: caller provides tables directly
  if (override.tables && override.tables.length > 0) {
    const db = await createDb(override as any);
    await db.driver.ready;
    return db;
  }
  // Zero-config path: load from file
  const { config: rawConfig, file } = await loadMountConfigWithFile();
  const merged: MountConfig = {
    driver: override.driver ?? rawConfig.driver,
    url: resolveConfigUrl(override.url ?? rawConfig.url, file),
    tables: rawConfig.tables,
  };
  const db = await createDb(merged as any);
  await db.driver.ready;
  return db;
}

/**
 * Like `mountsqli()` but also returns the full resolved config including
 * subsystem sections (ai, api, auth, storage, realtime, cache). Used by the
 * CLI's merged dev server (and tests that need access to parsed config).
 *
 * Works with inline config (when `override.tables` is set) or file-based
 * auto-load (when no `tables` in override).
 */
export async function mountsqliFull<const TTables extends Table<any>[]>(
  override: Partial<Omit<MountConfig, "tables">> & { tables?: TTables } = {},
): Promise<{ db: Db<TTables>; config: MountConfig }> {
  let merged: MountConfig;

  if (override.tables && override.tables.length > 0) {
    // Inline path
    merged = { ...override } as MountConfig;
  } else {
    // File path
    const { config: rawConfig, file } = await loadMountConfigWithFile();
    merged = {
      driver: override.driver ?? rawConfig.driver,
      url: resolveConfigUrl(override.url ?? rawConfig.url, file),
      tables: rawConfig.tables,

      ...(override.ai || rawConfig.ai ? { ai: (override.ai ?? rawConfig.ai) as Record<string, unknown> } : {}),
      ...(override.api || rawConfig.api ? { api: (override.api ?? rawConfig.api) as Record<string, unknown> } : {}),
      ...(override.auth || rawConfig.auth ? { auth: (override.auth ?? rawConfig.auth) as Record<string, unknown> } : {}),
      ...(override.storage || rawConfig.storage ? { storage: (override.storage ?? rawConfig.storage) as Record<string, unknown> } : {}),
      ...(override.realtime || rawConfig.realtime ? { realtime: (override.realtime ?? rawConfig.realtime) as Record<string, unknown> } : {}),
      ...(override.cache || rawConfig.cache ? { cache: (override.cache ?? rawConfig.cache) as Record<string, unknown> } : {}),
    };
  }

  const db = await createDb(merged as any);
  await db.driver.ready;
  return { db: db as Db<TTables>, config: merged };
}

/**
 * Extended entry point — returns a `Db` with optional subsystem namespaces
 * (.auth, .storage, .realtime, .ai, .cache) when their config sections are
 * provided. Subsystems are lazy-initialized on first access.
 *
 * ```ts
 * const db = await mountsqliExtended({ auth: { jwtSecret: "..." } });
 * await db.auth?.signUp(...);             // only if auth config provided
 * await db.storage?.upload("key", data);  // only if storage config provided
 * ```
 */
export async function mountsqliExtended<const TTables extends Table<any>[]>(
  override: Partial<Omit<MountConfig, "tables">> & { tables?: TTables } = {},
): Promise<Db<TTables> & Subsystems> {
  const { db, config } = await mountsqliFull<TTables>(override);

  // Lazy subsystem constructors — each import is async and optional.
  // Uses indirect eval to avoid TS module resolution — the packages are
  // optional peer deps, not hard dependencies of @mountsqli/core.
  const lazyImport = async (pkg: string): Promise<any> => {
    try { return await Function("pkg", "return import(pkg)")(pkg); } catch (e) {
      console.warn(`MountSQLI: optional package "${pkg}" not found — subsystem disabled. Install it to enable this feature.`, (e as Error)?.message ? `(${(e as Error).message})` : "");
      return undefined;
    }
  };

  const auth = config.auth ? await (async () => { const m = await lazyImport("@mountsqli/auth"); return m ? new m.Auth(config.auth) : undefined; })() : undefined;
  const storage = config.storage ? await (async () => { const m = await lazyImport("@mountsqli/storage"); return m ? new m.Storage(new m.MemoryStorage(), config.auth?.jwtKey ?? "dev-secret") : undefined; })() : undefined;
  const realtime = config.realtime ? await (async () => { const m = await lazyImport("@mountsqli/realtime"); return m ? new m.Hub() : undefined; })() : undefined;

  const extended = db as unknown as Db<TTables> & Subsystems;
  extended.auth = auth;
  extended.storage = storage;
  extended.realtime = realtime;
  extended.ai = undefined; // requires @mountsqli/ai with a provider
  return extended;
}

// --- schema + compiler re-exports ---
export { defineTable, createTableSQL } from "@mountsqli/schema";
export type {
  ColumnBuilder,
  ColumnDef,
  ColumnType,
  ForeignKeyDef,
  InferTable,
  Table,
  TableOptions,
  TypeMap,
} from "@mountsqli/schema";
export { int, text, real, bool, blob, json, uuid, timestamp, enum_ } from "@mountsqli/schema";
export { QueryBuilder, sql, eq, ne, gt, gte, lt, lte, like, inArray, isNull, and, or } from "@mountsqli/query";
export type { SqlQuery } from "@mountsqli/query";
export { compilePlan, emptyPlan, planKey, sqliteDialect, postgresDialect } from "@mountsqli/compiler";
export type { QueryPlan, Comparator, FilterNode, Compiled, WindowDef, OnConflict, FtsDef, JsonOp, AggregateDef } from "@mountsqli/compiler";
export { registerDriver, createDriver, listDrivers, MockDriver } from "@mountsqli/driver";
export type { Driver, Transaction, QueryResult, ExecuteMode, MockRecording } from "@mountsqli/driver";
export { NodeSqliteDriver, resolveSqliteUrl } from "@mountsqli/driver-sqlite";
export { defineConfig, loadMountConfig, loadMountConfigWithFile, resolveConfigUrl, findMountConfig, collectSchema, CONFIG_NAMES } from "./config.js";
