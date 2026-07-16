// MountSQLI — `mount dev` server.
//
// A zero-dependency (node:http only) development server that wires the whole
// built ecosystem together so a user can run a backend with one command:
//
//   mountsqli dev -c mountsqli.config.js --port 3737
//
// It exposes three subsystems over a single HTTP surface:
//   • REST CRUD — generated from each configured table via @mountsqli/api's
//     `crudRoutes` + `createRestHandler`, compiled to SQL by the compiler and
//     executed through the driver (injection-safe by construction).
//   • Storage  — content-addressed, HMAC-signed URLs via @mountsqli/storage.
//   • Realtime — a transport-agnostic @mountsqli/realtime Hub exposed over SSE.

import { createServer, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { compilePlan, sqliteDialect } from "@mountsqli/compiler";
import type { QueryPlan } from "@mountsqli/compiler";
import type { Driver } from "@mountsqli/driver";
import { RateLimiter } from "@mountsqli/driver";
import type { TableDef, Table } from "@mountsqli/schema";
import { createRouter, crudRoutes, createRestHandler, toOpenApi, toProblemDetails, parseFilterQuery, type Router } from "@mountsqli/api";
import { Storage, MemoryStorage } from "@mountsqli/storage";
import { Hub } from "@mountsqli/realtime";
import type { Db } from "@mountsqli/core";

export interface DevOptions {
  port?: number;
  secret?: string; // HMAC secret for signed storage URLs (dev default is random)
  /** Max requests per minute per IP (default 1000). */
  rateLimit?: number;
}

interface DevContext {
  driver: Driver;
  router: Router;
  rest: ReturnType<typeof createRestHandler>;
  storage: Storage;
  hub: Hub;
  rateLimiter?: RateLimiter;
}

function json(res: ServerResponse, status: number, payload: unknown, headers?: Record<string, string>): void {
  const merged: Record<string, string> = { "content-type": "application/json" };
  if (headers) {
    for (const [k, v] of Object.entries(headers)) merged[k] = v;
  }
  if (status === 429 && headers?.["retry-after"]) {
    merged["retry-after"] = headers["retry-after"];
  }
  res.writeHead(status, merged);
  res.end(JSON.stringify(payload));
}

function problem(res: ServerResponse, status: number, detail: string, type = "/errors/generic"): void {
  json(res, status, toProblemDetails(detail, status, type));
}

/** Execute any QueryPlan against the driver (select => many, writes => run). */
async function runPlan(driver: Driver, plan: QueryPlan): Promise<unknown> {
  const compiled = compilePlan(plan, sqliteDialect);
  const mode = plan.op === "select" ? "many" : "run";
  const r = await driver.query(compiled, mode);
  return plan.op === "select" ? r.rows : { changes: r.changes, lastId: r.lastId };
}

export function startDevServer(ctx: DevContext, opts: DevOptions = {}): Server {
  const port = opts.port ?? 3737;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();
      dbg("REQUEST", method, path);
      await handle(ctx, { ...req, method, path, url } as unknown as MiniRequest, res);
    } catch (e) {
      problem(res, 500, (e as Error).message);
    }
  });
  server.listen(port);
  return server;
}

/** Minimal request shape the handler needs (real IncomingMessage satisfies it). */
export interface MiniRequest {
  method: string;
  path: string;
  url: URL;
  on(event: "data" | "end" | "error", cb: (chunk?: any) => void): void;
  socket?: { remoteAddress?: string };
}

function body(req: MiniRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on("error", reject);
  });
}

/** Pure request handler — also unit-testable without binding a port. */
export async function handle(
  ctx: DevContext,
  req: MiniRequest,
  res: ServerResponse,
): Promise<void> {
  try {
    const { method, path, url } = req;

    // Rate limiting for all non-static paths
    if (ctx.rateLimiter) {
      const clientIp = req.socket?.remoteAddress ?? "unknown";
      if (!ctx.rateLimiter.check(clientIp)) {
        const retryAfter = Math.ceil(ctx.rateLimiter.timeUntilReset(clientIp) / 1000);
        return json(res, 429, toProblemDetails("rate limit exceeded", 429, "/errors/rate-limit"), { "retry-after": String(retryAfter) });
      }
    }

      if (path.startsWith("/live/") && !path.includes("/publish") && method === "GET") {
        const channel = decodeURIComponent(path.slice("/live/".length));
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const sub = ctx.hub.channel(channel).subscribe((payload) => {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        });
        req.on("end", () => sub.unsubscribe());
        return;
      }
      if (path.startsWith("/live/") && path.endsWith("/publish") && method === "POST") {
        const channel = decodeURIComponent(path.slice("/live/".length, path.length - "/publish".length));
        const payload = (await body(req)) ?? {};
        ctx.hub.broadcast(channel, payload);
        return json(res, 200, { ok: true });
      }

      // ---- Storage ----
      if (path.startsWith("/files/")) {
        let key = decodeURIComponent(path.slice("/files/".length));
        const signedUrl = key.endsWith("/url");
        if (signedUrl) key = key.slice(0, -"/url".length);
        if (method === "PUT") {
          const buf = (await body(req)) as Buffer;
          const data = Buffer.isBuffer(buf) ? new Uint8Array(buf) : new TextEncoder().encode(String(buf ?? ""));
          const stored = await ctx.storage.upload(key, data, { contentType: "application/octet-stream" });
          return json(res, 201, { key, version: stored.version, size: stored.size, url: ctx.storage.publicUrl(key, stored.version) });
        }
        if (method === "GET" && signedUrl) {
          const signed = ctx.storage.signUrl(key, { expiresInSec: 3600, method: "GET" });
          return json(res, 200, { url: signed });
        }
        if (method === "GET") {
          const stored = await ctx.storage.download(key);
          if (!stored) return json(res, 404, toProblemDetails("file not found", 404, "/errors/not-found"));
          res.writeHead(200, { "content-type": stored.contentType, "x-content-version": stored.version });
          res.end(Buffer.from(stored.data));
          return;
        }
        if (method === "DELETE") {
          await ctx.storage.remove(key);
          return json(res, 200, { ok: true });
        }
      }

      // ---- REST CRUD (framework-agnostic handler -> compiler -> driver) ----
      if (method === "GET" || method === "POST" || method === "PUT" || method === "DELETE") {
        const reqBody = method === "GET" ? undefined : await body(req);
        const restReq = {
          method: method as "GET" | "POST" | "PUT" | "DELETE",
          path,
          query: Object.fromEntries(url.searchParams),
          body: reqBody,
          params: {} as Record<string, string>,
          ip: req.socket?.remoteAddress ?? "unknown",
        };
        const out = await ctx.rest(restReq, { rateLimiter: ctx.rateLimiter });
        if ("status" in out) return json(res, out.status, out.body, out.headers);
        // For writes, merge the request body into a deep-cloned plan's values.
        const plan = structuredClone(out.plan);
        if (plan.op === "insert" || plan.op === "update") {
          const b = reqBody as Record<string, unknown> | undefined;
          if (b && typeof b === "object") plan.values = { ...plan.values, ...b };
        }
        // Apply query string filters for list endpoints (GET without :param)
        if (plan.op === "select") {
          const pk = findPk(ctx.router, path);
          if (!pk || !restReq.params[pk]) {
            const parsed = parseFilterQuery(Object.fromEntries(url.searchParams));
            plan.filters = [...plan.filters, ...parsed.filters];
            if (parsed.orderBy.length) plan.orderBy = parsed.orderBy;
            if (parsed.limit) plan.limit = parsed.limit;
            if (parsed.offset) plan.offset = parsed.offset;
          }
        }
        const result = await runPlan(ctx.driver, plan);
        return json(res, method === "POST" ? 201 : 200, result);
      }

      json(res, 404, toProblemDetails("route not found", 404, "/errors/not-found"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      problem(res, 500, msg);
    }
}

/** Find the PK column name for a table route. */
function findPk(router: Router, path: string): string | undefined {
  const route = router.routes.find((r) => r.method === "GET" && matchRoute(r.path, path));
  if (!route) return undefined;
  return route.params?.find((p) => p.from === "path")?.name;
}

/** Simple prefix match (returns true if route path prefix matches request path). */
function matchRoute(routePath: string, reqPath: string): boolean {
  const rp = routePath.split("/");
  const qp = reqPath.split("/");
  if (rp.length !== qp.length) return false;
  for (let i = 0; i < rp.length; i++) {
    const rseg = rp[i];
    const qseg = qp[i];
    if (!rseg || !qseg) return false;
    if (rseg.startsWith(":")) continue;
    if (rseg !== qseg) return false;
  }
  return true;
}

function dbg(...a: unknown[]): void {
  if (process.env.MOUNT_DEV_DEBUG) console.error("[dev]", ...a);
}

/**
 * Build the dev context from a `Db` produced by `mountsqli()`. The driver and
 * tables come straight from the mounted database, so the dev server shares the
 * exact same bootstrap as the user's app — no separate driver construction.
 */
export function buildDevContext(
  db: Db<Table<any>[]>,
  opts: DevOptions = {},
): DevContext {
  const driver: Driver = db.driver;
  const tables: TableDef[] = db.tables.map((t: Table) => t.def as TableDef);

  const router = createRouter();
  for (const t of tables) {
    for (const r of crudRoutes(t).routes) router.add(r);
  }

  const storage = new Storage(new MemoryStorage(), opts.secret ?? randomUUID());
  const hub = new Hub();
  const rateLimiter = opts.rateLimit ? new RateLimiter({ maxRequests: opts.rateLimit }) : undefined;

  return {
    driver,
    router,
    rest: createRestHandler(router),
    storage,
    hub,
    rateLimiter,
  };
}

export { toOpenApi };
