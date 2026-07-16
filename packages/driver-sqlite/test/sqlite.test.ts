import { describe, it, expect } from "vitest";
import { NodeSqliteDriver } from "@mountsqli/driver-sqlite";
import { defineTable, int, text, bool } from "@mountsqli/schema";
import { compilePlan, sqliteDialect } from "@mountsqli/compiler";

const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull().unique(),
  name: text().nullable(),
  active: bool().notNull().default(true),
});

describe("NodeSqliteDriver", () => {
  it("creates tables and inserts rows", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    await driver.init([users.def]);
    const plan = compilePlan({
      op: "insert" as const,
      table: "users",
      filters: [],
      columnTypes: {},
      values: { email: "a@b.c", name: "Ann", active: true },
    }, sqliteDialect);
    const r = await driver.query(plan, "run");
    expect(r.changes).toBe(1);
    expect(r.lastId).toBeGreaterThan(0);
    await driver.close();
  });

  it("reads inserted rows", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    await driver.init([users.def]);
    await driver.query(compilePlan({
      op: "insert" as const, table: "users", filters: [], columnTypes: {},
      values: { email: "x@y.z", name: "Xyz", active: true },
    }, sqliteDialect), "run");
    const r = await driver.query(
      { sql: 'SELECT * FROM "users"', params: [] },
      "many",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ email: "x@y.z", name: "Xyz" });
    await driver.close();
  });

  it("decodes boolean 0/1 back to boolean", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    await driver.init([users.def]);
    await driver.query(compilePlan({
      op: "insert" as const, table: "users", filters: [], columnTypes: { active: "bool" },
      values: { email: "b@c.d", name: "Bee", active: true },
    }, sqliteDialect), "run");
    const r = await driver.query(
      { sql: 'SELECT * FROM "users" WHERE email = ?', params: ["b@c.d"], columnTypes: { id: "int", email: "text", name: "text", active: "bool" } },
      "many",
    );
    // node:sqlite returns 0/1 for INTEGER; the driver should decode active to boolean
    expect(typeof r.rows[0].active).toBe("boolean");
    expect(r.rows[0].active).toBe(true);
    await driver.close();
  });

  it("supports transactions (commit)", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    await driver.init([users.def]);
    const result = await driver.transaction(async (tx) => {
      const r = await tx.query(compilePlan({
        op: "insert" as const, table: "users", filters: [], columnTypes: {},
        values: { email: "tx@test.com", name: "Tx", active: false },
      }, sqliteDialect), "run");
      return r.lastId;
    });
    expect(result).toBeGreaterThan(0);
    const { rows } = await driver.query({ sql: 'SELECT * FROM "users"', params: [] }, "many");
    expect(rows).toHaveLength(1);
    await driver.close();
  });
});
