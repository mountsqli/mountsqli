import { describe, it, expect } from "vitest";
import {
  compilePlan,
  emptyPlan,
  planKey,
  optimize,
  suggestIndexes,
  sqliteDialect,
  postgresDialect,
  mysqlDialect,
} from "../src/index.js";
import type { QueryPlan } from "../src/index.js";

describe("compilePlan — SELECT", () => {
  it("compiles a basic SELECT *", () => {
    const plan = emptyPlan("users");
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toBe('SELECT * FROM "users"');
    expect(params).toEqual([]);
  });

  it("compiles SELECT with specific columns", () => {
    const plan: QueryPlan = { ...emptyPlan("users"), columns: ["id", "email"] };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"email"');
    expect(sql).not.toContain("*");
  });

  it("compiles WHERE filters with bound params", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [
        { kind: "filter", column: "age", op: ">", value: 18 },
        { kind: "filter", column: "active", op: "=", value: true },
      ],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toMatch(/"age" > \?/);
    expect(sql).toMatch(/"active" = \?/);
    expect(sql).toContain("AND");
    expect(params).toEqual([18, true]);
  });

  it("compiles LIMIT and OFFSET", () => {
    const plan: QueryPlan = { ...emptyPlan("users"), limit: 10, offset: 20 };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("OFFSET 20");
  });

  it("compiles ORDER BY", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      orderBy: [{ column: "createdAt", dir: "desc" }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('ORDER BY "createdAt" DESC');
  });

  it("handles IN filter with array values", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [{ kind: "filter", column: "id", op: "in", value: [1, 2, 3] }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toMatch(/"id" IN \(\?, \?, \?\)/);
    expect(params).toEqual([1, 2, 3]);
  });

  it("handles deny flag (RLS short-circuit)", () => {
    const plan: QueryPlan = { ...emptyPlan("users"), deny: true };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("WHERE 1=0");
    expect(params).toEqual([]);
  });
});

describe("compilePlan — INSERT", () => {
  it("compiles INSERT with values", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { email: "a@b.c", name: "Ann" },
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('INSERT INTO "users"');
    expect(sql).toContain('"email", "name"');
    expect(sql).toContain("VALUES (?, ?)");
    expect(params).toEqual(["a@b.c", "Ann"]);
  });

  it("adds RETURNING when dialect supports it", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { id: 1 },
      returning: ["id"],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('RETURNING "id"');
  });

  it("omits RETURNING for mysql dialect", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { id: 1 },
      returning: ["id"],
    };
    const { sql } = compilePlan(plan, mysqlDialect);
    expect(sql).not.toContain("RETURNING");
  });
});

describe("compilePlan — UPDATE", () => {
  it("compiles UPDATE with SET and WHERE", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "update"),
      values: { name: "Bob" },
      filters: [{ kind: "filter", column: "id", op: "=", value: 1 }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('UPDATE "users"');
    expect(sql).toContain('SET "name" = ?');
    expect(sql).toContain('WHERE "id" = ?');
    expect(params).toEqual(["Bob", 1]);
  });
});

describe("compilePlan — DELETE", () => {
  it("compiles DELETE with WHERE", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "delete"),
      filters: [{ kind: "filter", column: "id", op: "=", value: 1 }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('DELETE FROM "users"');
    expect(sql).toContain('WHERE "id" = ?');
    expect(params).toEqual([1]);
  });
});

describe("dialects", () => {
  it("sqlite uses ? placeholders", () => {
    const plan: QueryPlan = { ...emptyPlan("t"), filters: [{ kind: "filter", column: "c", op: "=", value: 1 }] };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("?");
  });

  it("postgres uses $1, $2 placeholders", () => {
    const plan: QueryPlan = {
      ...emptyPlan("t"),
      filters: [
        { kind: "filter", column: "a", op: "=", value: 1 },
        { kind: "filter", column: "b", op: ">", value: 2 },
      ],
    };
    const { sql } = compilePlan(plan, postgresDialect);
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
  });

  it("postgres uses double-quote ident quoting", () => {
    const plan: QueryPlan = { ...emptyPlan("users") };
    const { sql } = compilePlan(plan, postgresDialect);
    expect(sql).toContain('"users"');
  });

  it("mysql uses backtick ident quoting", () => {
    const plan: QueryPlan = { ...emptyPlan("users") };
    const { sql } = compilePlan(plan, mysqlDialect);
    expect(sql).toContain("`users`");
  });
});

describe("optimize", () => {
  it("warns on SELECT *", () => {
    const r = optimize(emptyPlan("users"));
    expect(r.warnings.some((w) => w.code === "SELECT_STAR")).toBe(true);
  });

  it("warns on unfiltered UPDATE", () => {
    const r = optimize({ ...emptyPlan("users", "update"), values: { x: 1 } });
    expect(r.warnings.some((w) => w.code === "MISSING_PK_FILTER")).toBe(true);
  });

  it("warns on leading-wildcard LIKE", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [{ kind: "filter", column: "name", op: "like", value: "%test" }],
    };
    const r = optimize(plan);
    expect(r.warnings.some((w) => w.code === "LIKE_PREFIX")).toBe(true);
  });

  it("no warnings on well-formed query", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      filters: [{ kind: "filter", column: "id", op: "=", value: 1 }],
    };
    const r = optimize(plan);
    expect(r.warnings.length).toBe(0);
  });
});

describe("suggestIndexes", () => {
  it("suggests indexes for frequently filtered columns", () => {
    const plans: QueryPlan[] = [
      { ...emptyPlan("users"), filters: [{ kind: "filter", column: "email", op: "=", value: "" }] },
      { ...emptyPlan("users"), filters: [{ kind: "filter", column: "email", op: "=", value: "" }] },
    ];
    const idx = suggestIndexes(plans);
    expect(idx.some((i) => i.table === "users" && i.columns.includes("email"))).toBe(true);
  });

  it("returns empty for unfiltered plans", () => {
    const idx = suggestIndexes([emptyPlan("users")]);
    expect(idx).toEqual([]);
  });
});

describe("planKey", () => {
  it("returns a stable string from a compiled plan", () => {
    const plan = emptyPlan("users");
    const k1 = planKey(plan, sqliteDialect);
    const k2 = planKey(plan, sqliteDialect);
    expect(k1).toBe(k2);
  });
});

describe("compilePlan — new features", () => {
  it("compiles DISTINCT", () => {
    const plan: QueryPlan = { ...emptyPlan("users"), distinct: true };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("SELECT DISTINCT");
  });

  it("compiles GROUP BY", () => {
    const plan: QueryPlan = { ...emptyPlan("users"), groupBy: ["age", "city"] };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('GROUP BY "age", "city"');
  });

  it("compiles HAVING", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      groupBy: ["age"],
      having: [{ kind: "filter", column: "age", op: ">", value: 18 }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("HAVING");
    expect(sql).toContain('"age" > ?');
    expect(params).toEqual([18]);
  });

  it("compiles BETWEEN filter", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [{ kind: "filter", column: "age", op: "between", value: [18, 65] }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('"age" BETWEEN ? AND ?');
    expect(params).toEqual([18, 65]);
  });

  it("compiles OR filter node", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [{
        kind: "or",
        filters: [
          { kind: "filter", column: "status", op: "=", value: "active" },
          { kind: "filter", column: "role", op: "=", value: "admin" },
        ],
      }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('("status" = ? OR "role" = ?)');
    expect(params).toEqual(["active", "admin"]);
  });

  it("compiles OR nested with AND", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [
        { kind: "filter", column: "tenant_id", op: "=", value: "abc" },
        {
          kind: "or",
          filters: [
            { kind: "filter", column: "role", op: "=", value: "admin" },
            { kind: "filter", column: "permissions", op: ">=", value: 100 },
          ],
        },
      ],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('"tenant_id" = ?');
    expect(sql).toContain('("role" = ? OR "permissions" >= ?)');
    expect(params).toEqual(["abc", "admin", 100]);
  });

  it("compiles EXISTS subquery", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [{
        kind: "subquery",
        op: "exists",
        plan: { op: "select", table: "orders", filters: [{ kind: "filter", column: "user_id", op: "=", value: 1 }] },
      }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain('SELECT * FROM "orders"');
    expect(sql).toContain('WHERE "user_id" = ?');
    expect(params).toEqual([1]);
  });

  it("compiles IN subquery", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      filters: [{
        kind: "subquery",
        column: "id",
        op: "in",
        plan: { op: "select", table: "orders", columns: ["user_id"], filters: [] },
      }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('"id" IN (');
    expect(sql).toContain('SELECT "user_id" FROM "orders"');
  });

  it("compiles CTE (WITH clause)", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      with: [{
        name: "recent",
        query: { op: "select", table: "users", columns: ["id", "name"], filters: [{ kind: "filter", column: "age", op: ">", value: 18 }] },
      }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toMatch(/^WITH "recent" AS \(/);
    expect(params).toEqual([18]);
  });

  it("compiles UNION ALL", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      unions: [{ type: "union all", all: true, query: { op: "select", table: "admins", filters: [] } }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain('SELECT * FROM "admins"');
  });

  it("compiles window function — row_number", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id", "name"],
      window: [{ fn: "row_number", alias: "rn", partitionBy: ["dept_id"], orderBy: [{ column: "salary", dir: "desc" }] }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("ROW_NUMBER() OVER (");
    expect(sql).toContain('PARTITION BY "dept_id"');
    expect(sql).toContain('ORDER BY "salary" DESC');
    expect(sql).toContain('AS "rn"');
  });

  it("compiles window function — rank", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      window: [{ fn: "rank", alias: "r", orderBy: [{ column: "score", dir: "desc" }] }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("RANK() OVER (ORDER BY");
  });

  it("compiles window function — ntile", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      window: [{ fn: "ntile", alias: "bucket", partitionBy: ["region"], frame: "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW" }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("NTILE() OVER (");
    expect(sql).toContain("PARTITION BY");
    expect(sql).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW");
  });

  it("compiles lag window function", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      window: [{ fn: "lag", column: "salary", alias: "prev_salary", orderBy: [{ column: "date", dir: "asc" }] }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('LAG("salary") OVER (');
    expect(sql).toContain('ORDER BY "date"');
  });

  it("compiles aggregates in SELECT", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["dept_id"],
      aggregates: [
        { fn: "count", alias: "cnt" },
        { fn: "avg", column: "salary", alias: "avg_sal" },
        { fn: "sum", column: "bonus", alias: "total_bonus", distinct: true },
      ],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("COUNT(*) AS \"cnt\"");
    expect(sql).toContain('AVG("salary") AS "avg_sal"');
    expect(sql).toContain('SUM(DISTINCT "bonus") AS "total_bonus"');
  });

  it("compiles multi-row INSERT", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: [{ name: "Alice", email: "a@b.c" }, { name: "Bob", email: "b@c.d" }],
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("VALUES (?, ?), (?, ?)");
    expect(params).toEqual(["Alice", "a@b.c", "Bob", "b@c.d"]);
  });

  it("compiles multi-row INSERT with numbered params (postgres)", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: [{ name: "Alice" }, { name: "Bob" }],
    };
    const { sql, params } = compilePlan(plan, postgresDialect);
    // 2 rows × 1 column each = ($1), ($2)
    expect(sql).toContain("VALUES ($1), ($2)");
    expect(params).toEqual(["Alice", "Bob"]);
  });

  it("compiles upsert (ON CONFLICT DO UPDATE)", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { id: 1, name: "Alice" },
      onConflict: { action: "update", constraint: ["id"], set: { name: "Alice Updated" } },
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("ON CONFLICT (\"id\") DO UPDATE SET");
    expect(sql).toContain('"name" = ?');
    expect(params).toContain("Alice Updated");
  });

  it("compiles ON CONFLICT DO NOTHING", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { id: 1 },
      onConflict: { action: "nothing", constraint: "id" },
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');
  });

  it("compiles ON CONFLICT DO NOTHING without constraint", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { id: 1 },
      onConflict: { action: "nothing" },
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("ON CONFLICT DO NOTHING");
  });

  it("compiles RETURNING on UPDATE", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "update"),
      values: { name: "Bob" },
      filters: [{ kind: "filter", column: "id", op: "=", value: 1 }],
      returning: ["id", "name"],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('RETURNING "id", "name"');
  });

  it("compiles RETURNING on DELETE", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "delete"),
      filters: [{ kind: "filter", column: "id", op: "=", value: 1 }],
      returning: ["*"],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("RETURNING *");
  });

  it("omits RETURNING on INSERT for mysql, populates compiled.returning", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users", "insert"),
      values: { name: "Alice" },
      returning: ["id", "name"],
    };
    const compiled = compilePlan(plan, mysqlDialect);
    expect(compiled.sql).not.toContain("RETURNING");
    expect(compiled.returning).toEqual(["id", "name"]);
    expect(compiled.table).toBe("users");
  });

  it("propagates returning on UPDATE/DELETE for mysql", () => {
    const updatePlan: QueryPlan = {
      ...emptyPlan("users", "update"),
      values: { name: "Bob" },
      filters: [{ kind: "filter", column: "id", op: "=", value: 1 }],
      returning: ["id"],
    };
    const compiled = compilePlan(updatePlan, mysqlDialect);
    expect(compiled.returning).toEqual(["id"]);
    expect(compiled.table).toBe("users");
  });

  it("compiles FTS filter — sqlite FTS5", () => {
    const plan: QueryPlan = {
      ...emptyPlan("posts"),
      fts: { mode: "fts5", columns: ["title", "body"], query: "hello world" },
    };
    const { sql, params } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("MATCH ?");
    expect(params).toEqual(["hello world"]);
  });

  it("compiles FTS filter — postgres tsvector", () => {
    const plan: QueryPlan = {
      ...emptyPlan("posts"),
      fts: { mode: "tsvector", columns: ["title", "body"], query: "hello" },
    };
    const { sql, params } = compilePlan(plan, postgresDialect);
    expect(sql).toContain("to_tsvector(");
    expect(sql).toContain("@@ plainto_tsquery($1)");
    expect(params).toEqual(["hello"]);
  });

  it("compiles FTS filter — mysql FULLTEXT", () => {
    const plan: QueryPlan = {
      ...emptyPlan("posts"),
      fts: { mode: "fulltext", columns: ["title"], query: "hello" },
    };
    const { sql, params } = compilePlan(plan, mysqlDialect);
    expect(sql).toContain("MATCH (`title`) AGAINST (?)");
    expect(params).toEqual(["hello"]);
  });

  it("compiles JSON extract in SELECT", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      jsonOps: [{ kind: "extract", column: "meta", path: "$.name", alias: "user_name" }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('json_extract("meta", $.name) AS "user_name"');
  });

  it("compiles json_agg", () => {
    const plan: QueryPlan = {
      ...emptyPlan("posts"),
      columns: ["author_id"],
      jsonOps: [{ kind: "agg", column: "title", alias: "titles" }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain('json_agg("title") AS "titles"');
  });

  it("compiles json_object", () => {
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      jsonOps: [{ kind: "object", fields: [{ key: "name", value: "full_name" }, { key: "email", value: "email" }], alias: "profile" }],
    };
    const { sql } = compilePlan(plan, sqliteDialect);
    expect(sql).toContain("json_object('name', \"full_name\", 'email', \"email\") AS \"profile\"");
  });

  it("compiles columnTypes with all new features", () => {
    // Verify columnTypes are carried through unaffected
    const plan: QueryPlan = {
      ...emptyPlan("users"),
      columns: ["id"],
      aggregates: [{ fn: "count", alias: "cnt" }],
      columnTypes: { id: "int" },
    };
    const compiled = compilePlan(plan, sqliteDialect);
    expect(compiled.columnTypes).toEqual({ id: "int" });
  });
});
