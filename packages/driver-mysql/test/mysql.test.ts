import { describe, it, expect, vi } from "vitest";
import { MysqlDriver } from "@mountsqli/driver-mysql";
import { compilePlan, emptyPlan, mysqlDialect } from "@mountsqli/compiler";
import { defineTable, int, text } from "@mountsqli/schema";
import { listDrivers } from "@mountsqli/driver";

// No real MySQL here — inject a fake pool whose `execute()` records SQL and
// `getConnection()` returns a connection that records too. This proves
// multi-driver dispatch, `?` pass-through, AUTO_INCREMENT DDL, and lastId.
function fakePool() {
  const seen: { sql: string; params: unknown[] }[] = [];
  const conn = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      seen.push({ sql, params });
      if (sql.trim().toUpperCase().startsWith("SELECT")) return { rows: [], affectedRows: 0, insertId: 0 };
      return { rows: [], affectedRows: 1, insertId: 7 };
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  };
  return {
    pool: {
      execute: vi.fn(async (sql: string, params: unknown[] = []) => conn.execute(sql, params)),
      getConnection: vi.fn(async () => conn),
      end: vi.fn(async () => {}),
    },
    seen,
    conn,
  };
}

const users = defineTable("users", {
  id: int().pk(),
  email: text().unique().notNull(),
});

describe("Mysql driver (multi-driver)", () => {
  it("passes ? placeholders through unchanged and binds booleans as 0/1", async () => {
    const { pool, seen } = fakePool();
    const driver = new MysqlDriver({ pool: pool as any });

    await driver.query(
      compilePlan({ ...emptyPlan("users"), filters: [{ kind: "filter", column: "active", op: "=", value: true } as any], columnTypes: {} }, mysqlDialect),
      "many",
    );

    expect(seen[0]!.sql).toBe("SELECT * FROM `users` WHERE `active` = ?");
    expect(seen[0]!.params).toEqual([1]);
  });

  it("creates tables with mysql dialect types + AUTO_INCREMENT on int PK", async () => {
    const { pool, seen } = fakePool();
    const driver = new MysqlDriver({ pool: pool as any });
    await driver.init([users.def]);
    const createCall = seen.find((s) => s.sql.toUpperCase().includes("CREATE TABLE"));
    expect(createCall?.sql).toContain('`id` INTEGER PRIMARY KEY AUTO_INCREMENT');
    expect(createCall?.sql).toContain('`email` VARCHAR(255)');
  });

  it("derives lastId from insertId on run", async () => {
    const { pool } = fakePool();
    const driver = new MysqlDriver({ pool: pool as any });
    const res = await driver.query(
      compilePlan({ ...emptyPlan("users"), op: "insert", values: { email: "a@b.c" }, filters: [], columnTypes: {} } as any, mysqlDialect),
      "run",
    );
    expect(res.lastId).toBe(7);
    expect(res.changes).toBe(1);
  });

  it("registers under the 'mysql' name", () => {
    expect(listDrivers()).toContain("mysql");
    expect(listDrivers()).toContain("mysql2");
  });
});
