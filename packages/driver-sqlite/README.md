# @mountsqli/driver-sqlite

Zero-dependency SQLite driver for MountSQLI, backed by Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) (Node 22.5+).

## Install

```bash
pnpm add @mountsqli/driver-sqlite
```

## Usage

```ts
import { NodeSqliteDriver } from "@mountsqli/driver-sqlite";

const driver = new NodeSqliteDriver("./app.db"); // or ":memory:"
await driver.init(tables);
const result = await driver.query(compiled, "many");
```

## Highlights

- **Zero dependencies** — uses `node:sqlite`, no native build step.
- **Boolean decode** — SQLite has no boolean type, so `true/false` are stored as `1/0`; the driver decodes them back to `boolean` on read using `columnTypes` from the plan.
- **Bound parameters only** — values from the `QueryPlan` flow through as `?` placeholders; nothing is concatenated.
- **Savepoints** — nested transaction support via `savepoint()`, `rollbackTo()`, `release()`.
- **Health check** — `ping()` runs `SELECT 1` to verify the connection is alive.
- Implements the full `Driver` contract from `@mountsqli/driver`.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `NodeSqliteDriver` | class | `Driver` implementation over `node:sqlite`. |
| `resolveSqliteUrl(url)` | fn | Parse SQLite connection strings: `:memory:`, `sqlite::memory:`, `sqlite:///path`, `file:path`, or plain file path. |

Requires Node 22.5+.
