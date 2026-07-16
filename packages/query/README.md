# @mountsqli/query

A fluent, **type-safe** query builder plus an `sql` template tag. The builder is a typed view over SQL, never a replacement for it.

## Install

```bash
pnpm add @mountsqli/query
```

## Fluent builder

```ts
import { tableQuery } from "@mountsqli/query";

const q = tableQuery(driver, users)
  .where("age", ">", 18)
  .orderBy("createdAt", "desc")
  .limit(10);

const rows = await q.select(); // typed as Row<T>[]
```

Builders are **immutable** and use structural sharing — each chained call returns a new `QueryBuilder<T>` carrying a `QueryPlan` IR. The plan is handed to the driver; no per-row object graph is built.

## Builder methods

| Method | Description |
| --- | --- |
| `.where(col, op, val)` | Filter with any comparator (`=`, `>`, `<`, `>=`, `<=`, `!=`, `like`, `in`, `is`, `is not`, `between`) |
| `.where(filterNode)` | Filter with composable operator: `.where(and(eq("age", 18), or(eq("status", "active"), eq("role", "admin"))))` |
| `.orderBy(col, dir)` | Add ORDER BY |
| `.limit(n)` / `.offset(n)` | Pagination |
| `.distinct()` | SELECT DISTINCT |
| `.distinctOn(...cols)` | Postgres DISTINCT ON |
| `.groupBy(...cols)` | GROUP BY |
| `.having(col, op, val)` | HAVING filter |
| `.join(table, type, leftCol, rightCol, alias?)` | JOIN with optional table alias for self-joins |
| `.withRelations(name, type)` | JOIN from a schema relationship definition |
| `.withFilters(filters)` | Inject raw FilterNode[] (used by RLS) |
| `.with(name, qb, columns?)` | CTE: `WITH "cte" AS (SELECT ...)` |
| `.subquery(qb, alias)` | Subquery in FROM: `SELECT ... FROM (SELECT ...) AS alias` |
| `.deny()` | Force WHERE 1=0 (RLS explicit deny) |
| `.paginate(page, perPage)` | Offset pagination shorthand (`.offset().limit()`) |
| `.cursor(column, value, op?)` | Cursor-based pagination filter (`>`, `>=`) |
| `.returning(...cols)` | Add RETURNING clause to INSERT/UPDATE/DELETE |
| `.forUpdate()` / `.forShare()` / `.forNoKeyUpdate()` / `.forKeyShare()` | Row-level locking with optional SKIP LOCKED / NOWAIT |
| `.intersect(qb)` / `.except(qb)` / `.union(qb)` / `.unionAll(qb)` | Set operations |
| `.selectExpr(sql, params, alias)` | Raw SQL expression in SELECT clause. **Guarded** — rejects `;`, `--`, `/*` (throws `MountError("VALIDATION")`) so untrusted input can't inject. |
| `.whereExpr(sql, params)` | Raw SQL fragment in WHERE clause. **Guarded** — same injection check as `.selectExpr()`. |
| `.findMany({ with, where, orderBy, limit, offset })` | Fluent relational query — eager-loads nested relations via batch queries |
| `.select(...cols)` | Execute — returns typed rows. Pass columns for narrowing: `select("id", "name")` returns `Pick<Row, "id" | "name">[]` |
| `.findOne()` | First match or null |
| `.insert(values)` | Single or multi-row INSERT: `.insert({...})` or `.insert([{...}, {...}])` |
| `.upsert(values, constraint, set)` | INSERT ... ON CONFLICT DO UPDATE |
| `.insertIgnore(values, constraint?)` | INSERT ... ON CONFLICT DO NOTHING |
| `.update(values)` | UPDATE with WHERE from prior `.where()` calls |
| `.delete()` | DELETE with WHERE from prior `.where()` calls |
| `.raw(sql, params?)` | Execute raw SQL through the builder's driver |

### Aggregates

```ts
await db.query(users).count("total").select();      // COUNT(*) AS "total"
await db.query(users).sum("salary", "total").select(); // SUM("salary") AS "total"
await db.query(users).avg("salary").select();
await db.query(users).min("age").select();
await db.query(users).max("age").select();
```

### Window functions

```ts
await db.query(users)
  .rowNumber("rn", ["dept_id"], [{ column: "salary", dir: "desc" }])
  .select();

await db.query(users).rank("r", ["dept"]);
await db.query(users).denseRank("dr");
await db.query(users).lag("salary", "prev_sal");
await db.query(users).lead("salary", "next_sal");
await db.query(users).firstValue("salary", "first");
await db.query(users).lastValue("salary", "last");
await db.query(users).ntile("bucket");
```

### Composable filter operators

Use `and()` / `or()` + operator functions for complex filters:

```ts
import { and, or, eq, ne, gt, gte, lt, lte, like, inArray, isNull } from "@mountsqli/query";

await db.query(users)
  .where(and(
    eq("status", "active"),
    or(
      gt("age", 18),
      eq("role", "admin"),
    ),
  ))
  .select();
// WHERE ("status" = ? AND ("age" > ? OR "role" = ?))
```

### RETURNING clause

```ts
const [user] = await db.query(users)
  .returning("id", "email")
  .insert({ email: "a@b.c" });
// INSERT INTO "users" ("email") VALUES (?) RETURNING "id", "email"
```

### Row-level locking

```ts
await db.query(users)
  .where("status", "=", "pending")
  .forUpdate()
  .select();
// SELECT * FROM "users" WHERE "status" = ? FOR UPDATE

// With NOWAIT / SKIP LOCKED:
await db.query(users).forUpdate(true).select();          // NOWAIT
await db.query(users).forShare(false, true).select();    // SKIP LOCKED
```

### Set operations

```ts
const q1 = db.query(users).where("age", ">", 18);
const q2 = db.query(users).where("role", "=", "admin");

const adminsAndAdults = await q1.unionAll(q2).select();
const activeOnly = await q1.intersect(q2).select();
const excludeAdmins = await q1.except(q2).select();
```

### CTE (Common Table Expressions)

```ts
const cte = db.query(users).where("age", ">", 18);
const adults = await db.query(users)
  .with("adult_users", cte)
  .select("id", "name");
// WITH "adult_users" AS (SELECT * FROM "users" WHERE "age" > ?)
// SELECT "id", "name" FROM "users"
```

### Subqueries in FROM

```ts
const sub = db.query(posts).groupBy("author_id");
const result = await db.query(users)
  .subquery(sub, "post_counts")
  .select();
// SELECT * FROM (SELECT * FROM "posts" GROUP BY "author_id") AS "post_counts"
```

### Fluent relational queries (eager-loading)

Define relationships on your tables:

```ts
import { defineTable, int, text, belongsTo, hasMany } from "@mountsqli/schema";

const users = defineTable("users", { id: int().pk(), name: text() });
const posts = defineTable("posts", {
  id: int().pk(),
  title: text(),
  user_id: int(),
  body: text(),
}, {
  relations: [belongsTo("author", "users").foreignKey("user_id")],
});
```

Then fetch with deeply nested eager-loading in one call:

```ts
const rows = await db.query(posts)
  .findMany({
    with: { author: true },
    where: eq("status", "published"),
    orderBy: [{ column: "created_at", dir: "desc" }],
    limit: 10,
  });
// rows[0].author → { id: 1, name: "Alice", ... }
// Nested: { with: { author: { with: { profile: true } } } }
```

Uses batch-loading internally — no N+1 problem.

### Pagination

```ts
// Offset-based (page 2, 20 per page)
const page2 = await db.query(users).paginate(2, 20).select();

// Cursor-based (rows after id=100)
const next = await db.query(users).cursor("id", 100, "gt").limit(20).select();
```

### Full-text search

```ts
// SQLite FTS5
await db.query(posts).ftsSearch("fts5", ["title", "body"], "hello").select();

// Postgres tsvector
await db.query(posts).ftsSearch("tsvector", ["title", "body"], "hello").select();

// MySQL FULLTEXT
await db.query(posts).ftsSearch("fulltext", ["title"], "hello").select();
```

### JSON operations

```ts
await db.query(users)
  .jsonExtract("metadata", "$.name", "user_name")
  .jsonAgg("tags", "all_tags")
  .jsonObject([{ key: "name", value: "full_name" }], "profile")
  .jsonArray("ids", "id_list")
  .select();
```

## `sql` template tag

For escape hatches — raw SQL that stays injection-safe because values become bound parameters:

```ts
import { sql } from "@mountsqli/query";

const result = await driver.query(sql`SELECT * FROM users WHERE id = ${id}`);

// Generic type parameter for typed results:
const rows = await db.sql<{ id: number; name: string }>`SELECT id, name FROM users`;
```

`sql<T>(strings, ...values)` returns a `SqlQuery<T>` — the same shape the compiler emits, so it flows through drivers identically.

## Transaction support

```ts
import { TxQueryBuilder } from "@mountsqli/query";

const result = await db.transaction(async (txDb) => {
  const user = await txDb.query(users).insert({ email: "a@b.c" });
  await txDb.query(posts).insert({ title: "Hello", user_id: user.lastId });
  return user;
});
```

Transactions support savepoints for nested rollback:

```ts
await db.transaction(async (tx) => {
  await tx.savepoint?.("sp1");
  // ... do risky work ...
  await tx.rollbackTo?.("sp1"); // roll back to savepoint
  await tx.release?.("sp1");    // release savepoint
});
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `QueryBuilder<T>` | class | Immutable builder with all filter/join/aggregate/window/JSON/FTS methods. |
| `TxQueryBuilder<T>` | class | Transaction-scoped builder, uses `tx.query()` instead of driver. |
| `tableQuery(driver, table)` | fn | Create a builder bound to a driver + table. |
| `sql<T>(strings, ...values)` | tag | Template tag → `SqlQuery<T>` with bound params. |
| `SqlQuery` | type | `{ sql, params, compile() }`. |

Queries are data: capabilities are added as `QueryPlan` IR nodes in `@mountsqli/compiler`, not as driver methods.
