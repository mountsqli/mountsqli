# @mountsqli/schema

Schema definitions, phantom-typed column builders, and compile-time type inference for MountSQLI.

This package has **no runtime dependencies**. It defines the `TableDef` data shape that every other package consumes, plus the type-level machinery (`InferTable`, `InferCol`) that makes queries type-safe without codegen, decorators, or a custom DSL.

## Install

```bash
pnpm add @mountsqli/schema
```

## Usage

```ts
import { defineTable, int, text, bool, enum_ } from "@mountsqli/schema";

export const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull().unique(),
  age: int(),            // nullable by default
  active: bool().default(true),
  role: enum_("admin", "user", "moderator"),
}, {
  // Multi-column constraints
  checks: ["age >= 0"],
});

// Foreign key reference
const posts = defineTable("posts", {
  id: int().pk(),
  title: text().notNull(),
  user_id: int().references("users", "id", { onDelete: "CASCADE" }),
  created_at: timestamp().defaultNow(),
  updated_at: timestamp().defaultNow().onUpdate(),
});

// InferTable gives you the row type
type UserRow = typeof users extends { row: infer R } ? R : never;
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `defineTable(name, columns, options?)` | fn | Build a `Table` with name, columns, and inferred `row` type. `options` supports `primaryKey`, `unique`, `foreignKeys`, `checks` for multi-column constraints. |
| `int / text / real / bool / blob / json / uuid / timestamp / enum_` | fn | Column builders, each phantom-typed to a `ColumnType`. `enum_(...)` creates an enum column with `CHECK` constraint in DDL. |
| `ColumnBuilder` | class | `.pk().notNull().unique().default(v).references(table, col, opts?).check(expr).defaultNow().onUpdate(expr?)`. |
| `ColumnDef`, `TableDef`, `ForeignKeyDef`, `TableOptions` | type | Serialized schema shape consumed by compiler/migration/driver. |
| `InferTable`, `InferCol`, `TypeMap` | type | Compile-time row/column inference. |
| `createTableSQL(table, typeName)` | fn | Emit DDL for a `TableDef` (includes FK, CHECK, ON UPDATE, multi-column constraints). |
| `belongsTo / hasMany / hasOne / resolveRelations` | fn/class | Relationship definitions and batch-loading resolver. |

## Columns

Builders chain modifiers and carry their nullability + type into the inferred row type, so

- `notNull()` removes `| null` from the inferred field,
- `pk()` / `unique()` / `default()` flow into `ColumnDef` for migration diffing,
- `references(table, col, opts?)` adds FOREIGN KEY with optional `onDelete`/`onUpdate`,
- `check(expr)` adds a CHECK constraint,
- `defaultNow()` sets `DEFAULT CURRENT_TIMESTAMP`,
- `onUpdate(expr?)` adds `ON UPDATE` (default: `CURRENT_TIMESTAMP`),
- `enum_(...values)` creates an enum column — DDL emits `CHECK(col IN (...))`,
- no runtime reflect-metadata or decorators are used.
