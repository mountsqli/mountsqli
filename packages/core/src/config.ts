// MountSQLI — unified config loader.
//
// One config file (`mountsqli.config.js`) drives every subsystem: database,
// auth, storage, realtime, AI, API, Studio. The file is a real ES module so
// you author tables with `defineTable(...)` and get full type-safety — no
// serialized JSON schema. `loadMountConfig()` is the single source of truth:
// the CLI calls it, and your app calls it too.
//
//   // mountsqli.config.js
//   export default {
//     driver: "sqlite",
//     url: "./dev.db",
//     schema: "./schema",   // auto-detect every `export const x = defineTable(...)`
//
//     // (optional) subsystem configs passed through to the engine:
//     ai:    { provider: "openai", model: "gpt-4o" },
//     api:   { prefix: "/api", cors: true },
//     auth:  { jwtSecret: "…" },
//     storage: { bucket: "my-bucket" },
//     realtime: { maxChannels: 100 },
//   };
//
//   // app.ts
//   import { mountsqli } from "@mountsqli/core";
//   const db = await mountsqli(await loadMountConfig());

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "node:fs/promises";
import { MountError } from "@mountsqli/driver";
import type { Table } from "@mountsqli/schema";

// ---------------------------------------------------------------------------
// Full config shape
// ---------------------------------------------------------------------------

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
  /** RLS enforcement (issue 003). `enforce: true` throws if a query hits a
   * table with a registered policy without `applyPolicy(...)`/`.unsafe()`. */
  rls?: { enforce?: boolean; registry?: { has(name: string): boolean } };
}

/**
 * Typed helper for authoring `mountsqli.config.js`. Returns the config object
 * as-is — zero runtime cost, purely for type inference.
 *
 * Generic over the schema tuple so the table types survive into `mountsqliFull`
 * and `DbFromConfig<typeof config>` keeps `db.query(t)` fully typed.
 *
 * ```ts
 * // mountsqli.config.ts
 * import { defineConfig } from "@mountsqli/core";
 * export default defineConfig({
 *   driver: "sqlite",
 *   url: "./dev.db",
 *   tables: [users, posts],
 * });
 * ```
 */
export function defineConfig<const TTables extends Table<any>[]>(
  config: Omit<MountConfig, "tables"> & { tables: TTables },
): Omit<MountConfig, "tables"> & { tables: TTables } {
  return config;
}

/** Candidate filenames in search priority. `mountsqli.config.js` is the recommended form. */
export const CONFIG_NAMES = [
  "mountsqli.config.js",
  "mountsqli.config.mjs",
  "mountsqli.config.cjs",
  "mountsqli.config.ts",
  "mountsqli.config.json",

  // Legacy — still auto-detected so existing projects keep working:
  "mount.config.js",
  "mount.config.mjs",
  "mount.config.cjs",
  "mount.config.ts",
  "mount.config.json",
] as const;

/**
 * Find the nearest config file by walking UP from `cwd`. Falls back to
 * searching from the entry script's directory (`process.argv[1]`) when the
 * cwd walk yields nothing — this covers cases where the process is launched
 * from a monorepo root but the script lives in a sub-project.
 */
export function findMountConfig(cwd: string = process.cwd()): string | null {
  const searchDirs = [resolve(cwd)];
  const entry = process.argv[1];
  if (entry) {
    const entryDir = resolve(entry, "..");
    // Avoid searching the same directory twice.
    if (entryDir !== searchDirs[0]) searchDirs.push(entryDir);
  }
  for (const start of searchDirs) {
    let dir = start;
    for (;;) {
      for (const name of CONFIG_NAMES) {
        const p = join(dir, name);
        if (existsSync(p)) return p;
      }
      const parent = join(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * Load a MountSQLI config. With no `path`, auto-discovers `mountsqli.config.*`
 * (or legacy `mount.config.*`) by walking up from `cwd`.
 *
 * `.js/.mjs/.cjs/.ts` are imported as ES modules (default export or named
 * `config`/`mount`); `.json` is parsed.
 *
 * If the config has a `schema` field, every `defineTable(...)` export in that
 * folder/glob is auto-collected into `tables`.
 *
 * Returns a `MountConfig` ready to pass to `mount()`.
 */
export async function loadMountConfig(path?: string): Promise<MountConfig> {
  const file = path && path.trim() ? path : findMountConfig();
  if (!file) {
    throw new MountError("CONFIG",
      "MountSQLI: no mountsqli.config.{js,json} found (searched upward from cwd). Run `mount init` to scaffold one.",
    );
  }
  const abs = resolve(file);
  const ext = extname(abs);
  let raw: any;
  if (ext === ".json") {
    try {
      raw = JSON.parse(readFileSync(abs, "utf8"));
    } catch (e) {
      throw new MountError("CONFIG", `MountSQLI: failed to parse "${file}" — invalid JSON.`);
    }
  } else {
    let mod: any;
    try {
      mod = await import(/* turbopackIgnore: true */ pathToFileURL(abs).href);
    } catch (e) {
      throw new MountError("CONFIG",
        `MountSQLI: failed to load "${file}". Check for syntax errors or missing dependencies.`,
      );
    }
    raw = mod.default ?? mod.config ?? mod.mount;
    if (raw === undefined) {
      throw new MountError("CONFIG",
        `MountSQLI: ${file} must \`export default\` a config object with a \`tables\` array or a \`schema\` folder.`,
      );
    }
  }
  return normalize(raw, abs);
}

/**
 * Resolve a config `url` to an absolute path when it is a relative file path,
 * so the engine opens the intended database regardless of the process cwd.
 * Absolute paths, `:memory:`, and `scheme://` URLs are returned unchanged.
 */
export function resolveConfigUrl(url: string | undefined, configFile: string): string {
  const u = url ?? ":memory:";
  if (u === ":memory:" || /^[a-z]+:\/\//.test(u) || isAbsolute(u)) return u;
  return resolve(configFile, "..", u);
}

/** Like `loadMountConfig` but also returns the resolved config file path. */
export async function loadMountConfigWithFile(path?: string): Promise<{ config: MountConfig; file: string }> {
  const file = path && path.trim() ? path : findMountConfig();
  if (!file) throw new MountError("CONFIG", "MountSQLI: no mountsqli.config.{js,json} found (searched upward from cwd). Run `mount init` to scaffold one.");
  const config = await loadMountConfig(file);
  return { config, file: resolve(file) };
}

// ---------------------------------------------------------------------------
// Schema auto-collection
// ---------------------------------------------------------------------------

/**
 * Collect `Table` objects from a schema folder or glob. Any named export that
 * is a `defineTable(...)` result (has a `.def` shaped like a TableDef) is
 * included. Modules without such exports are ignored.
 */
export async function collectSchema(schema: string, fromFile: string): Promise<Table[]> {
  const base = resolve(fromFile, "..", schema);
  const files: string[] = [];

  const isGlob = /[*?{}[\]]/.test(schema);

  if (existsSync(base) && statSync(base).isDirectory()) {
    walkDir(base, files);
  } else if (isGlob) {
    for await (const f of glob(schema, { cwd: resolve(fromFile, "..") })) {
      files.push(resolve(fromFile, "..", f));
    }
  } else if (existsSync(base)) {
    files.push(base);
  }

  const tables: Table[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!/\.(js|mjs|cjs|ts)$/.test(f)) continue;
    if (f.endsWith(".d.ts")) continue;
    const mod = await import(/* turbopackIgnore: true */ pathToFileURL(resolve(f)).href);
    for (const value of Object.values(mod as Record<string, unknown>)) {
      if (isTable(value) && !seen.has(value.def.name)) {
        seen.add(value.def.name);
        tables.push(value as Table);
      }
    }
  }
  return tables;
}

function walkDir(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkDir(p, out);
    else if (/\.(js|mjs|cjs|ts)$/.test(p) && !p.endsWith(".d.ts")) out.push(p);
  }
}

function isTable(v: unknown): v is Table & { def: { name: string } } {
  return (
    !!v &&
    typeof v === "object" &&
    "def" in v &&
    !!v.def &&
    typeof (v as any).def === "object" &&
    typeof (v as any).def.name === "string"
  );
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

async function normalize(raw: any, configFile: string): Promise<MountConfig> {
  if (!raw || typeof raw !== "object") {
    throw new MountError("CONFIG", "MountSQLI: config must be an object with a `tables` array or a `schema` folder.");
  }
  let tables: Table[] = Array.isArray(raw.tables)
    ? raw.tables.map((t: any) => (isTable(t) ? t : { def: t }))
    : [];

  // Only auto-collect from schema folder when no explicit tables are provided.
  // This avoids dynamic import() calls that bundlers like Turbopack cannot trace,
  // and prevents conflicts when schema files use path aliases (e.g. @/).
  if (raw.schema && tables.length === 0) {
    const fromSchema = await collectSchema(raw.schema, configFile);
    tables = [...tables, ...fromSchema];
  }

  if (tables.length === 0) {
    throw new MountError("CONFIG",
      `MountSQLI: config has no tables. Add a \`tables\` array or point \`schema\` at a folder of \`defineTable(...)\` modules.`,
    );
  }

  const byName = new Map<string, Table>();
  for (const t of tables) {
    const existing = byName.get(t.def.name);
    if (existing && JSON.stringify(existing.def) !== JSON.stringify(t.def)) {
      throw new MountError("CONFIG", `MountSQLI: duplicate table "${t.def.name}" with conflicting definitions.`);
    }
    byName.set(t.def.name, t);
  }

  return {
    driver: raw.driver,
    url: raw.url ?? ":memory:",
    tables: [...byName.values()],
    // subsystem configs passed through verbatim
    ...(raw.ai ? { ai: raw.ai as Record<string, unknown> } : {}),
    ...(raw.api ? { api: raw.api as Record<string, unknown> } : {}),
    ...(raw.auth ? { auth: raw.auth as Record<string, unknown> } : {}),
    ...(raw.storage ? { storage: raw.storage as Record<string, unknown> } : {}),
    ...(raw.realtime ? { realtime: raw.realtime as Record<string, unknown> } : {}),
    ...(raw.cache ? { cache: raw.cache as Record<string, unknown> } : {}),
  };
}
