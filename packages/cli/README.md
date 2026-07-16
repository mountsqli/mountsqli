# @mountsqli/cli

The `mountsqli` command-line interface: migrations, a zero-dependency dev server, and schema analysis.

## Install

```bash
pnpm add -D @mountsqli/cli
# also install core — your schema/ files import defineTable from it:
pnpm add @mountsqli/core
```

The `mountsqli` binary is installed into your project's `node_modules/.bin`, so run it through your package manager's runner — **`npx mountsqli <cmd>`** (or `pnpm exec mountsqli <cmd>`), not a bare `mountsqli`. From the CLI's own monorepo you can also run `node packages/cli/dist/bin.js <cmd>` directly.

## Config

`mountsqli.config.js` — a real ES module at your project root, shared with your app. Point `schema` at a folder of `defineTable(...)` modules; every table export is auto-detected:

```js
// mountsqli.config.js  (project root)
import { defineConfig, defineTable, int, text } from "@mountsqli/core";

export const users = defineTable("users", { id: int().pk(), email: text().notNull().unique() });

export default defineConfig({
  driver: "sqlite",        // "sqlite" | "postgres" | "mysql"
  url: "./dev.db",         // file path or connection string
  schema: "./schema",      // folder of defineTable(...) modules (auto-collected)
  tables: [users],         // explicit — works with bundlers (Turbopack) and CLI
});
```

`npx mountsqli init` scaffolds this file. (`:memory:` is fresh per process; use a file URL to persist the `_mount_migrations` table.)

**`-c` is optional** — when omitted, `mountsqli` walks UP from the current directory to find `mountsqli.config.*` at the project root.

## Commands

### Migrations

```bash
npx mountsqli migrate generate              # auto-detect mountsqli.config.js (walk up from cwd)
npx mountsqli migrate apply                 # same auto-detect
npx mountsqli migrate status                # applied vs pending
npx mountsqli migrate down                  # rollback last migration
```

### Scaffold

```bash
npx mountsqli init                # writes mountsqli.config.js + schema/ with a starter table
```

`npx mountsqli init` scaffolds the whole project at once:

```
mountsqli.config.js           # points `schema` at ./schema
schema/users.js               # starter table (export const users = defineTable(...))
```

Every `export const x = defineTable(...)` under `schema/` is auto-detected — edit `users.js` or add more table modules, no list to maintain. Running `npx mountsqli init` again is a no-op if both files already exist. `loadMountConfig()` in `@mountsqli/core` is the **shared loader** — your app and the CLI read the exact same file.

### Dev server (zero-dep)

```bash
npx mountsqli dev --port 3737             # auto-detect mountsqli.config.js
```

`npx mountsqli dev` boots the database the same way your app does — by calling `mountsqli()` (the single `mountsqli.config.js` source of truth) — then wires `@mountsqli/api` + `@mountsqli/storage` + `@mountsqli/realtime` + the compiler + **the Studio dashboard** into one zero-dependency HTTP server:

| Route | Method | Purpose |
| --- | --- | --- |
| `/<table>` | GET / POST | List / create rows |
| `/<table>/:id` | GET / PUT / DELETE | Read / update / delete one |
| `/files/<key>` | PUT / GET / DELETE | Upload / download / delete an object |
| `/files/<key>/url` | GET | HMAC-signed URL for a private object |
| `/live/<channel>` | SSE | Subscribe to a realtime channel |
| `/live/<channel>/publish` | POST | Broadcast to a channel |
| `/` | GET | **MountSQLI Studio** dashboard (SPA) |
| `/api/studio/*` | GET / POST / PUT / DELETE | Dashboard JSON: tables, data browser, SQL console, ERD, migrations, health |

All REST list endpoints support query-string filter/sort/pagination:
```
?filter[age]=gt:18&sort=-createdAt&page=2&per_page=10
```
Errors use RFC 7807 problem detail format. Rate limiting is built-in (1000 req/min/IP by default); configure via `DevOptions.rateLimit`.

The Studio GUI is part of `@mountsqli/studio` and is served merged into `mountsqli dev` — there is no separate `mountsqli studio` command. Every byte the dashboard shows is read through the engine (`Db`/`Driver` + the `QueryPlan` compiler), never a direct DB client, so the dashboard is injection-safe by construction.

### API generation

```bash
npx mountsqli api generate -o openapi.json  # auto-detect mountsqli.config.js
```

### Cache management

```bash
npx mountsqli cache stats               # live hit rate, entries, memory, top keys
npx mountsqli cache clear                # flush all cache (or --namespace)
npx mountsqli cache inspect <key>        # one entry's metadata + value
npx mountsqli cache analyze              # performance recommendations
npx mountsqli cache warm                 # trigger cache warming
npx mountsqli cache benchmark            # throughput benchmarks
```

The cache commands connect to the running dev server or the local L1 cache. Stats include hit rates, evictions, compression ratio, and top cached keys.

### Analysis

```bash
npx mountsqli analyze                    # auto-detect mountsqli.config.js
```

Prints a health report: schema drift vs the live DB, index suggestions from `suggestIndexes`, and plan warnings (e.g. `[SELECT_STAR]`).

## Library exports

`lib.ts` also exposes `loadConfig`, `makeDriver`, `CliConfig`, and the `cmd*` functions (`cmdGenerate`, `cmdApply`, `cmdDown`, `cmdAnalyze`, ...) for in-process use and testing.
