import { describe, it, expect } from "vitest";
import { MockDriver } from "@mountsqli/driver";
import { compilePlan, emptyPlan } from "@mountsqli/compiler";
import { defineTable, int, text } from "@mountsqli/schema";

const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull(),
});

describe("MockDriver (testability)", () => {
  it("records every compiled plan and returns scripted rows", async () => {
    const mock = new MockDriver();
    mock.script(/SELECT \* FROM "users"/, [{ id: 1, email: "a@b.c" }]);

    const plan = { ...emptyPlan("users"), columnTypes: {} };
    const res = await mock.query(compilePlan(plan), "many");

    expect(res.rows).toEqual([{ id: 1, email: "a@b.c" }]);
    expect(mock.log[0]!.sql).toContain('SELECT * FROM "users"');
    expect(mock.log[0]!.mode).toBe("many");
  });

  it("supports transactions via the shared driver interface", async () => {
    const mock = new MockDriver();
    const out = await mock.transaction(async (tx) => {
      await tx.query(compilePlan({ ...emptyPlan("users"), columnTypes: {} }), "run");
      return "done";
    });
    expect(out).toBe("done");
    expect(mock.log).toHaveLength(1);
  });
});
