# @mountsqli/driver

The driver contract, a registry, and the in-memory `MockDriver`. Drivers are intentionally **thin**: they only translate `{ sql, params, columnTypes }` → rows. All query logic lives in `@mountsqli/compiler` / `@mountsqli/query`.

## Install

```bash
pnpm add @mountsqli/driver
```

## The contract

```ts
import type { Driver, QueryResult, Transaction } from "@mountsqli/driver";

interface Driver {
  readonly name: string;
  readonly ready: Promise<void>;
  init(tables: TableDef[]): Promise<void>;
  query<T>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  ping?(): Promise<boolean>;  // Health check
}

interface Transaction {
  query<T>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint?(name: string): Promise<void>;   // Nested transaction
  rollbackTo?(name: string): Promise<void>;  // Roll back to savepoint
  release?(name: string): Promise<void>;     // Release savepoint
}
```

Drivers decode booleans stored as `0/1` back to `boolean` on read, using `columnTypes` carried in the plan.

## Registry

```ts
import { registerDriver, createDriver, listDrivers } from "@mountsqli/driver";

registerDriver("sqlite:memory", () => new MockDriver());
const d = createDriver("sqlite:memory"); // looks up the registry
listDrivers(); // ["sqlite:memory", ...]
```

## MockDriver

An in-memory driver for plan-level unit tests and the test suite. Implements the full `Driver` interface without a real database.

## Adding a new driver

A new database = a new `driver-*` package that implements `Driver` + supplies a `Dialect` from `@mountsqli/compiler`. **No query/IR logic is duplicated per driver** — multi-driver support is a configuration detail.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `Driver`, `Transaction`, `QueryResult` | type | The driver contract. |
| `ExecuteMode`, `QueryResult` | type | Run/one/many modes + result shape. |
| `registerDriver(name, factory)` | fn | Register a named driver factory. |
| `createDriver(name)` | fn | Resolve a registered driver. |
| `listDrivers()` | fn | List registered driver names. |
| `MockDriver` | class | In-memory driver for tests. |
| `MountError`, `MountErrorCode` | class/type | Structured error with typed codes and safe `toJSON()`. |
| `validateTableName`, `validateColumnName` | fn | Identifier validation guards. |
| `validateFileKey`, `validateChannelName` | fn | Path/channel validation guards. |
| `parseJsonBody`, `safeErrorResponse` | fn | Safe JSON parsing and error serialization (no stack leaks). |
| `corsHeaders`, `clampInt`, `classifySql` | fn | CORS helpers, numeric clamping, SQL guard. |
| `RateLimiter`, `RateLimiterConfig` | class/type | Sliding-window rate limiter — `check(key)`, `timeUntilReset(key)`. |
| `tracer`, `traceSpan` | fn/fn | Request tracing helpers — `tracer(name, fn)`, `traceSpan(name, fn)`. |
