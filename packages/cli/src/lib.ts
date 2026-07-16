// MountSQLI — CLI engine (framework-agnostic logic; bin.ts wires commander).

import { NodeSqliteDriver } from "@mountsqli/driver-sqlite";
import { MountError } from "@mountsqli/driver";
import type { Driver } from "@mountsqli/driver";
import { Migrator, type Change } from "@mountsqli/migration";
import type { QueryPlan } from "@mountsqli/compiler";
import type { TableDef } from "@mountsqli/schema";
import { loadMountConfig } from "@mountsqli/core";

export interface CliConfig {
  driver: "sqlite" | "postgres" | "mysql";
  url: string;
  tables: TableDef[];
  /** Pass-through from mountsqli.config.js's `api` section. */
  api?: Record<string, unknown>;
}

const VALID_DRIVERS = new Set(["sqlite", "postgres", "mysql"]);

/**
 * Load config for the CLI. Accepts a `.js`/`.mjs`/`.cjs`/`.ts` (real module
 * using `defineTable`) or legacy `.json` snapshot. Auto-discovers
 * `mountsqli.config.*` (or legacy `mount.config.*`) in the cwd when `path` is omitted.
 */
export async function loadConfig(path?: string): Promise<CliConfig> {
  const cfg = await loadMountConfig(path);
  const driver = (cfg.driver ?? "sqlite") as string;
  if (!VALID_DRIVERS.has(driver)) {
    throw new MountError("CONFIG", `CLI does not support driver "${driver}" — try sqlite, postgres, or mysql`);
  }
  const tables: TableDef[] = cfg.tables.map((t: { def: TableDef }) => t.def);
  const url = cfg.url ?? ":memory:";
  return { driver: driver as "sqlite" | "postgres" | "mysql", url, tables, api: cfg.api ?? undefined };
}

export async function makeDriver(cfg: CliConfig): Promise<Driver> {
  if (cfg.driver === "sqlite") {
    return new NodeSqliteDriver(cfg.url) as unknown as Driver;
  }
  if (cfg.driver === "postgres") {
    // Lazily import the optional driver package so the CLI core stays light.
    const { PostgresDriver } = await import("@mountsqli/driver-postgres");
    return new PostgresDriver({ url: cfg.url || process.env.DATABASE_URL }) as unknown as Driver;
  }
  if (cfg.driver === "mysql") {
    const { MysqlDriver } = await import("@mountsqli/driver-mysql");
    return new MysqlDriver({ url: cfg.url || process.env.DATABASE_URL }) as unknown as Driver;
  }
  throw new MountError("CONFIG", `MountSQLI: unsupported CLI driver "${cfg.driver}". Install the matching @mountsqli/driver-* package.`);
}

export interface MigrateResult {
  ok: boolean;
  lines: string[];
}

// `mount migrate generate` — print the SQL that would bring the DB from its
// current (introspected) schema up to the configured schema.
export async function cmdGenerate(cfg: CliConfig): Promise<MigrateResult> {
  const driver = await makeDriver(cfg);
  const lines: string[] = [];
  const { introspectorFor, diffSchemas, generateMigrationSQL } = await import("@mountsqli/migration");
  const current = await introspectorFor(cfg.driver).introspect(driver);
  const diff = diffSchemas(current, cfg.tables);
  const gen = generateMigrationSQL(diff, cfg.driver);
  if (gen.up.length === 0) {
    lines.push("✓ Schema already in sync — nothing to generate.");
  } else {
    lines.push(`-- MountSQLI migration (${gen.requiresReview ? "DESTRUCTIVE — review required" : "safe"})`);
    for (const sql of gen.up) lines.push(sql);
  }
  await driver.close();
  return { ok: true, lines };
}

// `mount migrate apply` — apply pending diff and record it.
export async function cmdApply(cfg: CliConfig, opts: { allowDestructive?: boolean } = {}): Promise<MigrateResult> {
  const driver = await makeDriver(cfg);
  const lines: string[] = [];
  const { introspectorFor, diffSchemas, generateMigrationSQL } = await import("@mountsqli/migration");
  const migrator = new Migrator(driver);
  await migrator.ensureTable();
  const current = await introspectorFor(cfg.driver).introspect(driver);
  const diff = diffSchemas(current, cfg.tables);
  const gen = generateMigrationSQL(diff, cfg.driver);
  if (gen.up.length === 0) {
    lines.push("✓ Schema already in sync.");
    await driver.close();
    return { ok: true, lines };
  }
  try {
    await migrator.apply({ name: `auto_${Date.now()}`, diff, dialect: cfg.driver }, { allowDestructive: opts.allowDestructive });
    lines.push(`✓ Applied migration (${gen.up.length} statement(s)).`);
  } catch (e) {
    lines.push(`✗ ${(e as Error).message}`);
    await driver.close();
    return { ok: false, lines };
  }
  await driver.close();
  return { ok: true, lines };
}

// `mount migrate status` — show applied migrations.
export async function cmdStatus(cfg: CliConfig): Promise<MigrateResult> {
  const driver = await makeDriver(cfg);
  const lines: string[] = [];
  const migrator = new Migrator(driver);
  await migrator.ensureTable();
  const recs = await migrator.applied();
  if (recs.length === 0) lines.push("No migrations applied yet.");
  else for (const r of recs) lines.push(`• ${r.name}  (${r.applied_at})`);
  await driver.close();
  return { ok: true, lines };
}

// `mount migrate down` — roll back the last migration using generated down SQL.
export async function cmdDown(cfg: CliConfig): Promise<MigrateResult> {
  const driver = await makeDriver(cfg);
  const lines: string[] = [];
  const { generateMigrationSQL, introspectorFor, diffSchemas } = await import("@mountsqli/migration");
  const migrator = new Migrator(driver);
  await migrator.ensureTable();
  const recs = await migrator.applied();
  if (recs.length === 0) {
    lines.push("✓ No migrations to roll back.");
    await driver.close();
    return { ok: true, lines };
  }
  const last = recs[recs.length - 1]!;
  // Generate the inverse migration: diff current schema back toward the target.
  const current = await introspectorFor(cfg.driver).introspect(driver);
  const diff = diffSchemas(cfg.tables, current); // swapped: target -> current = reverse
  const gen = generateMigrationSQL(diff, cfg.driver);
  if (gen.down.length === 0 && gen.up.length === 0) {
    lines.push(`✓ No schema changes to revert for "${last.name}".`);
  } else {
    // Try to apply the down SQL
    const downSql = gen.down.length > 0 ? gen.down : gen.up.map(s => `-- ${s} (no automatic inverse)`);
    try {
      const ok = await migrator.rollbackLast(downSql, {});
      if (ok) lines.push(`✓ Rolled back "${last.name}".`);
    } catch (e) {
      lines.push(`✗ ${(e as Error).message}`);
      lines.push(`  Provide down SQL manually or check the migration record.`);
      await driver.close();
      return { ok: false, lines };
    }
  }
  await driver.close();
  return { ok: true, lines };
}

// ---- observability: analyze ----

export interface AnalyzeResult {
  ok: boolean;
  lines: string[];
}

// `mount analyze` — advisory health report from the compiler optimizer +
// migration introspection, without mutating the database.
export async function cmdAnalyze(cfg: CliConfig, opts: { plans?: QueryPlan[] } = {}): Promise<AnalyzeResult> {
  const driver = await makeDriver(cfg);
  const lines: string[] = [];

  const { introspectorFor, diffSchemas, generateMigrationSQL } = await import("@mountsqli/migration");
  const { suggestIndexes, optimize } = await import("@mountsqli/compiler");

  // 1) Drift: live schema vs configured target.
  const current = await introspectorFor(cfg.driver).introspect(driver);
  const drift = diffSchemas(current, cfg.tables);
  const gen = generateMigrationSQL(drift, cfg.driver);
  lines.push(`Schema drift: ${drift.changes.length === 0 ? "none (in sync)" : `${drift.changes.length} change(s)${gen.requiresReview ? " — REVIEW REQUIRED (destructive)" : ""}`}`);
  if (drift.changes.length) {
    for (const c of drift.changes.slice(0, 20)) lines.push(`  • ${describeChange(c)}`);
  }

  // 2) Index suggestions from observed/declared query plans.
  const plans = opts.plans ?? defaultPlans(cfg.tables);
  const idx = suggestIndexes(plans);
  lines.push(`Index suggestions: ${idx.length}`);
  for (const i of idx) lines.push(`  • CREATE INDEX ON ${i.table} (${i.columns.join(", ")}) — ${i.reason}`);

  // 3) Plan-level warnings (SELECT *, unfiltered writes, leading-wildcard LIKE).
  const warnings = plans.flatMap((p) => optimize(p).warnings);
  lines.push(`Plan warnings: ${warnings.length}`);
  for (const w of warnings) lines.push(`  • [${w.code}] ${w.message} → ${w.suggestion}`);

  await driver.close();
  return { ok: true, lines };
}

/** Build a representative plan set: PK lookup + list per table (heuristic hot paths). */
function defaultPlans(tables: TableDef[]): QueryPlan[] {
  const out: QueryPlan[] = [];
  for (const t of tables) {
    const pk = t.columns.find((c) => c.primaryKey)?.name ?? "id";
    out.push({ op: "select", table: t.name, filters: [{ kind: "filter", column: pk, op: "=", value: undefined }], columnTypes: {} });
    out.push({ op: "select", table: t.name, filters: [], columnTypes: {} });
    // A couple of repeats to trip the index heuristic on the PK lookup.
    out.push({ op: "select", table: t.name, filters: [{ kind: "filter", column: pk, op: "=", value: undefined }], columnTypes: {} });
  }
  return out;
}

/** Human-readable one-liner for a schema diff change. */
function describeChange(c: Change): string {
  const t = "table" in c ? c.table : "?";
  switch (c.kind) {
    case "create_table":
      return `create table ${t}`;
    case "drop_table":
      return `drop table ${t}`;
    case "add_column":
      return `add column ${t}.${"column" in c && c.column ? c.column.name : "?"}`;
    case "drop_column":
      return `drop column ${t}.${(c as Extract<Change, { kind: "drop_column" }>).column}`;
    case "alter_column":
      return `alter column ${t}.${(c as Extract<Change, { kind: "alter_column" }>).column}`;
    case "add_index":
      return `add index on ${t} (${(c as Extract<Change, { kind: "add_index" }>).columns.join(", ")})`;
    case "drop_index":
      return `drop index on ${t} (${(c as Extract<Change, { kind: "drop_index" }>).columns.join(", ")})`;
    default:
      return `${(c as { kind: string }).kind} ${t}`;
  }
}
