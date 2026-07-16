# @mountsqli/migration

Migration engine: diff two schema snapshots, generate SQL, introspect a live DB, and apply/rollback inside a transaction.

## Install

```bash
pnpm add @mountsqli/migration
```

## Pure diff & generate

```ts
import { diffTables, tablesOf, generateMigrationSQL, sqliteDialect } from "@mountsqli/migration";

const before = tablesOf(usersV1);
const after  = tablesOf(usersV2);

const { changes, destructive } = diffTables(before, after);
const sql = generateMigrationSQL(changes, sqliteDialect);
```

`diffTables` and `generateMigrationSQL` are **pure functions** over `TableDef[]` — no DB access. `destructive` lists `drop_table` / `drop_column` / `alter_column` changes so a tool can gate them behind review.

## Introspect & apply

```ts
import { introspect, Migrator } from "@mountsqli/migration";

const live = await introspect(driver);            // TableDef[] from the running DB
const migrator = new Migrator(driver);
await migrator.apply(sql);                          // runs in a tx, records _mount_migrations
await migrator.status();                            // applied vs pending
```

`Migrator` is the only part that touches the database. Each applied migration is recorded in a `_mount_migrations` table inside a transaction.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `diffTables(before, after)` | fn | Structured, ordered `Change[]` + `destructive[]`. |
| `tablesOf(...tables)` | fn | `Table` → `TableDef[]`. |
| `generateMigrationSQL(changes, dialect)` | fn | Emit DDL per dialect. |
| `introspect(driver)` | fn | Live schema → `TableDef[]`. |
| `Migrator` | class | `apply`, `status`, rollback (tx + bookkeeping). |
