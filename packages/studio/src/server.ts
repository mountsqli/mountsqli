// MountSQLI — Studio HTTP server / middleware.
//
// Serves the self-contained dashboard SPA and a JSON API. The API never
// touches a database client directly — it delegates to the engine-backed
// controller (controller.ts), which uses Db/Driver/QueryPlan only.
//
// SECURITY: all inputs are validated or clamped; stack traces are never
// returned to the caller.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { MountError, safeErrorResponse, corsHeaders, validateTableName, clampInt, classifySql } from "@mountsqli/driver";
import type { StudioContext } from "./controller.js";
import {
  listTables,
  tableData,
  insertRow,
  updateRow,
  deleteRow,
  runSql,
  erd,
  migrations,
  health,
  cacheStats,
  cacheInvalidateTag,
  cacheClear,
} from "./controller.js";

export interface StudioServerOptions {
  port?: number;
  host?: string;
}

// ---------------------------------------------------------------------------
// Safe error handling
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function jsonError(res: ServerResponse, err: unknown): void {
  if (err instanceof MountError) {
    return json(res, MountError.httpStatus(err.code), err.toJSON() as Record<string, unknown>);
  }
  const msg = err instanceof Error ? err.message : "An unexpected error occurred";
  json(res, 500, { error: msg });
}

// ---------------------------------------------------------------------------
// Body reader with size limit (prevents OOM)
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

async function readBodySafe(req: IncomingMessage): Promise<any> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const c of req) {
    const b = c as Uint8Array;
    total += b.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
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

export async function handleStudio(
  ctx: StudioContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

    // Attach CORS to all responses.
    const attachCors = (r: ServerResponse): void => {
      const h = corsHeaders(req.headers.origin);
      for (const [k, v] of Object.entries(h)) r.setHeader(k, v);
    };

    // ---- API ----
    const apiMatch = path.match(/^\/api\/(?:studio\/)?(.+)$/);
    if (apiMatch) {
      const endpoint = apiMatch[1]!;

      if (endpoint === "health" && method === "GET") {
        attachCors(res);
        return json(res, 200, await health(ctx));
      }
      if (endpoint === "tables" && method === "GET") {
        attachCors(res);
        return json(res, 200, await listTables(ctx));
      }
      if (endpoint === "erd" && method === "GET") {
        attachCors(res);
        return json(res, 200, await erd(ctx));
      }
      if (endpoint === "migrations" && method === "GET") {
        attachCors(res);
        return json(res, 200, await migrations(ctx));
      }
      if (endpoint === "query" && method === "POST") {
        const body = await readBodySafe(req);
        const sql = String(body?.sql ?? "").trim();
        const classification = classifySql(sql);
        // Block bare DROP/ALTER/TRUNCATE from the dashboard's SQL console.
        if (classification.destructive) {
          throw new MountError("FORBIDDEN", "Destructive SQL (DROP/ALTER/TRUNCATE) is not allowed from the dashboard");
        }
        attachCors(res);
        return json(res, 200, await runSql(ctx, sql));
      }

      // ---- Cache API (dashboard) ----
      if (endpoint === "cache/stats" && method === "GET") {
        attachCors(res);
        return json(res, 200, await cacheStats(ctx));
      }
      if (endpoint === "cache/clear" && method === "POST") {
        attachCors(res);
        return json(res, 200, await cacheClear(ctx));
      }
      if (endpoint.startsWith("cache/invalidate/") && method === "POST") {
        const tag = decodeURIComponent(endpoint.slice("cache/invalidate/".length));
        attachCors(res);
        return json(res, 200, await cacheInvalidateTag(ctx, tag));
      }

      const tableMatch = endpoint.match(/^tables\/(.+)$/);
      if (tableMatch) {
        const rawName = decodeURIComponent(tableMatch[1]!);
        const tableName = validateTableName(rawName);

        attachCors(res);

        if (method === "GET") {
          const q = Object.fromEntries(url.searchParams);
          return json(res, 200, await tableData(ctx, tableName, {
            limit: clampInt(q.limit, 1, 500, 100),
            offset: clampInt(q.offset, 0, Infinity, 0),
            order: q.order || undefined,
            dir: q.dir === "desc" ? "desc" : "asc",
            search: q.search ? String(q.search).slice(0, 256) : undefined,
          }));
        }

        const body = await readBodySafe(req);
        if (body !== undefined && (typeof body !== "object" || Array.isArray(body))) {
          throw new MountError("VALIDATION", "Request body must be a JSON object");
        }

        if (method === "POST") {
          return json(res, 201, await insertRow(ctx, tableName, body ?? {}));
        }
        if (method === "PUT") {
          const pk = body?.id ?? body?._pk;
          if (pk === undefined) throw new MountError("VALIDATION", "Missing primary key (id or _pk) for update");
          const values = { ...body };
          delete values._pk;
          delete values.id;
          return json(res, 200, await updateRow(ctx, tableName, pk, values));
        }
        if (method === "DELETE") {
          const pk = body?.id ?? body?._pk;
          if (pk === undefined) throw new MountError("VALIDATION", "Missing primary key (id or _pk) for delete");
          return json(res, 200, await deleteRow(ctx, tableName, pk));
        }
      }

      attachCors(res);
      return json(res, 404, { error: "not found" });
    }

    // ---- SPA ----
    const { getDashboardHTML } = await import("./dashboard.js");
    attachCors(res);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(getDashboardHTML(ctx));
  } catch (e) {
    jsonError(res, e);
  }
}

/** Standalone studio server (mount studio). */
export function startStudioServer(ctx: StudioContext, opts: StudioServerOptions = {}): Server {
  const port = opts.port ?? 3738;
  const host = opts.host ?? "localhost";
  const server = createServer((req, res) => {
    handleStudio(ctx, req, res).catch((e) => {
      const msg = e instanceof Error ? e.message : "An unexpected error occurred";
      json(res, 500, { error: msg });
    });
  });
  server.listen(port, host, () => {
    console.log(`\n🎨 MountSQLI Studio on http://${host}:${port}`);
    console.log("  Tables · Query · ERD · Migrations · Settings\n");
  });
  return server;
}
