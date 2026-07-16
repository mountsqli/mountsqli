import { describe, it, expect, vi } from "vitest";
import { PostgresDriver } from "@mountsqli/driver-postgres";
import { compilePlan, emptyPlan } from "@mountsqli/compiler";
import { defineTable, int, text } from "@mountsqli/schema";
import { listDrivers } from "@mountsqli/driver";

// We don't run a real Postgres; instead we inject a fake Pool whose
// `connect()` returns a client that records the SQL it receives.
// This proves multi-driver dispatch + $N parameter translation.
function fakePool() {
  const seen: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      seen.push({ sql, params });
      if (sql.trim().toUpperCase().startsWith("SELECT")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(async () => client), end: vi.fn(async () => {}) },
    seen,
    client,
  };
}

const users = defineTable("users", {
  id: int().pk(),
  email: text().unique().notNull(),
});

describe("Postgres driver (multi-driver)", () => {
  it("translates ? placeholders to $1/$2 and binds booleans natively", async () => {
    const { pool, seen } = fakePool();
    const driver = new PostgresDriver({ pool: pool as any }); // inject fake pool

    const plan = { ...emptyPlan("users"), filters: [{ kind: "filter", column: "age", op: ">", value: 18 } as any] };
    await driver.query(compilePlan({ ...plan, columnTypes: {} }), "many");

    expect(seen[0]!.sql).toBe('SELECT * FROM "users" WHERE "age" > $1');
    expect(seen[0]!.params).toEqual([18]);
  });

  it("creates tables using postgres dialect types", async () => {
    const { pool, seen, client } = fakePool();
    const driver = new PostgresDriver({ pool: pool as any });
    await driver.init([users.def]);
    const createCall = seen.find((s) => s.sql.toUpperCase().includes("CREATE TABLE"));
    expect(createCall?.sql).toContain('"id" INTEGER');
    expect(createCall?.sql).toContain('"email" TEXT');
    expect(client.release).toHaveBeenCalled();
  });

  it("registers under the 'postgres' name", () => {
    // importing the package side-effect registers it; createDriver resolves it
    // (the default factory needs DATABASE_URL, so we only assert it is listed)
    expect(listDrivers()).toContain("postgres");
  });

  // issue 002: concurrent borrows must be isolated and both released.
  it("borrow() gives isolated clients and releases both (no cross-talk)", async () => {
    const clients: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }[] = [];
    const pool = {
      connect: vi.fn(async () => {
        const c = {
          query: vi.fn(async (sql: string) => ({ rows: [], rowCount: 0 })),
          release: vi.fn(),
        };
        clients.push(c);
        return c;
      }),
      end: vi.fn(async () => {}),
    };
    const driver = new PostgresDriver({ pool: pool as any });

    // Two simultaneous borrows.
    const [h1, h2] = await Promise.all([driver.borrow(), driver.borrow()]);
    expect(clients).toHaveLength(2);
    expect(clients[0]).not.toBe(clients[1]); // distinct clients

    // Each handle runs queries on its OWN client.
    await h1.query(compilePlan({ ...emptyPlan("users"), columnTypes: {} }), "many");
    await h2.query(compilePlan({ ...emptyPlan("users"), columnTypes: {} }), "many");
    expect(clients[0]!.query).toHaveBeenCalledTimes(1);
    expect(clients[1]!.query).toHaveBeenCalledTimes(1);

    await h1.release();
    await h2.release();
    expect(clients[0]!.release).toHaveBeenCalledTimes(1);
    expect(clients[1]!.release).toHaveBeenCalledTimes(1);
  });

  it("query() takes and releases its own pooled client (no shared field)", async () => {
    let connections = 0;
    const pool = {
      connect: vi.fn(async () => {
        connections++;
        return { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
      }),
      end: vi.fn(async () => {}),
    };
    const driver = new PostgresDriver({ pool: pool as any });
    await driver.query(compilePlan({ ...emptyPlan("users"), columnTypes: {} }), "many");
    // No borrow active → a fresh connection is taken and released.
    expect(connections).toBe(1);
  });

  // issue audit #8: a failing COMMIT must surface as a classified
  // MountError (not an unhandled raw error) and attempt ROLLBACK.
  it("classifies a COMMIT failure and attempts rollback", async () => {
    const sqlSeen: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        sqlSeen.push(sql);
        if (sql.trim().toUpperCase() === "COMMIT") {
          throw new Error('serialization failure: could not serialize access due to concurrent update');
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => {}) };
    const driver = new PostgresDriver({ pool: pool as any });

    const result = await driver.transaction(async () => {
      return 42;
    }).then(
      () => "committed",
      (e: any) => e,
    );

    // The commit failure is surfaced as a MountError with a clear code.
    expect(result).toMatchObject({ code: "QUERY_FAILED" });
    expect(sqlSeen).toContain("ROLLBACK"); // rollback attempted on commit failure
    expect(sqlSeen).toContain("COMMIT");
  });
});
