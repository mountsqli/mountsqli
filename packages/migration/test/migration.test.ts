import { describe, it, expect } from "vitest";
import { defineTable, int, text, bool, timestamp } from "@mountsqli/schema";
import { diffSchemas } from "@mountsqli/migration";
import { generateMigrationSQL } from "@mountsqli/migration";
import { Migrator } from "@mountsqli/migration";
import { NodeSqliteDriver } from "@mountsqli/driver-sqlite";

const v1 = defineTable("users", {
  id: int().pk(),
  email: text().unique().notNull(),
});

const v2 = defineTable("users", {
  id: int().pk(),
  email: text().unique().notNull(),
  age: int().nullable(),
});

describe("migration diff", () => {
  it("detects a single added column", () => {
    const { changes, destructive } = diffSchemas([v1.def], [v2.def]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("add_column");
    expect(destructive).toHaveLength(0);
  });

  it("flags drop_column as destructive", () => {
    const { destructive } = diffSchemas([v2.def], [v1.def]);
    expect(destructive.length).toBe(1);
    expect(destructive[0]!.kind).toBe("drop_column");
  });

  it("generates reversible sqlite DDL", () => {
    const diff = diffSchemas([v1.def], [v2.def]);
    const gen = generateMigrationSQL(diff, "sqlite");
    expect(gen.up[0]).toContain('ALTER TABLE "users" ADD COLUMN "age"');
    expect(gen.down[0]).toContain('DROP COLUMN "age"');
    expect(gen.requiresReview).toBe(false);
  });

  it("generates postgres DDL with $N params-free DDL", () => {
    const diff = diffSchemas([v1.def], [v2.def]);
    const gen = generateMigrationSQL(diff, "postgres");
    expect(gen.up[0]).toContain('ALTER TABLE "users" ADD COLUMN "age"');
  });

  it("flags destructive migration requiresReview", () => {
    const diff = diffSchemas([v2.def], [v1.def]);
    const gen = generateMigrationSQL(diff, "sqlite");
    expect(gen.requiresReview).toBe(true);
  });
});

describe("migrator against real sqlite", () => {
  it("applies a create_table migration and records it", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    const migrator = new Migrator(driver);
    await migrator.ensureTable();

    const { diffSchemas: _d } = await import("@mountsqli/migration");
    const diff = _d([], [v1.def, v2.def]);
    const applied = await migrator.apply({ name: "0001_init", diff, dialect: "sqlite" });
    expect(applied).toBe(true);

    const records = await migrator.applied();
    expect(records.map((r) => r.name)).toContain("0001_init");

    // idempotent-ish: re-applying same name would need a guard; here we just
    // confirm the tables now exist by introspecting.
    const { sqliteIntrospector } = await import("@mountsqli/migration");
    const tables = await sqliteIntrospector.introspect(driver);
    expect(tables.map((t) => t.name).sort()).toEqual(["users"]);
    await driver.close();
  });

  it("blocks destructive migrations without allowDestructive", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    const migrator = new Migrator(driver);
    const diff = diffSchemas([v2.def], [v1.def]);
    await expect(
      migrator.apply({ name: "0002_drop", diff, dialect: "sqlite" }),
    ).rejects.toThrow(/destructive/);
    await driver.close();
  });

  it("dry-run does not execute", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    const migrator = new Migrator(driver);
    await migrator.ensureTable();
    const diff = diffSchemas([], [v1.def]);
    const previewed: string[] = [];
    const applied = await migrator.apply({ name: "0003", diff, dialect: "sqlite" }, { dryRun: true, onPreview: (s) => previewed.push(s) });
    expect(applied).toBe(false);
    expect(previewed.length).toBeGreaterThan(0);
    const records = await migrator.applied();
    expect(records).toHaveLength(0);
    await driver.close();
  });

  it("status() reports pending migrations when given the known set (issue 004)", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    const migrator = new Migrator(driver);
    await migrator.ensureTable();

    const step1 = { name: "0001_init", diff: diffSchemas([], [v1.def]), dialect: "sqlite" as const };
    const step2 = { name: "0002_age", diff: diffSchemas([v1.def], [v2.def]), dialect: "sqlite" as const };

    // Apply only the first.
    await migrator.apply(step1);

    // status() with no known set: pending stays empty (old misleading behavior).
    const noKnown = await migrator.status();
    expect(noKnown.applied).toEqual(["0001_init"]);
    expect(noKnown.pending).toEqual([]);

    // status() with the known set: 0002 is correctly reported as pending.
    const withKnown = await migrator.status([step1, step2]);
    expect(withKnown.applied).toEqual(["0001_init"]);
    expect(withKnown.pending.map((s) => s.name)).toEqual(["0002_age"]);

    await driver.close();
  });
});
