import { describe, it, expect, beforeAll } from "vitest";
import { buildDevContext, handle, type DevContext } from "../src/server.js";
import { NodeSqliteDriver } from "@mountsqli/driver-sqlite";
import { defineTable, int, text } from "@mountsqli/core";
import type { Db } from "@mountsqli/core";
import type { ServerResponse } from "node:http";

function mockRes(): { res: ServerResponse; body: () => Promise<unknown>; status: () => number } {
  let statusCode = 200;
  let contentType = "application/json";
  const chunks: string[] = [];
  let resolveBody: (v: unknown) => void;
  const bodyPromise = new Promise<unknown>((resolve) => (resolveBody = resolve));
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      statusCode = code;
      if (headers && headers["content-type"]) contentType = headers["content-type"];
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
  const raw = body === undefined ? Buffer.from("") : Buffer.from(typeof body === "string" || body instanceof Buffer ? body.toString() : JSON.stringify(body));
  const req: any = {
    method,
    path,
    url,
    // Minimal stream emulation so server.ts body() resolves.
    on(event: string, cb: (c?: any) => void) {
      if (event === "data") cb(raw); // raw is a Buffer
      if (event === "end") cb();
      return req;
    },
    emit() {
      return req;
    },
  };
  return req as unknown as { method: string; path: string; url: URL };
}

describe("mount dev server (in-process handle)", () => {
  let ctx: DevContext;

  beforeAll(async () => {
    const users = defineTable("users", {
      id: int().pk(),
      email: text().notNull(),
      age: int(),
    });
    const driver = new NodeSqliteDriver(":memory:");
    await driver.init([users.def]);
    const db: Db<any> = {
      tables: [users],
      query: (() => null) as any,
      sql: (async () => []) as any,
      raw: (async () => []) as any,
      driver,
      close: async () => {
        await driver.close();
      },
    };
    ctx = buildDevContext(db);
  });

  async function call(method: string, path: string, body?: unknown) {
    const { res, body: readBody, status } = mockRes();
    await handle(ctx, makeReq(method, path, body) as any, res);
    return { status: status(), body: await readBody() };
  }

  it("creates, reads, updates, deletes via REST CRUD", async () => {
    const created = await call("POST", "/users", { email: "a@x.com", age: 30 });
    expect(created.status).toBe(201);
    const id = (created.body as any).lastId;
    expect(id).toBe(1);

    const list = await call("GET", "/users");
    const arr = list.body as any[];
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe(1); // PK decoded correctly (no null bug)
    expect(arr[0].email).toBe("a@x.com");

    const one = await call("GET", `/users/${id}`);
    expect((one.body as any[])[0].email).toBe("a@x.com");

    const upd = await call("PUT", `/users/${id}`, { email: "b@x.com", age: 31 });
    expect((upd.body as any).changes).toBe(1);

    const del = await call("DELETE", `/users/${id}`);
    expect((del.body as any).changes).toBe(1);
  });

  it("serves storage: put, signed url, get", async () => {
    const put = await call("PUT", "/files/hello", Buffer.from("hi there"));
    expect(put.status).toBe(201);
    expect((put.body as any).version).toMatch(/^[a-f0-9]+$/);

    const signed = await call("GET", "/files/hello/url");
    expect((signed.body as any).url).toContain("sig=");

    const got = await call("GET", "/files/hello");
    expect(got.body).toBe("hi there");
  });

  it("returns 404 for unknown routes", async () => {
    const r = await call("GET", "/nope");
    expect(r.status).toBe(404);
  });
});
