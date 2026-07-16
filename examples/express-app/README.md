# MountSQLI Express.js Example (Postgres)

A comprehensive CRUD + analytics API built with Express.js and MountSQLI, demonstrating every feature of the engine.

## Quick Start

```bash
# Create Postgres database
createdb mountsqli_express

# Set connection string
export DATABASE_URL=postgres://localhost:5432/mountsqli_express

# Install
pnpm install

# Seed data
pnpm seed

# Start server
pnpm dev
```

## Schema

6 tables with full relations:

| Table | PK | Relations |
|-------|----|-----------|
| `users` | uuid | hasMany posts, hasMany comments, hasOne profile |
| `categories` | uuid | — |
| `posts` | uuid | belongsTo author (users), hasMany comments, hasMany post_categories |
| `comments` | uuid | belongsTo author (users), belongsTo post |
| `post_categories` | composite (post_id, category_id) | belongsTo post, belongsTo category |
| `profiles` | uuid | belongsTo user |

Schema features demonstrated: `uuid()` PKs with `gen_random_uuid()`, `enum_()`, `references()` with FK, `defaultNow()`, `onUpdate()`, `json()`, `bool()`, composite primary keys, multi-column `checks`, relationships (`belongsTo`, `hasMany`, `hasOne`).

## API Endpoints

### Users

| Route | Feature |
|-------|---------|
| `GET /users` | List with composable filters (eq, gte, lte, like, inArray, isNull, and, or), pagination, sort |
| `GET /users/:id` | `findOne` lookup |
| `POST /users` | Create with `RETURNING` |
| `PUT /users/:id` | Update with `RETURNING` |
| `DELETE /users/:id` | Delete with `RETURNING` |
| `GET /users/cursor/:id` | Cursor-based pagination |
| `POST /users/ensure` | `insertIgnore` (ON CONFLICT DO NOTHING) |
| `GET /users/:id/metadata` | `jsonExtract` from JSONB column |

### Posts

| Route | Feature |
|-------|---------|
| `GET /posts` | `findMany` with nested `with` — author, comments (with nested author), post_categories (with nested category) |
| `GET /posts/:id` | `findMany` with nested author → profile, plus comments with author |
| `POST /posts` | Create with `RETURNING *` |
| `POST /posts/bulk` | Multi-row `insert` with RETURNING |
| `PUT /posts/:id` | Update |
| `DELETE /posts/:id` | Delete |
| `POST /posts/:id/publish` | Atomic transaction |
| `GET /posts/advanced` | Composable `and(eq, gte, or(eq, ne))` filters |
| `GET /posts/recent` | `whereExpr` with raw SQL date filter |

### Stats & Analytics

| Route | Feature |
|-------|---------|
| `GET /stats/posts` | Aggregates: `count`, `sum`, `avg`, `min`, `max` |
| `GET /stats/users/:id` | User post count |
| `GET /analytics/posts/ranking` | Window functions: `rowNumber`, `denseRank` |
| `GET /analytics/posts/lag` | Window functions: `lag`, `lead` |
| `GET /analytics/posts/by-status` | `GROUP BY` + `count` |
| `GET /analytics/posts/by-author` | `GROUP BY` + `HAVING` > 1 |
| `GET /analytics/posts/select-expr` | `selectExpr` raw SQL |
| `GET /analytics/posts/set` | `UNION` set operation |
| `GET /analytics/posts/distinct-on` | `DISTINCT ON` (Postgres) |
| `GET /analytics/posts/cte` | `WITH` (CTE) |
| `GET /analytics/posts/raw-sql` | `sql` template tag |
| `GET /analytics/custom` | `raw()` method |

### Other

| Route | Feature |
|-------|---------|
| `POST /categories` | `upsert` with RETURNING |
| `POST /transfer-points` | Transaction: atomic points transfer |
| `POST /batch` | Batch queries in transaction |
| `GET /search/posts` | `LIKE` search across title, body, excerpt |
| `GET /` | Dashboard with aggregates + findMany |
| `GET /health` | Health check |

## Features Map

| Category | MountSQLI API |
|----------|--------------|
| Schema | `defineTable`, `int`, `text`, `bool`, `json`, `uuid`, `timestamp`, `enum_`, `.pk()`, `.default()`, `.defaultNow()`, `.onUpdate()`, `.unique()`, `.notNull()`, `.nullable()`, `.references()`, `.check()` |
| Relations | `belongsTo`, `hasMany`, `hasOne`, `.foreignKey()`, `.localKey()` |
| Config | Inline `mountsqli({ driver, url, tables })` |
| CRUD | `.select()`, `.findOne()`, `.insert()`, `.update()`, `.delete()` |
| Composables | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `inArray`, `isNull`, `and`, `or` |
| Eager-loading | `.findMany({ with: { relation: { with: { nested: true } } } })` |
| RETURNING | `.returning()` / `.returning("col1", "col2")` |
| Transactions | `db.transaction(fn)` |
| Aggregates | `.count()`, `.sum()`, `.avg()`, `.min()`, `.max()` |
| Window | `.rowNumber()`, `.denseRank()`, `.rank()`, `.lag()`, `.lead()`, `.firstValue()`, `.lastValue()`, `.ntile()` |
| Set ops | `.union()`, `.unionAll()`, `.intersect()`, `.except()` |
| CTE | `.with(name, queryBuilder)` |
| UPSERT | `.upsert(values, constraint, set)` + `.insertIgnore(values, constraint)` |
| Pagination | `.paginate(page, perPage)` + `.cursor(col, val, op)` |
| Locking | `.forUpdate()`, `.forShare()`, `.forNoKeyUpdate()`, `.forKeyShare()` |
| JSON | `.jsonExtract()`, `.jsonAgg()`, `.jsonObject()`, `.jsonArray()`, `.jsonSet()` |
| Raw SQL | `sql` template tag, `db.raw()`, `.selectExpr()`, `.whereExpr()` |
| Filter | `.where(and/or/eq/...)`, `.where(col, op, val)`, `.whereExpr()` |
| ORDER BY | `.orderBy(col, dir)` |
| GROUP/HAVING | `.groupBy()`, `.having()` |
| DISTINCT | `.distinct()`, `.distinctOn()` |
| JOIN | `.join()`, `.withRelations()` |
| FTS | `.ftsSearch()` (LIKE fallback) |
