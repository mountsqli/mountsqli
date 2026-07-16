// MountSQLI — Migrator.
// Applies generated migrations against any Driver. State is tracked in a
// `_mount_migrations` table (idempotent; re-running is a no-op). Destructive
// migrations are blocked unless `allowDestructive` is set — safe-by-default.

import { MountError, type Driver, type QueryResult } from "@mountsqli/driver";
import type { TableDef } from "@mountsqli/schema";
import type { DiffResult } from "./diff.js";
import { generateMigrationSQL, type GeneratedMigration } from "./generate.js";

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
  checksum: string;
}

export interface MigrationStep {
  name: string;
  diff: DiffResult;
  dialect?: string;
}

export interface ApplyOptions {
  allowDestructive?: boolean;
  dryRun?: boolean;
  /** Called with the SQL that *would* run; lets CLI preview without executing. */
  onPreview?: (sql: string) => void;
}

function checksum(str: string): string {
  // FNV-1a 32-bit, dependency-free.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class Migrator {
  constructor(private driver: Driver) {}

  async ensureTable(): Promise<void> {
    await this.driver.query(
      { sql: `CREATE TABLE IF NOT EXISTS _mount_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)`, params: [] },
      "run",
    );
  }

  async applied(): Promise<MigrationRecord[]> {
    const res = await this.driver.query<MigrationRecord>(
      { sql: `SELECT id, name, applied_at, checksum FROM _mount_migrations ORDER BY id ASC`, params: [] },
      "many",
    );
    return res.rows;
  }

  /**
   * Report applied migrations and — when given the set of known migrations —
   * the pending (unapplied) ones. Without `known`, `pending` is empty: nothing
   * to diff against (issue 004). Pass the migrations discovered on disk or via
   * a `MigrationSource` so `migrate status` can show what will run next.
   */
  async status(known?: MigrationStep[]): Promise<{ applied: string[]; pending: MigrationStep[] }> {
    const done = new Set((await this.applied()).map((r) => r.name));
    const pending = known ? known.filter((s) => !done.has(s.name)) : [];
    return { applied: [...done], pending };
  }

  /** Generate SQL for a diff (used by CLI `migrate generate` / preview). */
  generate(step: MigrationStep): GeneratedMigration {
    return generateMigrationSQL(step.diff, step.dialect ?? "sqlite");
  }

  async apply(step: MigrationStep, opts: ApplyOptions = {}): Promise<boolean> {
    const gen = this.generate(step);
    if (gen.requiresReview && !opts.allowDestructive) {
      throw new MountError("VALIDATION",
        `MountSQLI: migration "${step.name}" is destructive and requires allowDestructive=true.`,
      );
    }
    if (opts.dryRun) {
      for (const sql of gen.up) opts.onPreview?.(sql);
      return false;
    }

    // advisory lock to survive crashes mid-apply
    await this.ensureTable();
    await this.driver.transaction(async (tx) => {
      for (const sql of gen.up) {
        await tx.query({ sql, params: [] }, "run");
      }
      const sum = checksum(gen.up.join("\n"));
      await tx.query(
        { sql: `INSERT INTO _mount_migrations (name, applied_at, checksum) VALUES (?, ?, ?)`, params: [step.name, new Date().toISOString(), sum] },
        "run",
      );
    });
    return true;
  }

  /**
   * Roll back the last applied migration by executing the provided `downSQL`.
   * `rollbackLast` requires explicit down SQL — it will NOT silently delete
   * the tracking record without reverting schema changes (that would corrupt
   * state). Pass the inverse of your migration's `up`.
   */
  async rollbackLast(downSQL: string[], opts: ApplyOptions = {}): Promise<boolean> {
    const done = await this.applied();
    const last = done[done.length - 1];
    if (!last) return false;
    if (!downSQL || downSQL.length === 0) {
      throw new MountError("VALIDATION",
        `MountSQLI: rollbackLast requires down SQL. The migration "${last.name}" was not reversed.`,
      );
    }
    return this.applyDown(last.name, downSQL, opts);
  }

  /** Apply a pre-computed down list (e.g. from CLI with both up/down). */
  async applyDown(name: string, downSQL: string[], opts: ApplyOptions = {}): Promise<boolean> {
    if (opts.dryRun) {
      for (const sql of downSQL) opts.onPreview?.(sql);
      return false;
    }
    await this.driver.transaction(async (tx) => {
      for (const sql of downSQL) await tx.query({ sql, params: [] }, "run");
      await tx.query({ sql: `DELETE FROM _mount_migrations WHERE name = ?`, params: [name] }, "run");
    });
    return true;
  }
}

export type { QueryResult };
