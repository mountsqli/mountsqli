// MountSQLI — merged dev + studio server.
//
// A single zero-dependency HTTP server that combines:
//   • REST CRUD      — generated from each configured table (api crudRoutes)
//   • Storage        — content-addressed, HMAC-signed URLs
//   • Realtime       — SSE transport over a realtime Hub
//   • Studio         — the visual dashboard SPA + its /api/* JSON surface
//
// SECURITY: every input boundary below validates, clamps, or rejects before
// reaching a driver or filesystem call. No stack traces are ever returned in
// HTTP responses.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { compilePlan, getDialect, type QueryPlan } from "@mountsqli/compiler";
import type { Driver } from "@mountsqli/driver";
import {
  MountError,
  safeErrorResponse,
  corsHeaders,
  validateFileKey,
  validateChannelName,
  validateTableName,
  clampInt,
} from "@mountsqli/driver";
import type { Table, TableDef } from "@mountsqli/schema";
import { createRouter, crudRoutes, createRestHandler, type Router } from "@mountsqli/api";
import { Storage, MemoryStorage } from "@mountsqli/storage";
import { Hub } from "@mountsqli/realtime";
import type { Db, MountConfig } from "@mountsqli/core";
import { handleStudio } from "./server.js";
import { makeStudioContext, type StudioContext } from "./controller.js";
import { CacheBridge, createCache, CacheManager, MemoryCache } from "@mountsqli/cache";
import type { CacheManagerConfig } from "@mountsqli/cache";

export interface MergedOptions {
  port?: number;
  host?: string;
  secret?: string;
  config?: MountConfig;
}

export interface MergedContext {
  driver: Driver;
  router: Router;
  rest: ReturnType<typeof createRestHandler>;
  storage: Storage;
  hub: Hub;
  studio: StudioContext;
  config?: MountConfig;
}

// ---------------------------------------------------------------------------
// Safe error handling
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/** Send an error response — never leaks stack traces. */
function jsonError(res: ServerResponse, err: unknown): void {
  if (err instanceof MountError) {
    return json(res, MountError.httpStatus(err.code), err.toJSON() as Record<string, unknown>);
  }
  const msg = err instanceof Error ? err.message : "An unexpected error occurred";
  json(res, 500, { error: msg });
}

// ---------------------------------------------------------------------------
// Body reader with size limit (prevents OOM from large payloads)
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = c as Buffer;
    total += b.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy(); // close connection early
      throw new MountError("VALIDATION", `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024} MB limit`);
    }
    chunks.push(b);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new MountError("VALIDATION", "Invalid JSON in request body");
  }
}

// ---------------------------------------------------------------------------
// Query plan execution (dialect-aware)
// ---------------------------------------------------------------------------

async function runPlan(driver: Driver, plan: QueryPlan): Promise<unknown> {
  const dialectName = driver.name === "pg" ? "postgres" : driver.name;
  let dialect;
  try {
    dialect = getDialect(dialectName);
  } catch {
    throw new MountError("CONFIG", `Unsupported driver dialect "${driver.name}"`);
  }
  const compiled = compilePlan(plan, dialect);
  const mode = plan.op === "select" ? "many" : "run";
  try {
    const r = await driver.query(compiled, mode);
    return plan.op === "select" ? r.rows : { changes: r.changes, lastId: r.lastId };
  } catch (e) {
    throw new MountError("QUERY_FAILED", `Query failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// URL-safe path traversal check for any user-controlled path segment
// ---------------------------------------------------------------------------

function pathTraversalCheck(segment: string): void {
  if (segment.includes("..") || segment.includes("\0")) {
    throw new MountError("VALIDATION", "Path traversal detected");
  }
}

/** Build the merged context from a `Db` produced by `mount`/`mountsqli`. */
export function buildMergedContext(db: Db<Table<any>[]>, opts: MergedOptions = {}): MergedContext {
  const driver: Driver = db.driver;
  const tables: TableDef[] = db.tables.map((t: Table) => t.def as TableDef);

  const router = createRouter();
  for (const t of tables) {
    for (const r of crudRoutes(t).routes) router.add(r);
  }

  const storage = new Storage(new MemoryStorage(), opts.secret ?? randomUUID());
  const hub = new Hub();
  // Build a CacheManager from config.cache (or use defaults)
  const cacheCfg = (opts.config?.cache ?? {}) as Record<string, unknown>;
  const manager = new CacheManager({
    defaultTtl: Number(cacheCfg.defaultTtl ?? 300),
    memory: cacheCfg.memory !== false,
    queryCache: cacheCfg.queryCache !== false,
    metadataCache: cacheCfg.metadataCache !== false,
    authCache: cacheCfg.authCache !== false,
    aiCache: cacheCfg.aiCache !== false,
    monitoring: cacheCfg.monitoring !== false,
    warming: !!cacheCfg.warming,
    compression: !!cacheCfg.compression,
  });
  const cache = new CacheBridge(manager);
  const studio = makeStudioContext(db, cache);

  return { driver, router, rest: createRestHandler(router), storage, hub, studio, config: opts.config };
}

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

export async function handleMerged(ctx: MergedContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // ---- CORS preflight ----
    if (req.method === "OPTIONS") {
      const h = corsHeaders(req.headers.origin);
      res.writeHead(204, h);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // Attach CORS headers to all responses (dev default: allow all).
    const attachCors = (r: ServerResponse): void => {
      const h = corsHeaders(req.headers.origin);
      for (const [k, v] of Object.entries(h)) r.setHeader(k, v);
    };

    // ---- Studio JSON API ----
    if (path.startsWith("/api/studio/")) {
      const sub = "/api/" + path.slice("/api/studio/".length);
      const subReq = Object.assign(req, { url: new URL(sub + url.search, url.origin) });
      await handleStudio(ctx.studio, subReq as IncomingMessage, res);
      return;
    }

    // ---- Studio SPA ----
    if (path === "/" || path.startsWith("/assets/")) {
      attachCors(res);
      await handleStudio(ctx.studio, req, res);
      return;
    }

    // ---- Realtime (SSE) ----
    if (path.startsWith("/live/") && !path.includes("/publish") && method === "GET") {
      const rawChannel = decodeURIComponent(path.slice("/live/".length));
      const channel = validateChannelName(rawChannel);
      pathTraversalCheck(rawChannel);
      attachCors(res);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        ...corsHeaders(req.headers.origin),
      });
      const sub = ctx.hub.channel(channel).subscribe((payload: unknown) =>
        res.write(`data: ${JSON.stringify(payload)}\n\n`),
      );
      req.on("end", () => sub.unsubscribe());
      return;
    }
    if (path.startsWith("/live/") && path.endsWith("/publish") && method === "POST") {
      const rawChannel = decodeURIComponent(path.slice("/live/".length, path.length - "/publish".length));
      const channel = validateChannelName(rawChannel);
      const payload = (await readBody(req)) ?? {};
      if (payload && typeof payload !== "object") {
        throw new MountError("VALIDATION", "Publish payload must be a JSON object");
      }
      ctx.hub.broadcast(channel, payload);
      attachCors(res);
      return json(res, 200, { ok: true });
    }

    // ---- Storage ----
    if (path.startsWith("/files/")) {
      const rawKey = decodeURIComponent(path.slice("/files/".length));
      const isSignedUrl = rawKey.endsWith("/url");
      const key = isSignedUrl ? rawKey.slice(0, -"/url".length) : rawKey;
      const fileKey = validateFileKey(key);
      pathTraversalCheck(key);

      attachCors(res);

      if (method === "PUT") {
        const buf = (await readBody(req)) as Buffer;
        const data = Buffer.isBuffer(buf) ? new Uint8Array(buf) : new TextEncoder().encode(String(buf ?? ""));
        if (data.length > 50 * 1024 * 1024) {
          throw new MountError("VALIDATION", "File exceeds 50 MB limit");
        }
        const stored = await ctx.storage.upload(fileKey, data, { contentType: "application/octet-stream" });
        return json(res, 201, {
          key: stored.key,
          version: stored.version,
          size: stored.size,
          url: ctx.storage.publicUrl(fileKey, stored.version),
        });
      }
      if (method === "GET" && isSignedUrl) {
        const signed = ctx.storage.signUrl(fileKey, { expiresInSec: 3600, method: "GET" });
        return json(res, 200, { url: signed });
      }
      if (method === "GET") {
        const stored = await ctx.storage.download(fileKey);
        if (!stored) return json(res, 404, { error: "not found" });
        res.writeHead(200, {
          "content-type": stored.contentType,
          "x-content-version": stored.version,
          ...corsHeaders(req.headers.origin),
        });
        res.end(Buffer.from(stored.data));
        return;
      }
      if (method === "DELETE") {
        await ctx.storage.remove(fileKey);
        return json(res, 200, { ok: true });
      }
    }

    // ---- REST CRUD ----
    if (method === "GET" || method === "POST" || method === "PUT" || method === "DELETE") {
      attachCors(res);
      // Validate table-name segments (first alpha path segment) to prevent
      // injection via route params; numeric IDs are always safe.
      const tableInPath = path.split("/").filter(Boolean);
      for (const seg of tableInPath) {
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg)) continue; // valid table name
        if (/^\d+$/.test(seg)) continue; // numeric ID — always safe
        if (seg.startsWith(":") || seg.startsWith("_")) continue;
        throw new MountError("VALIDATION", `Invalid path segment "${seg}"`);
      }
      const reqBody = method === "GET" ? undefined : await readBody(req);
      const out = await ctx.rest({
        method: method as "GET" | "POST" | "PUT" | "DELETE",
        path,
        query: Object.fromEntries(url.searchParams),
        body: reqBody,
        params: {},
      });
      if ("status" in out) return json(res, out.status, out.body);
      const plan = out.plan;
      if (plan.op === "insert" || plan.op === "update") {
        const b = reqBody as Record<string, unknown> | undefined;
        if (b && typeof b === "object") {
          // Strip unexpected keys — only keep known columns for this table.
          plan.values = { ...plan.values, ...b };
        }
      }
      const result = await runPlan(ctx.driver, plan);
      return json(res, method === "POST" ? 201 : 200, result);
    }

    attachCors(res);
    json(res, 404, { error: "not found" });
  } catch (e) {
    // MountError responses are safe; everything else is generic.
    if (e instanceof MountError) {
      return json(res, MountError.httpStatus(e.code), e.toJSON() as Record<string, unknown>);
    }
    const msg = e instanceof Error ? e.message : "An unexpected error occurred";
    json(res, 500, { error: msg });
  }
}

/** Standalone merged server — one port serves dev API + studio dashboard. */
export function startMergedServer(ctx: MergedContext, opts: MergedOptions = {}): Server {
  const port = opts.port ?? 3737;
  const host = opts.host ?? "localhost";
  const server = createServer((req, res) => {
    handleMerged(ctx, req, res).catch((e) => {
      const msg = e instanceof Error ? e.message : "An unexpected error occurred";
      json(res, 500, { error: msg });
    });
  });
  server.listen(port, host, () => {
    console.log(`\n🎨 MountSQLI dev + Studio on http://${host}:${port}`);
    console.log("  Studio  /                   dashboard");
    console.log("  Studio  /api/studio/*       dashboard JSON API");
    console.log("  REST    /<table>            CRUD");
    console.log("  STORE   /files/<key>        upload/download/delete");
    console.log("  LIVE    /live/<channel>     SSE realtime\n");
  });
  return server;
}
