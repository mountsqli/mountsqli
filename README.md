# MountSQLI

> Next-generation type-safe SQL engine & backend platform.
> **Native SQL first · Type-safe everything · Zero config · AI native.**

MountSQLI is a **compile-leaning ORM + backend engine**. The ORM is a
**compiler + an intermediate representation (QueryPlan IR)**, not a class
hierarchy — that is what makes it tree-shakeable, edge-ready, and
near-zero-allocation where Prisma/Drizzle/TypeORM cannot be.

- **Native SQL first** — the query builder is a typed view over SQL, never a replacement.
- **Type-safe everything** — invalid queries are *type errors*, not runtime errors.
- **Zero runtime cost where possible** — IR/compiler over classes; tree-shake to the feature.
- **Compile-time validation** — no generators, no decorators, no bespoke schema language.
- **AI native** — any AI-generated SQL goes through the same compiler validator as hand-written input.

## Packages

This is a pnpm monorepo. Each package is published independently to npm
under the `@mountsqli/*` scope.

| Package | What it is |
| --- | --- |
| `@mountsqli/core` | Umbrella: `mountsqli()` + `defineTable`, `QueryBuilder`, `sql`, `compilePlan`. |
| `@mountsqli/schema` | Schema definitions, phantom-typed column builders, `InferTable`, DDL. |
| `@mountsqli/compiler` | QueryPlan IR, `Dialect` (sqlite/pg/mysql), `optimize()`, `suggestIndexes()`. |
| `@mountsqli/query` | Fluent, type-safe builder + `sql` template tag. |
| `@mountsqli/cache` | Multi-level cache: L1 memory (LRU/LFU/FIFO), L2 Redis, query cache, auto-invalidation. |
| `@mountsqli/driver` | `Driver`/`Transaction`/`QueryResult` contract + registry + `MockDriver`. |
| `@mountsqli/driver-sqlite` | Zero-dep `node:sqlite` driver (bool decode). |
| `@mountsqli/driver-postgres` | `pg` driver with `?`→`$N` translation. |
| `@mountsqli/driver-mysql` | `mysql2` driver with `?` pass-through + `AUTO_INCREMENT`. |
| `@mountsqli/migration` | `diffSchemas`, `generateMigrationSQL`, `introspect`, `Migrator`. |
| `@mountsqli/auth` | scrypt passwords, HS256/EdDSA JWT, sessions, RBAC, RLS policy pushdown. |
| `@mountsqli/storage` | StorageAdapter, HMAC signed URLs, content-addressed versioning. |
| `@mountsqli/realtime` | Hub, Channel, PresenceChannel, LiveQuery (SSE). |
| `@mountsqli/ai` | `ModelProvider`, `nlToSql`, `explain`/`optimize`/`review`. |
| `@mountsqli/api` | Router + OpenAPI/REST/tRPC codegen from named QueryPlans. |
| `@mountsqli/studio` | Visual dashboard (data browser, SQL console, ERD, migrations, cache), engine-backed. |
| `@mountsqli/cli` | `mountsqli migrate` / `init` / `dev` / `api generate` / `analyze` / `cache` (`npx mountsqli`). |

## Quick start

```bash
npm i @mountsqli/core
```

```ts
import { mountsqli, defineTable, int, text, defineConfig } from "@mountsqli/core";

const users = defineTable("users", { id: int().pk(), email: text().notNull().unique() });

// Inline config (works everywhere):
const db = await mountsqli({ driver: "sqlite", url: ":memory:", tables: [users] });
await db.query(users).insert({ email: "a@b.c" });
const rows = await db.query(users).select();
```

### Key features

```ts
// Typed column narrowing — returns Pick<Row, "id" | "email">[]
const subset = await db.query(users).select("id", "email");

// Multi-row insert
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

// JSON operations
const extracted = await db.query(users)
  .jsonExtract("metadata", "$.name", "user_name")
  .select();
```

Developer CLI:

```bash
npx mountsqli init     # scaffold mountsqli.config.js + schema/
npx mountsqli dev      # zero-dep server: REST CRUD + storage + realtime + Studio dashboard
npx mountsqli migrate generate
npx mountsqli analyze
npx mountsqli cache stats   # live cache metrics
```

## Building & testing (monorepo)

```bash
pnpm install
pnpm build          # build every package in dependency order
pnpm typecheck      # tsc --noEmit per package
pnpm test           # vitest per package
```

Node 22.5+ is required (`node:sqlite`).

## Security model

- **Injection-safe by construction** — the compiler emits only bound parameters; identifiers are quoted/escaped. Raw-SQL escape hatches (`selectExpr`/`whereExpr`) are guarded against `;`, `--`, and `/*`.
- **Structured errors** — every external-facing path emits a `MountError` with a code + sanitized message; raw library detail stays in `details`.
- **Auth hardening** — JWT algorithm is server-enforced (no algorithm confusion); passwords use scrypt at `N=2^15` with the cost persisted in the hash; signed URLs compare with a timing-safe check; login brute-force protection is opt-in (`rateLimit` / `MemoryRateLimiter`).
- **CI** — `.github/workflows/ci.yml` gates every push/PR: build → typecheck → test on Node 24.
- See `CLAUDE.md` ("Security & error-handling hardening") for the full audit-driven guarantee list.

## License

MIT
