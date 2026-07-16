import { describe, it, expect, beforeAll } from "vitest";
import { mountsqli, defineTable, int, text, bool } from "@mountsqli/core";
import { makeStudioContext, buildMergedContext, handleMerged } from "../src/index.js";
import type { Db } from "@mountsqli/core";
import type { ServerResponse } from "node:http";

const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull().unique(),
  name: text(),
  active: bool().notNull().default(true),
});

function mockRes(): { res: ServerResponse; body: () => Promise<unknown>; status: () => number } {
  let statusCode = 200;
  let contentType = "application/json";
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  let resolveBody: (v: unknown) => void;
  const bodyPromise = new Promise<unknown>((resolve) => (resolveBody = resolve));
  const res = {
    writeHead(code: number, headersArg?: Record<string, string>) {
      statusCode = code;
      if (headersArg) Object.assign(headers, headersArg);
      if (headersArg && headersArg["content-type"]) contentType = headersArg["content-type"];
    },
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) chunks.push(String(chunk));
      resolveBody(chunks.join(""));
    },
    write(chunk: unknown) {
      chunks.push(String(chunk));
      return true;
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => statusCode,
    body: async () => {
      const raw = (await bodyPromise) as string;
      return contentType.includes("application/json") && raw ? JSON.parse(raw) : raw;
    },
  };
}

function makeReq(method: string, path: string, body?: unknown) {
  const url = new URL(path, "http://localhost:3737");
  const raw = body === undefined ? Buffer.from("") : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const req: any = {
    method,
    url,
    headers: {},
    on(event: string, cb: (c?: any) => void) {
      if (event === "data") cb(raw);
      if (event === "end") cb();
      return req;
    },
    emit() {
      return req;
    },
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next() {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: raw };
        },
      };
    },
  };
  return req as any;
}

describe("studio controller", () => {
  let db: Db<any>;
  let ctx: ReturnType<typeof makeStudioContext>;

  beforeAll(async () => {
    db = await mountsqli({ tables: [users], driver: "sqlite", url: ":memory:" });
    ctx = makeStudioContext(db);
  });

  it("lists tables with inferred columns", async () => {
    const { listTables } = await import("../src/controller.js");
    const { tables } = await listTables(ctx);
    expect(tables[0]!.name).toBe("users");
    expect(tables[0]!.columns.map((c) => c.name)).toEqual(["id", "email", "name", "active"]);
  });

  it("inserts, reads, updates and deletes (DELETE bug fixed)", async () => {
    const { insertRow, tableData, updateRow, deleteRow } = await import("../src/controller.js");
    const ins = await insertRow(ctx, "users", { email: "a@b.c", name: "Ann", active: true });
    expect(ins.success).toBe(true);

    let d = await tableData(ctx, "users");
    expect(d.count).toBe(1);
    expect(d.rows[0]!.name).toBe("Ann");

    await updateRow(ctx, "users", ins.lastId, { name: "Annie" });
    d = await tableData(ctx, "users");
    expect(d.rows[0]!.name).toBe("Annie");

    const del = await deleteRow(ctx, "users", ins.lastId);
    expect(del.success).toBe(true);
    d = await tableData(ctx, "users");
    expect(d.count).toBe(0);
  });
});

describe("merged server (dev + studio on one port)", () => {
  let db: Db<any>;
  let mctx: ReturnType<typeof buildMergedContext>;

  beforeAll(async () => {
    db = await mountsqli({ tables: [users], driver: "sqlite", url: ":memory:" });
    mctx = buildMergedContext(db);
  });

  it("serves the Studio SPA at /", async () => {
    const m = mockRes();
    await handleMerged(mctx, makeReq("GET", "/"), m.res);
    expect(m.status()).toBe(200);
    const html = (await m.body()) as string;
    expect(html).toContain("MountSQLI");
  });

  it("serves studio JSON API under /api/studio/*", async () => {
    const m = mockRes();
    await handleMerged(mctx, makeReq("GET", "/api/studio/tables"), m.res);
    expect(m.status()).toBe(200);
    const json = (await m.body()) as any;
    expect(json.tables[0].name).toBe("users");
  });

  it("does REST CRUD on /users (POST then DELETE)", async () => {
    const post = mockRes();
    await handleMerged(mctx, makeReq("POST", "/users", { email: "x@y.z", name: "X" }), post.res);
    expect(post.status()).toBe(201);

    const m = mockRes();
    await handleMerged(mctx, makeReq("GET", "/users"), m.res);
    const list = (await m.body()) as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const id = list[0].id;

    const del = mockRes();
    await handleMerged(mctx, makeReq("DELETE", `/users/${id}`), del.res);
    expect(del.status()).toBe(200);
  });
});
