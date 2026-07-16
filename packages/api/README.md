# @mountsqli/api

API engine: build routers from named QueryPlans, then generate OpenAPI 3.1, REST handlers, and tRPC procedures. The key idea: **an endpoint is just a named QueryPlan + an optional auth middleware + a validator**. One definition yields many protocols.

## Install

```bash
pnpm add @mountsqli/api
```

## Define routes

```ts
import { createRouter, crudRoutes } from "@mountsqli/api";

const router = createRouter();

// auto-generate CRUD from a table definition
const usersApi = crudRoutes(users.def);
```

### Request body validation

Attach a validator to any route — simple shape descriptor, JSON Schema-compatible object, or custom function:

```ts
router.add({
  name: "createUser",
  method: "POST",
  path: "/users",
  plan: { op: "insert", table: "users", filters: [], columnTypes: {} },
  validator: {
    shape: { email: "string", age: "number" },       // field-type map
    // schema: { type: "object", properties: { ... } }, // JSON Schema style
    // validate: (body) => typeof body.email === "string" ? null : "email required",
  },
});
```

### Auth middleware

Apply auth functions to matching routes via `Router.use()`:

```ts
router.use(
  (r) => r.path.startsWith("/admin"),        // filter
  async (req, route) => {                    // middleware
    if (!req.headers?.authorization) throw new Error("unauthorized");
  },
);

// Or per-route:
router.add({
  ...routeDef,
  auth: async (req, route) => { /* ... */ },
});
```

Middleware runs before the handler — a throw produces a 401/403 response.

## Generate outputs

```ts
import { toOpenApi, createRestHandler, toTrpc } from "@mountsqli/api";

const openapi = toOpenApi(router, "My API");        // OpenAPI 3.1 object
const handler = createRestHandler(router);           // (req: RestRequest) => RestResponse | { route, plan }
const trpc = toTrpc(router);                          // tRPC procedure list
```

`createRestHandler` returns a framework-agnostic request handler you can mount in any HTTP server (the CLI's `mountsqli dev` wires this in). It validates the request body, **awaits** auth middleware (a failed/denied auth returns `403`), and applies rate limiting when a `RateLimiter` is passed.

> **Note:** `createRestHandler(router)` is `async` — it returns a `Promise`. Always `await` it before reading the `RestResponse | { route, plan }` it resolves.

## Query-string filter / sort / pagination

Parse REST query strings into compiler FilterNodes with `parseFilterQuery`:

```ts
import { parseFilterQuery } from "@mountsqli/api";

// ?filter[email]=eq:alice@test.com&filter[age]=gt:18&sort=-createdAt&page=2&per_page=10
const { filters, orderBy, limit, offset } = parseFilterQuery(searchParams);
// filters  → [{ kind: "filter", column: "email", op: "=", value: "alice@test.com" }, ...]
// orderBy  → [{ column: "createdAt", dir: "desc" }]
// limit    → 10
// offset   → 10
// page=2 & per_page=10 → offset=10
```

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in` (comma-separated), `between` (min,max).

## Error formatting (RFC 7807)

```ts
import { toProblemDetails, mountErrorToProblem } from "@mountsqli/api";

// Manual:
const err = toProblemDetails("email is required", 400, "/errors/validation");
// → { type, title: "Bad Request", status: 400, detail: "email is required" }

// From MountError:
const problem = mountErrorToProblem({ code: "NOT_FOUND", message: "user not found" });
// → { type: "/errors/not_found", status: 404, ... }
```

## Pagination metadata

```ts
import { paginationMeta } from "@mountsqli/api";

const meta = paginationMeta({ page: "2", per_page: "20" }, 95);
// → { page: 2, perPage: 20, total: 95, totalPages: 5, hasNext: true, hasPrev: true }
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createRouter()` | fn | Build a `Router` of named QueryPlans. |
| `Router.use(filter, middleware)` | fn | Apply auth middleware to routes matching a predicate. |
| `RouteDef`, `Router`, `ValidationShape`, `FieldType` | type | Route + validation shapes. |
| `crudRoutes(table)` | fn | Auto CRUD router from a `TableDef` (5 routes: list/get/create/update/delete). |
| `toOpenApi(router, title?)` | fn | OpenAPI 3.1 document with requestBody schemas from `validator.schema`. |
| `createRestHandler(router)` | fn | `(req, opts?) => Promise<RestResponse \| { route, plan }>`. **Async** — `await` it. Runs validation + auth (awaited; 403 on failure) + rate-limiting. |
| `toTrpc(router)` | fn | tRPC procedure list. |
| `parseFilterQuery(query, allowedCols?)` | fn | Query string → `{ filters, orderBy, limit, offset }`. |
| `toProblemDetails(detail, status, type?, title?, instance?)` | fn | RFC 7807 problem detail. |
| `mountErrorToProblem(err, instance?)` | fn | MountError → RFC 7807. Maps error codes to HTTP status. |
| `validateShape(body, shape)` | fn | Validate object against `{ field: "type" }` descriptor. |
| `paginationMeta(query, total?)` | fn | Build `{ page, perPage, totalPages, hasNext, hasPrev }`. |
| `RestRequest`, `RestResponse`, `HttpMethod`, `TrpcProcedure`, `ProblemDetail`, `PaginationMeta`, `ParsedFilter` | type | HTTP/error/pagination shapes. |
