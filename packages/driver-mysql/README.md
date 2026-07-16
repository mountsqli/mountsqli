# @mountsqli/driver-mysql

MountSQLI MySQL driver (built on `mysql2`). It implements the same `Driver` contract as the SQLite and Postgres drivers, so multi-driver is a **configuration detail**: point `mountsqli({ driver: "mysql", url, tables })` at a MySQL instance and the compiler picks the `mysqlDialect`.

## Install

```bash
pnpm add @mountsqli/driver-mysql mysql2
```

## Use

```ts
import { mountsqli } from "@mountsqli/core";
import "@mountsqli/driver-mysql"; // side-effect: registers the "mysql" driver

const db = await mountsqli({
  driver: "mysql",
  url: "mysql://user:pass@localhost:3306/mydb",
  tables: [/* defineTable(...) */],
});

await db.query(users).insert({ email: "a@b.c" });
```

Or from the CLI (auto-detected via `mountsqli.config.js` → `driver: "mysql"`):

```bash
npx mountsqli migrate generate
npx mountsqli dev
```

## How it maps to MySQL

| Concern | Mapping |
| --- | --- |
| Placeholders | compiled `?` pass through unchanged (positional, like SQLite) |
| Identifier quoting | backticks (`` `col` ``) |
| Auto-increment PK | `INTEGER PRIMARY KEY AUTO_INCREMENT` is emitted in DDL |
| `lastId` / RETURNING | MySQL has no `RETURNING` — `lastId` comes from `insertId`. For `RETURNING` emulation, the driver does a `SELECT` back after INSERT when `compiled.returning` is set. |
| Booleans | stored as `TINYINT(1)`; bound `0`/`1`, decoded back to `boolean` on read |
| Types | `int→INTEGER`, `text→VARCHAR(255)`, `real→DOUBLE`, `bool→TINYINT(1)`, `blob→BLOB`, `json→JSON`, `uuid→CHAR(36)`, `timestamp→TIMESTAMP` |

Because `mysqlDialect.supportsReturning` is `false`, insert plans don't emit `RETURNING` in SQL; instead the compiler sets `compiled.returning` and the driver fetches the inserted row back via `SELECT ... WHERE id = ?`.

## Savepoints

MySQL transactions support savepoints for nested rollbacks:

```ts
await db.transaction(async (tx) => {
  await tx.savepoint?.("sp1");
  // ... do risky work ...
  await tx.rollbackTo?.("sp1");
});
```

## Health check

```ts
const alive = await driver.ping(); // true if SELECT 1 succeeds
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `MysqlDriver` | class | `Driver` implementation over `mysql2`. |
| `MysqlConfig` | type | `{ url? \| host?, port?, user?, password?, database?, pool? }`. |
| `resolveUrl(url)` | fn | Parse MySQL connection string into `MysqlConfig`. |
| `registerDriver("mysql")` | side-effect | enables `mountsqli({ driver: "mysql", … })`; also registered as `"mysql2"`. |

`mysql2` is loaded lazily via `import("mysql2/promise")`, and a `pool` can be injected for tests/serverless (see `test/mysql.test.ts`, which uses a fake pool — no real MySQL required).

## Tests

```bash
pnpm --filter @mountsqli/driver-mysql test   # vitest: $?->? pass-through, AUTO_INCREMENT DDL, lastId, registration
```
