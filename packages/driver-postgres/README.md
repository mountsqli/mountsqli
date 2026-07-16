# @mountsqli/driver-postgres

PostgreSQL driver for MountSQLI, built on [`pg`](https://node-postgres.com).

## Install

```bash
pnpm add @mountsqli/driver-postgres pg
```

## Usage

```ts
import { PostgresDriver } from "@mountsqli/driver-postgres";

const driver = new PostgresDriver({ url: "postgres://user:pass@localhost:5432/db" });
await driver.init(tables);
const result = await driver.query(compiled, "many");
```

## Highlights

- **`$N` parameter translation** — the compiler emits `?` placeholders; this driver rewrites them to PostgreSQL's positional `$1, $2, ...` form before execution. The translation is pure and unit-tested with an injected **fake `Pool`**, so the real `pg` client is never required for tests.
- **Bound parameters only** — injection-safe by construction.
- **Boolean decode** — decodes `bool` columns back to `boolean` using `columnTypes` from the plan.
- **Savepoints** — nested transaction support via `savepoint()`, `rollbackTo()`, `release()`.
- **Health check** — `ping()` connects to the pool and runs `SELECT 1`.
- **Borrow/release** — `borrow()` returns a client for request-scope connection reuse.
- **Transactions classify commit failures** — `transaction()` wraps `COMMIT` in its own try/catch and classifies errors into `MountError` (`QUERY_FAILED`), attempting `ROLLBACK` on failure. A failed commit no longer surfaces as an unhandled raw error.
- Implements the full `Driver` contract from `@mountsqli/driver`.

## Config

```ts
interface PostgresConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | Record<string, unknown>;
  poolSize?: number;
  maxRetries?: number;
  pool?: { query(text: string, params: unknown[]): Promise<{ rows: unknown[] }> };
}
```

You may pass a `pool` for testing or to supply your own `pg.Pool`.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `PostgresDriver` | class | `Driver` implementation over `pg`. |
| `PostgresConfig` | type | Connection configuration. |
| `buildPgConfig(cfg)` | fn | Build a config object from `PostgresConfig` for use with `pg.Pool`. |
