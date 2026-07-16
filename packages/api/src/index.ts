// MountSQLI — API engine.
//
// The key idea: an endpoint is just a NAMED QueryPlan + an
// optional auth policy + a validator. One definition yields many protocols.
// This module generates:
//   - OpenAPI 3.1 fragments,
//   - REST handler functions (framework-agnostic: take a request, return a
//     response descriptor),
//   - a tRPC-style router descriptor.
// It deliberately depends only on compiler/schema so it's usable in any
// server framework (Express/Hono/Next) without pulling one in.

import type { QueryPlan } from "@mountsqli/compiler";
import type { TableDef } from "@mountsqli/schema";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A JSON Schema-like shape descriptor for request body validation. */
export type FieldType = "string" | "number" | "boolean" | "object" | "array";

export interface ValidationShape {
  [key: string]: FieldType | ValidationShape;
}

/** RFC 7807 problem detail (https://www.rfc-editor.org/rfc/rfc7807). */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  /** Additional fields allowed by RFC 7807. */
  [key: string]: unknown;
}

export interface RouteDef {
  name: string;
  method: HttpMethod;
  path: string;
  /** The plan this endpoint executes. */
  plan: QueryPlan;
  /** Optional auth policy name (resolved by the host). */
  policy?: string;
  /** Parameter sources for binding request -> plan params. */
  params?: { from: "path" | "query" | "body"; name: string; mapsTo: string }[];
  /** Short description for OpenAPI. */
  summary?: string;
  /**
   * Optional request body validation.
   * - `shape`: simple field-type map for basic validation
   * - `schema`: a JSON Schema object (compatible with Ajv)
   * - `validate`: custom validator function
   */
  validator?: {
    shape?: ValidationShape;
    schema?: Record<string, unknown>;
    validate?: (body: unknown) => string | null; // null = valid, string = error message
  };
  /** Optional auth middleware — throws on failure. */
  auth?: (req: RestRequest, route: RouteDef) => Promise<void>;
}

export interface Router {
  routes: RouteDef[];
  add(route: RouteDef): this;
  /** Apply middleware(s) to all routes matching a predicate. */
  use(filter: (r: RouteDef) => boolean, middleware: NonNullable<RouteDef["auth"]>): this;
}

export function createRouter(): Router {
  const routes: RouteDef[] = [];
  const middlewares: Array<{ filter: (r: RouteDef) => boolean; fn: NonNullable<RouteDef["auth"]> }> = [];
  return {
    routes,
    add(r) {
      // Apply registered middlewares
      const authFns = middlewares.filter((m) => m.filter(r)).map((m) => m.fn);
      if (authFns.length && !r.auth) {
        (r as any).auth = async (req: RestRequest) => {
          for (const fn of authFns) await fn(req, r);
        };
      } else if (authFns.length && r.auth) {
        const existing = r.auth;
        (r as any).auth = async (req: RestRequest) => {
          await existing(req, r);
          for (const fn of authFns) await fn(req, r);
        };
      }
      routes.push(r);
      return this;
    },
    use(filter, middleware) {
      middlewares.push({ filter, fn: middleware });
      return this;
    },
  };
}

// ---- Request body validation ----

/**
 * Validate a request body against a simple shape descriptor.
 * Returns null on success, or an error message string on failure.
 */
export function validateShape(body: unknown, shape: ValidationShape): string | null {
  if (typeof body !== "object" || body === null) return "body must be an object";
  const obj = body as Record<string, unknown>;
  for (const [key, type] of Object.entries(shape)) {
    const val = obj[key];
    if (val === undefined) continue; // optional by default
    if (typeof type === "object" && !Array.isArray(type)) {
      // Nested object validation
      const nested = validateShape(val, type as ValidationShape);
      if (nested) return `${key}.${nested}`;
    } else if (typeof type === "string") {
      if (type === "array") {
        if (!Array.isArray(val)) return `${key} must be an array`;
      } else if (typeof val !== type) {
        return `${key} must be a ${type}`;
      }
    }
  }
  return null;
}

// ---- OpenAPI generation ----

export function toOpenApi(router: Router, title = "MountSQLI API"): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, unknown> = {};
  for (const r of router.routes) {
    const op: Record<string, unknown> = {
      summary: r.summary ?? r.name,
      operationId: r.name,
      responses: { "200": { description: "OK" } },
    };
    if (r.policy) op.security = [{ bearerAuth: [] }];
    if (r.validator?.schema) {
      const schemaName = `${r.name}Body`;
      schemas[schemaName] = r.validator.schema;
      (op as any).requestBody = { content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } };
    }
    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title, version: "0.1.0" },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      ...(Object.keys(schemas).length ? { schemas } : {}),
    },
    paths,
  };
}

// ---- REST handler (framework-agnostic) ----

export interface RestRequest {
  method: HttpMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
  params: Record<string, string>;
  /** Client IP for rate limiting. */
  ip?: string;
}

export interface RestResponse {
  status: number;
  body: unknown;
  /** Response headers (e.g. rate-limit info). */
  headers?: Record<string, string>;
}

/**
 * Build a dispatcher that maps an incoming RestRequest to a named route and
 * returns the (already-compiled) QueryPlan + bound params. The host framework
 * runs the plan against its driver and serializes `body`.
 */
export function createRestHandler(router: Router) {
  return async (req: RestRequest, options?: { rateLimiter?: { check: (key: string) => boolean; timeUntilReset: (key: string) => number } }): Promise<{ route: RouteDef; plan: QueryPlan; params: Record<string, unknown> } | RestResponse> => {
    const matched = router.routes.find(
      (r) => r.method === req.method && matchPath(r.path, req.path) !== null,
    );
    if (!matched) return { status: 404, body: { error: "not found" } };

    // Rate limiting
    if (options?.rateLimiter) {
      const key = req.ip ?? "unknown";
      if (!options.rateLimiter.check(key)) {
        const retryAfter = Math.ceil(options.rateLimiter.timeUntilReset(key) / 1000);
        return {
          status: 429,
          body: { error: "rate limit exceeded" },
          headers: { "retry-after": String(retryAfter) },
        };
      }
    }

    // Auth middleware — MUST be awaited. A rejected/failed auth must block the
    // request (403) before any query runs. Fire-and-forget here previously
    // let requests through unauthenticated (auth bypass).
    if (matched.auth) {
      try {
        await matched.auth(req, matched);
      } catch {
        return { status: 403, body: { error: "Forbidden" } };
      }
    }

    // Validate request body
    if (matched.validator) {
      const body = req.body;
      if (matched.validator.shape) {
        const err = validateShape(body, matched.validator.shape);
        if (err) return { status: 400, body: toProblemDetails(err, 400, "/errors/validation") };
      }
      if (matched.validator.schema) {
        // For Ajv-compatible schemas, the host would need to pass an Ajv instance.
        // Here we do basic type checking from the schema's `properties`.
        if (matched.validator.schema.properties && typeof body === "object" && body !== null) {
          const props = matched.validator.schema.properties as Record<string, any>;
          for (const [key, def] of Object.entries(props)) {
            const val = (body as Record<string, unknown>)[key];
            if (val !== undefined && def.type && typeof val !== def.type) {
              if (def.type === "array" && Array.isArray(val)) continue;
              if (def.type === "number" && typeof val === "number") continue;
              if (def.type === "integer" && typeof val === "number" && Number.isInteger(val)) continue;
              return {
                status: 400,
                body: toProblemDetails(`${key} must be a ${def.type}`, 400, "/errors/validation"),
              };
            }
          }
        }
      }
      if (matched.validator.validate) {
        const err = matched.validator.validate(body);
        if (err) return { status: 400, body: toProblemDetails(err, 400, "/errors/validation") };
      }
    }

    // Extract :param segments from the matched path.
    const pathParams = matchPath(matched.path, req.path) ?? {};

    const params: Record<string, unknown> = {};
    for (const p of matched.params ?? []) {
      const src =
        p.from === "path"
          ? pathParams[p.name] ?? req.params[p.name]
          : p.from === "query"
            ? req.query[p.name]
            : (req.body as any)?.[p.name];
      if (src !== undefined) params[p.mapsTo] = src;
    }

    // Return a copy of the plan with bound param values injected into filters
    // by matching `mapsTo` against filter columns.
    const plan: QueryPlan = {
      ...matched.plan,
      filters: matched.plan.filters.map((f) => {
        if (f.kind === "and" || f.kind === "or" || f.kind === "subquery") return f;
        if (!f.column) return f;
        return params[f.column] !== undefined ? { ...f, value: params[f.column] } : f;
      }),
    };
    return { route: matched, plan, params };
  };
}

// ---- RFC 7807 problem details ----

/**
 * Format an error as an RFC 7807 problem detail object.
 * Use this in your HTTP responses for consistent error formatting.
 *
 * ```ts
 * json(res, 400, toProblemDetails("name is required", 400, "/errors/validation"));
 * ```
 */
export function toProblemDetails(
  detail: string,
  status: number,
  type = "/errors/generic",
  title?: string,
  instance?: string,
): ProblemDetail {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
  };
  return {
    type,
    title: title ?? titles[status] ?? "Error",
    status,
    detail,
    ...(instance ? { instance } : {}),
  };
}

/**
 * Convert a MountError to an RFC 7807 problem detail.
 */
export function mountErrorToProblem(err: { code: string; message: string }, instance?: string): ProblemDetail {
  const httpStatus = err.code === "VALIDATION" ? 400 : err.code === "NOT_FOUND" ? 404 : err.code === "CONFLICT" ? 409 : err.code === "FORBIDDEN" ? 403 : err.code === "QUERY_FAILED" ? 422 : 500;
  return toProblemDetails(err.message, httpStatus, `/errors/${err.code.toLowerCase()}`, undefined, instance);
}

// ---- Query string → filter/sort parser ----

export interface ParsedFilter {
  filters: import("@mountsqli/compiler").FilterNode[];
  orderBy: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

/**
 * Parse a query string from REST into filter/sort/pagination.
 *
 * Supported syntax:
 *   ?filter[email]=eq:alice@test.com
 *   ?filter[age]=gt:18
 *   ?filter[name]=like:%alice%
 *   ?sort=-createdAt,name
 *   ?page=2&per_page=10
 *
 * Operators: eq, neq, gt, gte, lt, lte, like, in (comma-separated), between (min,max)
 */
export function parseFilterQuery(query: Record<string, string>, allowedColumns: string[] = []): ParsedFilter {
  const filters: import("@mountsqli/compiler").FilterNode[] = [];
  const orderBy: { column: string; dir: "asc" | "desc" }[] = [];
  let limit: number | undefined;
  let offset: number | undefined;

  for (const [rawKey, rawValue] of Object.entries(query)) {
    // filter[name]=eq:value
    const filterMatch = rawKey.match(/^filter\[(.+)\]$/);
    if (filterMatch) {
      const col = filterMatch[1]!;
      if (allowedColumns.length && !allowedColumns.includes(col)) continue;
      const colonIdx = rawValue.indexOf(":");
      let op = "=";
      let val: unknown = rawValue;
      if (colonIdx > 0) {
        const prefix = rawValue.slice(0, colonIdx);
        const rest = rawValue.slice(colonIdx + 1);
        const opMap: Record<string, string> = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
        if (opMap[prefix]) {
          op = opMap[prefix]!;
          val = rest;
        } else if (prefix === "like") {
          op = "like";
          val = rest;
        } else if (prefix === "in") {
          op = "in";
          val = rest ? rest.split(",") : [];
        } else if (prefix === "between") {
          op = "between";
          val = rest ? rest.split(",") : [];
        }
      }
      // Coerce numbers
      if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val)) {
        val = Number(val);
      }
      filters.push({ kind: "filter", column: col, op: op as any, value: val });
    }

    // sort=-createdAt,name
    if (rawKey === "sort") {
      const parts = rawValue.split(",").filter(Boolean);
      for (const p of parts) {
        if (p.startsWith("-")) {
          orderBy.push({ column: p.slice(1), dir: "desc" });
        } else if (p.startsWith("+")) {
          orderBy.push({ column: p.slice(1), dir: "asc" });
        } else {
          orderBy.push({ column: p, dir: "asc" });
        }
      }
    }

    // page & per_page
    if (rawKey === "page") {
      const p = parseInt(rawValue, 10);
      if (!isNaN(p) && p > 0) offset = (p - 1) * (limit ?? 10);
    }
    if (rawKey === "per_page") {
      const p = parseInt(rawValue, 10);
      if (!isNaN(p) && p > 0) limit = p;
    }
  }

  return { filters, orderBy, limit, offset };
}

// ---- Pagination metadata helpers ----

export interface PaginationMeta {
  page: number;
  perPage: number;
  total?: number;
  totalPages?: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Build pagination metadata from request parameters and result count.
 */
export function paginationMeta(query: Record<string, string>, total?: number): PaginationMeta {
  const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
  const perPage = Math.max(1, Math.min(100, parseInt(query.per_page ?? "10", 10) || 10));
  return {
    page,
    perPage,
    total,
    totalPages: total !== undefined ? Math.ceil(total / perPage) : undefined,
    hasNext: total !== undefined ? page * perPage < total : true,
    hasPrev: page > 1,
  };
}

// ---- URL path matching ----

/** Match a `/users/:id` style route against a concrete `/users/42` path. Returns param map or null. */
function matchPath(routePath: string, reqPath: string): Record<string, string> | null {
  const rp = routePath.split("/");
  const qp = reqPath.split("/");
  if (rp.length !== qp.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < rp.length; i++) {
    const rseg = rp[i];
    const qseg = qp[i];
    if (rseg === undefined || qseg === undefined) return null;
    if (rseg.startsWith(":")) out[rseg.slice(1)] = qseg;
    else if (rseg !== qseg) return null;
  }
  return out;
}

// ---- tRPC-style router descriptor ----

export interface TrpcProcedure {
  name: string;
  input?: Record<string, string>; // field -> type name (for generated validators)
  output?: string; // table row type name
  calls: "query" | "mutation";
}

export function toTrpc(router: Router): TrpcProcedure[] {
  return router.routes.map((r) => ({
    name: r.name,
    input: Object.fromEntries((r.params ?? []).map((p) => [p.mapsTo, "string"])),
    output: r.plan.table,
    calls: r.method === "GET" ? "query" : "mutation",
  }));
}

// ---- convenience: scaffold CRUD routes from a table ----

export function crudRoutes(table: TableDef): Router {
  const pk = table.columns.find((c) => c.primaryKey)?.name ?? "id";
  const r = createRouter();
  r.add({ name: `list_${table.name}`, method: "GET", path: `/${table.name}`, plan: { op: "select", table: table.name, filters: [], columnTypes: {} }, summary: `List ${table.name}` });
  r.add({ name: `get_${table.name}`, method: "GET", path: `/${table.name}/:${pk}`, plan: { op: "select", table: table.name, filters: [{ kind: "filter", column: pk, op: "=", value: undefined }], columnTypes: {} }, params: [{ from: "path", name: pk, mapsTo: pk }], summary: `Get one ${table.name}` });
  r.add({ name: `create_${table.name}`, method: "POST", path: `/${table.name}`, plan: { op: "insert", table: table.name, filters: [], columnTypes: {}, values: {} }, summary: `Create ${table.name}` });
  r.add({ name: `update_${table.name}`, method: "PUT", path: `/${table.name}/:${pk}`, plan: { op: "update", table: table.name, filters: [{ kind: "filter", column: pk, op: "=", value: undefined }], columnTypes: {}, values: {} }, params: [{ from: "path", name: pk, mapsTo: pk }], summary: `Update ${table.name}` });
  r.add({ name: `delete_${table.name}`, method: "DELETE", path: `/${table.name}/:${pk}`, plan: { op: "delete", table: table.name, filters: [{ kind: "filter", column: pk, op: "=", value: undefined }], columnTypes: {} }, params: [{ from: "path", name: pk, mapsTo: pk }], summary: `Delete ${table.name}` });
  return r;
}
