# @mountsqli/core

The umbrella package: zero-config `mountsqli()` (loads `mountsqli.config.js`) plus re-exports of schema, query, compiler, and the SQLite driver.

## Install

```bash
pnpm add @mountsqli/core
```

## One-call backend

All configuration lives in `mountsqli.config.js` at your project root. Use `defineConfig()` for type safety:

### Static import (bundlers — Next.js, Vite, etc.)

```ts
// mountsqli.config.js
import { defineConfig } from "@mountsqli/core";
import { users, posts } from "./schema/index.js";

export default defineConfig({
  driver: "sqlite",
  url: "./dev.db",
  schema: "./schema",
  tables: [users, posts],
});
```

```ts
// app.ts
import { mountsqli } from "@mountsqli/core";
import config from "../mountsqli.config.js";

const db = await mountsqli(config);
```

The static import avoids dynamic `import()` — works with Turbopack and other bundlers.

### Zero-config shorthand (plain Node.js / CLI)

```ts
import { mountsqli } from "@mountsqli/core";

// Everything (driver, url, tables) comes from mountsqli.config.js.
const db = await mountsqli();

await db.query(users).insert({ email: "a@b.c" });
const rows = await db.query(users).select();
```

`mountsqli()` walks up from `cwd` to find `mountsqli.config.js`, auto-collects tables from `schema/`, and returns a ready `Db`.

### Optional override

Pass a partial config to merge on top of the file — e.g. a test can force an in-memory DB:

```ts
const db = await mountsqli({ url: ":memory:" });
```

Only the fields you pass override the file; everything else comes from `mountsqli.config.js`.

### Extended entry point

Subsystems (auth, storage, realtime, cache) are optional — import and configure only what you need:

```ts
const db = await mountsqliExtended({ auth: { jwtSecret: "..." }, storage: { /* ... */ } });
await db.auth?.signUp({ email: "a@b.c", password: "..." });
await db.storage?.upload("docs/plan.pdf", buffer);
```

### Full config

`mountsqliFull()` returns the `Db` plus the resolved `MountConfig` (including subsystem sections) for tooling:

```ts
const { db, config } = await mountsqliFull();
config.auth; // plain config object — inspect before lazy-init
```

## Unified config

Author one `mountsqli.config.js` and share it between the CLI **and** your app:

```js
// mountsqli.config.js  (project root)
import { defineConfig } from "@mountsqli/core";
import { users, posts } from "./schema/index.js";

export default defineConfig({
  driver: "sqlite",
  url: "./dev.db",
  schema: "./schema",
  tables: [users, posts],
});
```

```js
// schema/users.js
import { defineTable, int, text } from "@mountsqli/core";
export const users = defineTable("users", { id: int().pk(), email: text().notNull().unique() });
```

The `schema` field tells the CLI's `loadMountConfig()` where to look when using the zero-config path. Explicit `tables` lets bundlers trace the module dependency graph.

`defineConfig(config)` — typed helper, zero runtime cost (identity function).

`loadMountConfig(path?)`:
- with **no path**, walks UP from `cwd` to find `mountsqli.config.{js,mjs,cjs,ts,json}`;
- imports `.js`/`.ts` as real ES modules (default export or named `config`/`mount`), so `defineTable` gives full type-safety;
- parses legacy `.json` snapshots;
- collects tables from `schema` folders/globs (when no explicit `tables`).

`findMountConfig(cwd?)` returns the discovered path. `collectSchema(schema, fromFile)` is the folder auto-detection primitive.

## Feature highlights

```ts
// Typed column narrowing
const names = await db.query(users).select("id", "name");
//    names: Pick<Row<typeof users>, "id" | "name">[]

// Multi-row insert (one round trip)
await db.query(users).insert([
  { email: "a@b.c" },
  { email: "b@c.d" },
]);

// Upsert
await db.query(users).upsert({ id: 1, email: "a@b.c" }, ["id"], { email: "a@b.c" });

// Aggregates
const [{ cnt }] = await db.query(users).count("cnt").select();

// Window functions
const ranked = await db.query(users)
  .rowNumber("rn", ["dept_id"], [{ column: "salary", dir: "desc" }])
  .select();

// Full-text search
const results = await db.query(posts)
  .ftsSearch("fts5", ["title", "body"], "hello")
  .select();

// JSON extract
const extracted = await db.query(users)
  .jsonExtract("meta", "$.name", "user_name")
  .select();

// Composable filter operators (import and, or, eq, gt from @mountsqli/core)
const rows = await db.query(users)
  .where(and(eq("status", "active"), or(gt("age", 18), eq("role", "admin"))))
  .select();

// Fluent eager-loading with findMany
const postsWithAuthor = await db.query(posts)
  .findMany({
    with: { author: true },
    where: eq("status", "published"),
    orderBy: [{ column: "created_at", dir: "desc" }],
  });

// Row-level locking
await db.query(orders)
  .where("status", "=", "pending")
  .forUpdate(true)  // NOWAIT
  .select();

// RETURNING clause
const [user] = await db.query(users)
  .returning("id", "email")
  .insert({ email: "a@b.c" });

// FOREIGN KEY + ENUM + defaultNow schema
const posts = defineTable("posts", {
  id: int().pk(),
  user_id: int().references("users", "id", { onDelete: "CASCADE" }),
  status: enum_("draft", "published"),
  created_at: timestamp().defaultNow(),
});

// Transactions with savepoints
const result = await db.transaction(async (tx) => {
  const r = await tx.query(users).insert({ email: "a@b.c" });
  await tx.savepoint?.("sp1");
  return r;
});

// Batch execution
const [insertResult, countResult] = await db.batch([
  sql`INSERT INTO logs (msg) VALUES ('hello')`,
  sql`SELECT COUNT(*) as cnt FROM logs`,
]);
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `mountsqli(override?)` | fn | Load `mountsqli.config.js` **or** pass inline `{driver, url, tables}` → `Db`. `await` it. |
| `mountsqliFull(override?)` | fn | Like `mountsqli()` but also returns the resolved `MountConfig` (with subsystem sections). |
| `mountsqliExtended(override?)` | fn | Like `mountsqli()` with lazy `.auth`, `.storage`, `.realtime`, `.cache` on `Db`. |
| `MountConfig` | type | `{ tables, driver?, url?, schema?, ai?, api?, auth?, storage?, realtime?, cache? }`. |
| `Db<TTables>` | type | `{ tables, query, sql, raw, driver, close, transaction, batch, cache? }`. |
| `defineConfig(config)` | fn | Typed helper for `mountsqli.config.js` — zero runtime cost (identity function). |
| `loadMountConfig(path?)` | fn | Load `mountsqli.config.*` → `MountConfig` (shared by CLI + app); walks up cwd, auto-collects `schema` folder. |
| `findMountConfig(cwd?)` | fn | Path to the discovered config file (walks up). |
| `collectSchema(schema, fromFile)` | fn | Auto-detect `defineTable` exports in a folder/glob. |
| `CONFIG_NAMES` | const | Candidate config filenames in priority order. |
| `resolveSqliteUrl(url)` | fn | Parse SQLite connection string (`:memory:`, `file:path`, `sqlite:///path`). |
| *re-exports* | — | `defineTable`, column builders, `QueryBuilder`, `sql`, `compilePlan`, `NodeSqliteDriver`, and all schema/query/compiler/driver types (including `WindowDef`, `OnConflict`, `FtsDef`, `JsonOp`, `AggregateDef`, `Driver`, `Transaction`). |

`core` is intentionally light: RLS policy pushdown lives in `@mountsqli/auth` and storage in `@mountsqli/storage`, so `core` pulls in only what a minimal app needs.
