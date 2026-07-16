# @mountsqli/studio

MountSQLI Studio — the visual dashboard for a MountSQLI backend: a **data browser**, a **SQL console**, an **ERD**, a **migrations** view, and a **cache dashboard**. It is a self-contained SPA plus an engine-backed controller, and it is served **merged into `mountsqli dev`** on a single port (there is no separate `mountsqli studio` command).

## Run it

```bash
npx mountsqli dev --port 3737       # auto-detect mountsqli.config.js
# open http://localhost:3737        # Studio dashboard (SPA)
```

The same server also serves REST CRUD (`/<table>`), storage (`/files/*`), and realtime (`/live/*`) — see `@mountsqli/cli`.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | GET | Studio dashboard (SPA) |
| `/api/studio/tables` | GET | List configured tables + columns |
| `/api/studio/data/:table` | GET / POST / PUT / DELETE | Browse / insert / update / delete rows (paginated, sortable, searchable) |
| `/api/studio/sql` | POST | Run arbitrary SQL through the driver |
| `/api/studio/erd` | GET | Tables + columns for the ERD |
| `/api/studio/migrations` | GET | Applied vs pending migrations |
| `/api/studio/health` | GET | Dialect + table count |
| `/api/studio/cache/stats` | GET | Live L1/L2 cache metrics, hit rates, top keys |
| `/api/studio/cache/clear` | POST | Flush the entire cache |
| `/api/studio/cache/invalidate/:tag` | POST | Invalidate entries by tag |

## Hard invariant: engine-backed only

The dashboard never touches the database with its own client (no `pg`, no `better-sqlite3`). Every call goes through `Db` / `Driver` + the `QueryPlan` compiler:

- reads/inserts/updates/deletes are built as **parameterized `QueryPlan` IR** and compiled by `compilePlan(plan, dialect)` — values become bound parameters, so the UI is injection-safe by construction;
- the SQL console routes text through `driver.query({ sql, params }, mode)` — still parameter-bound, just free-form;
- dialect is chosen from `db.driver.name` (`postgresDialect` vs `sqliteDialect`).

This keeps `@mountsqli/studio` consistent with the repo's core bet: **queries are data**, and the only thing that talks to a DB is the compiler + driver.

## Library usage

```ts
import { buildMergedContext, startMergedServer } from "@mountsqli/studio";

const db = await mountsqli();
const ctx = buildMergedContext(db);   // wires router + storage + hub + studio
startMergedServer(ctx, { port: 3737 });
```

Lower-level pieces are also exported for testing or a custom UI:

- `makeStudioContext(db)` → `StudioContext` (`{ db, dialect }`)
- `handleStudio(ctx, req, res)` — standalone Studio request handler
- `startStudioServer(ctx, opts)` — Studio-only server (not used by the CLI)
- controller functions: `listTables`, `tableData`, `insertRow`, `updateRow`, `deleteRow`, `runSql`, `erd`, `migrations`, `health`

Tests use `node:sqlite` (real driver) and `MockDriver` for plan-level assertions — see `test/studio.test.ts`.
