import { describe, it, expect } from "vitest";
import { defineTable, int, text } from "@mountsqli/schema";
import { createRouter, toOpenApi, createRestHandler, toTrpc, crudRoutes } from "@mountsqli/api";

const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull(),
  age: int().nullable(),
});

describe("API engine", () => {
  it("scaffolds CRUD routes from a table", () => {
    const r = crudRoutes(users.def);
    const names = r.routes.map((x) => x.name);
    expect(names).toEqual(["list_users", "get_users", "create_users", "update_users", "delete_users"]);
    expect(r.routes.find((x) => x.name === "get_users")?.path).toBe("/users/:id");
  });

  it("generates an OpenAPI 3.1 spec with bearer security", () => {
    const router = crudRoutes(users.def);
    router.routes.find((r) => r.name === "get_users")!.policy = "owner";
    const spec = toOpenApi(router) as any;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/users/:id"].get.security).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.type).toBe("http");
  });

  it("dispatches a REST request and binds path params into the plan", async () => {
    const router = crudRoutes(users.def);
    const handler = createRestHandler(router);
    const res = await handler({
      method: "GET",
      path: "/users/42",
      query: {},
      body: null,
      params: { id: "42" },
    });
    expect("status" in res).toBe(false); // matched a route
    const { plan } = res as any;
    expect(plan.op).toBe("select");
    expect(plan.filters[0].value).toBe("42");
  });

  it("returns 404 for unknown routes", async () => {
    const router = crudRoutes(users.def);
    const handler = createRestHandler(router);
    const res = await handler({ method: "GET", path: "/nope", query: {}, body: null, params: {} });
    expect(res).toEqual({ status: 404, body: { error: "not found" } });
  });

  it("emits a tRPC procedure descriptor", () => {
    const procs = toTrpc(crudRoutes(users.def));
    expect(procs.find((p) => p.name === "list_users")?.calls).toBe("query");
    expect(procs.find((p) => p.name === "create_users")?.calls).toBe("mutation");
  });

  it("awaits auth middleware and blocks the request with 403 on failure", async () => {
    const router = crudRoutes(users.def);
    router.add({
      name: "secure_users",
      method: "GET",
      path: "/secure/users",
      plan: { op: "select", table: "users", filters: [], columnTypes: {} },
      auth: async () => { throw new Error("denied"); },
    });
    const handler = createRestHandler(router);
    const res = await handler({ method: "GET", path: "/secure/users", query: {}, body: null, params: {} });
    expect(res).toEqual({ status: 403, body: { error: "Forbidden" } });
  });

  it("passes through when auth middleware resolves", async () => {
    const router = crudRoutes(users.def);
    router.add({
      name: "secure_users2",
      method: "GET",
      path: "/secure2/users",
      plan: { op: "select", table: "users", filters: [], columnTypes: {} },
      auth: async () => {},
    });
    const handler = createRestHandler(router);
    const res = await handler({ method: "GET", path: "/secure2/users", query: {}, body: null, params: {} });
    expect("status" in res).toBe(false); // matched + authed, plan returned
  });
});
