import { describe, it, expect } from "vitest";
import { mountsqli, defineTable, int, text, bool, sql } from "@mountsqli/core";
import { compilePlan, emptyPlan } from "@mountsqli/compiler";

const users = defineTable("users", {
  id: int().pk(),
  email: text().unique().notNull(),
  age: int().nullable(),
  active: bool().notNull().default(1),
});

type User = typeof users.__row;

async function makeDb() {
  return mountsqli({ tables: [users], driver: "sqlite:memory" });
}

describe("MountSQLI core", () => {
  it("creates tables and infers row types", () => {
    const sample: User = { id: 1, email: "a@b.c", age: null, active: true };
    expect(sample.email).toBe("a@b.c");
    expect(sample.age).toBeNull();
  });

  it("inserts and selects with parameterized SQL", async () => {
    const db = await makeDb();
    await db.query(users).insert({ email: "alice@x.com", age: 30, active: true });
    await db.query(users).insert({ email: "bob@x.com", age: 17, active: true });

    const adults = await db.query(users).where("age", ">", 18).select();
    expect(adults).toHaveLength(1);
    expect(adults[0]!.email).toBe("alice@x.com");

    const one = await db.query(users).where("email", "=", "bob@x.com").findOne();
    expect(one?.age).toBe(17);
  });

  it("supports the sql template tag (typed escape hatch)", async () => {
    const db = await makeDb();
    await db.query(users).insert({ email: "carol@x.com", age: 22, active: true });
    const q = sql<User>`select * from users where age > ${18}`;
    const rows = await db.sql(q);
    expect(rows[0]!.email).toBe("carol@x.com");
  });

  it("updates and deletes, decoding booleans", async () => {
    const db = await makeDb();
    await db.query(users).insert({ email: "d@x.com", age: 10, active: false });
    await db.query(users).where("email", "=", "d@x.com").update({ active: true });
    const u = await db.query(users).where("email", "=", "d@x.com").findOne();
    expect(u?.active).toBe(true);
    await db.query(users).where("email", "=", "d@x.com").delete();
    const after = await db.query(users).select();
    expect(after).toHaveLength(0);
  });

  it("compiles plans to parameterized SQL (no value concatenation)", () => {
    const plan = emptyPlan("users");
    plan.filters = [{ kind: "filter", column: "age", op: ">", value: 18 }];
    const out = compilePlan(plan);
    expect(out.sql).toBe('SELECT * FROM "users" WHERE "age" > ?');
    expect(out.params).toEqual([18]);
  });
});
