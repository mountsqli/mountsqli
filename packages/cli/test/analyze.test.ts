import { describe, it, expect, beforeAll } from "vitest";
import { cmdAnalyze, type CliConfig } from "../src/lib.js";
import OS from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const users = {
  name: "users",
  columns: [
    { name: "id", type: "int", primaryKey: true, nullable: false },
    { name: "email", type: "text", primaryKey: false, nullable: false },
    { name: "age", type: "int", primaryKey: false, nullable: true },
  ],
};

describe("mount analyze", () => {
  let cfg: CliConfig;
  let db: string;

  beforeAll(() => {
    db = join(mkdtempSync(join(OS.tmpdir(), "mnt-an-")), "dev.db");
    cfg = { driver: "sqlite", url: db, tables: [users] };
  });

  it("reports no drift on a freshly synced schema", async () => {
    // First bring the DB in sync via the migrate apply path (driver + introspect).
    const { cmdGenerate, cmdApply } = await import("../src/lib.js");
    const gen = await cmdGenerate(cfg);
    expect(gen.ok).toBe(true);
    const apply = await cmdApply(cfg);
    expect(apply.ok).toBe(true);

    const r = await cmdAnalyze(cfg);
    expect(r.ok).toBe(true);
    const driftLine = r.lines.find((l) => l.startsWith("Schema drift:"));
    expect(driftLine).toMatch(/none \(in sync\)/);
  });

  it("flags drift when the config adds a column", async () => {
    const drifted: CliConfig = {
      driver: "sqlite",
      url: db,
      tables: [
        {
          ...users,
          columns: [...users.columns, { name: "bio", type: "text", primaryKey: false, nullable: true }],
        },
      ],
    };
    const r = await cmdAnalyze(drifted);
    expect(r.lines.some((l) => l.includes("add column users.bio"))).toBe(true);
  });

  it("suggests indexes for repeated filters and warns on SELECT *", async () => {
    const r = await cmdAnalyze(cfg);
    expect(r.lines.some((l) => l.includes("CREATE INDEX ON users (id)"))).toBe(true);
    expect(r.lines.some((l) => l.includes("[SELECT_STAR]"))).toBe(true);
  });
});
