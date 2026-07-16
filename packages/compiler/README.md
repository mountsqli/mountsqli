# @mountsqli/compiler

The QueryPlan IR, SQL dialect abstraction, and query optimizer — the heart of MountSQLI.

MountSQLI treats the ORM as a **compiler + intermediate representation (QueryPlan IR)** rather than a class hierarchy. Queries are data; the compiler turns plans into dialect-specific SQL without ever string-concatenating bound values. That is what makes MountSQLI tree-shakeable, edge-ready, and injection-safe by construction.

## Install

```bash
pnpm add @mountsqli/compiler
```

## What's inside

- **QueryPlan IR** — a structured tree of nodes. Every value lives in `params`; the dialect decides `?` vs `$N`.
- **Dialect** — `sqliteDialect`, `postgresDialect`, `mysqlDialect`. Decides parameter style, identifier quoting, and type-name mapping.
- **optimize(plan)** — rule-based rewrites and advisory warnings (SELECT *, unfiltered UPDATE/DELETE, leading-wildcard LIKE).
- **suggestIndexes(plans)** — index recommendations from repeated filters.

## Usage

```ts
import { compilePlan, optimize, sqliteDialect } from "@mountsqli/compiler";

const plan = { op: "select", table: "users", filters: [{ kind: "filter", column: "age", op: ">", value: 18 }] };
const { sql, params } = compilePlan(plan, sqliteDialect);

// sql       => 'SELECT * FROM "users" WHERE "age" > ?'
// params    => [18]
```

`compilePlan` **never** interpolates `params` into `sql`. Drivers only translate `{ sql, params, columnTypes }` → rows.

## Security invariant

Injection is impossible at the compiler boundary: user input is always a bound parameter.

## IR capabilities

The QueryPlan supports:

| Category | Nodes |
| --- | --- |
| Core operations | SELECT, INSERT, UPDATE, DELETE |
| Filtering | `=`, `>`, `<`, `>=`, `<=`, `!=`, `like`, `in`, `is`, `is not`, `between`, AND/OR groups (composable filter operators), EXISTS/NOT EXISTS/IN subqueries, raw WHERE expressions |
| Joining | INNER, LEFT, RIGHT JOIN (with optional table aliases for self-joins) |
| Ordering & pagination | ORDER BY (asc/desc), LIMIT, OFFSET |
| Distinct | SELECT DISTINCT, Postgres DISTINCT ON |
| Grouping | GROUP BY, HAVING |
| CTEs | WITH (named sub-queries at statement start) |
| Unions & set ops | UNION, UNION ALL, INTERSECT, EXCEPT |
| Returning | RETURNING on INSERT/UPDATE/DELETE; MySQL emulation via compiled.returning |
| Window functions | ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, FIRST_VALUE, LAST_VALUE, NTILE with PARTITION BY, ORDER BY, frame |
| Aggregates | COUNT, SUM, AVG, MIN, MAX (as SELECT columns) |
| Upsert | INSERT ... ON CONFLICT DO NOTHING / DO UPDATE SET |
| Multi-row INSERT | `values: Record[]` for bulk inserts |
| Full-text search | FTS5 (SQLite), tsvector (Postgres), FULLTEXT (MySQL) |
| JSON operations | json_extract, json_set, json_remove, json_agg, json_object, json_array |
| Row locking | SELECT ... FOR UPDATE / FOR SHARE / FOR NO KEY UPDATE / FOR KEY SHARE with SKIP LOCKED / NOWAIT |
| Subqueries in FROM | `(SELECT ...) AS alias` source |

## API highlights

| Export | Kind | Purpose |
| --- | --- | --- |
| `compilePlan(plan, dialect)` | fn | IR → `{ sql, params, columnTypes }`. |
| `optimize(plan)` | fn | Plan rewrites for cheaper SQL. |
| `suggestIndexes(plans)` | fn | Index recommendations. |
| `sqliteDialect` / `postgresDialect` / `mysqlDialect` | const | Dialect definitions. |
| `QueryPlan`, `FilterNode`, `Comparator`, `WindowDef`, `OnConflict`, `FtsDef`, `JsonOp`, `AggregateDef` | type | IR node types. |
| `emptyPlan(table, op?)` | fn | Create an empty plan for a table (used internally by QueryBuilder). |
| `planKey(plan, dialect?)` | fn | Stable cache key from compiled SQL. |
