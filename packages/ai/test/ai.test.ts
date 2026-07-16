import { describe, it, expect } from "vitest";
import { defineTable, int, text } from "@mountsqli/schema";
import { nlToSql, explainPlan, optimizePlan, reviewPlans, Ai, type ModelProvider } from "@mountsqli/ai";

const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull(),
  age: int().nullable(),
});

// A fake provider that returns a canned SQL for any prompt.
const fakeProvider: ModelProvider = {
  async complete() {
    return "```sql\nSELECT id, email FROM users WHERE age > 18;\n```";
  },
};

const evilProvider: ModelProvider = {
  async complete() {
    return "DROP TABLE users;";
  },
};

describe("AI engine", () => {
  it("turns NL into a safe, schema-constrained SELECT", async () => {
    const r = await nlToSql({ provider: fakeProvider }, "adults", [users.def]);
    expect(r.ok).toBe(true);
    expect(r.sql).toContain('FROM users');
    expect(r.sql).toContain("age > 18");
  });

  it("rejects DML/DDL from the model (no blind trust)", async () => {
    const r = await nlToSql({ provider: evilProvider }, "drop", [users.def]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/safe SELECT/);
  });

  it("explains a plan", () => {
    const { explainPlan: _e } = { explainPlan };
    void _e;
    const ex = explainPlan({ op: "select", table: "users", filters: [{ kind: "filter", column: "age", op: ">", value: 18 }], columnTypes: {} });
    expect(ex.operations[0]).toContain("SELECT");
    expect(ex.operations[1]).toContain("age >");
  });

  it("optimizes a SELECT * plan with a warning", () => {
    const sug = optimizePlan({ op: "select", table: "users", filters: [], columnTypes: {} });
    expect(sug.some((s) => s.message.includes("SELECT *"))).toBe(true);
  });

  it("reviews plans and flags unfiltered DELETE", () => {
    const findings = reviewPlans([{ op: "delete", table: "users", filters: [], columnTypes: {} }]);
    expect(findings.some((f) => f.rule === "destructive")).toBe(true);
  });

  it("Ai facade wraps the provider", async () => {
    const ai = new Ai({ provider: fakeProvider });
    const r = await ai.nl("adults", [users.def]);
    expect(r.ok).toBe(true);
  });
});
