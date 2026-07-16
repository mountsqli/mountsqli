import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMountConfig, findMountConfig } from "../src/config.js";
import { defineTable, int, text } from "../src/index.js";
import { mountsqli } from "../src/index.js";

// Put temp configs next to this test file (not os.tmpdir, which some test
// sandboxes remap). The generated configs import from "@mountsqli/core", which
// resolves to the workspace package root from here.
const here = fileURLToPath(new URL(".", import.meta.url));
const tmp = join(here, ".cfg-tmp");
mkdirSync(tmp, { recursive: true });

describe("loadMountConfig", () => {
  it("loads a .js config authored with defineTable (Drizzle-style)", async () => {
    const file = join(tmp, "mount.config.js");
    writeFileSync(
      file,
      `import { defineTable, int, text } from "@mountsqli/core";
export default {
  driver: "sqlite",
  url: "./dev.db",
  tables: [defineTable("users", { id: int().pk(), email: text().notNull() })],
};`,
    );
    const cfg = await loadMountConfig(file);
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.url).toBe("./dev.db");
    expect(cfg.tables).toHaveLength(1);
    expect((cfg.tables[0] as any).def.name).toBe("users");
    expect((cfg.tables[0] as any).def.columns[0]).toMatchObject({ name: "id", type: "int", primaryKey: true });
  });

  it("supports a named export `config` and falls back to :memory:", async () => {
    const file = join(tmp, "cfg2.config.js");
    writeFileSync(
      file,
      `import { defineTable, int } from "@mountsqli/core";
export const config = { tables: [defineTable("t", { id: int().pk() })] };`,
    );
    const cfg = await loadMountConfig(file);
    expect(cfg.url).toBe(":memory:");
    expect(cfg.tables[0].def.name).toBe("t");
  });

  it("parses a legacy .json snapshot", async () => {
    const file = join(tmp, "mount.config.json");
    writeFileSync(
      file,
      JSON.stringify({
        driver: "sqlite",
        url: "./legacy.db",
        tables: [{ name: "users", columns: [{ name: "id", type: "int", nullable: false, primaryKey: true, unique: false }] }],
      }),
    );
    const cfg = await loadMountConfig(file);
    expect(cfg.url).toBe("./legacy.db");
    expect((cfg.tables[0] as any).def.name).toBe("users");
  });

  it("auto-discovers a config file by name in cwd", async () => {
    const found = findMountConfig(tmp);
    expect(found).not.toBeNull();
    expect(found!.endsWith("mount.config.js") || found!.endsWith("mount.config.json")).toBe(true);
    const cfg = await loadMountConfig(join(tmp, "mount.config.js"));
    expect(cfg.tables.length).toBeGreaterThan(0);
  });

  it("throws a helpful error when the config file does not exist", async () => {
    const missing = join(tmp, "does-not-exist.config.js");
    await expect(loadMountConfig(missing)).rejects.toThrow(/failed to load|mountsqli\.config|mount\.config/);
  });

  it("auto-detects tables from a `schema` folder", async () => {
    const dir = mkdtempSync(join(here, ".cfg-schema-"));
    mkdirSync(join(dir, "schema"), { recursive: true });
    writeFileSync(
      join(dir, "schema", "users.js"),
      `import { defineTable, int, text } from "@mountsqli/core";
export const users = defineTable("users", { id: int().pk(), email: text().notNull() });
export const NOT_A_TABLE = 42; // ignored`,
    );
    writeFileSync(
      join(dir, "schema", "posts.js"),
      `import { defineTable, int } from "@mountsqli/core";
export const posts = defineTable("posts", { id: int().pk(), authorId: int().notNull() });`,
    );
    const cfgFile = join(dir, "mount.config.js");
    writeFileSync(cfgFile, `export default { driver: "sqlite", schema: "./schema" };`);
    const cfg = await loadMountConfig(cfgFile);
    const names = cfg.tables.map((t) => (t as any).def.name).sort();
    expect(names).toEqual(["posts", "users"]); // NOT_A_TABLE ignored
    rmSync(dir, { recursive: true, force: true });
  });

  it("merges inline `tables` with `schema` folder and dedupes by name", async () => {
    const dir = mkdtempSync(join(here, ".cfg-merge-"));
    mkdirSync(join(dir, "schema2"), { recursive: true });
    writeFileSync(
      join(dir, "schema2", "extra.js"),
      `import { defineTable, int, text } from "@mountsqli/core";
export const tags = defineTable("tags", { id: int().pk(), label: text().notNull() });`,
    );
    const cfgFile = join(dir, "mount.config.js");
    writeFileSync(
      cfgFile,
      `import { defineTable, int } from "@mountsqli/core";
const inline = defineTable("inline", { id: int().pk() });
export default { driver: "sqlite", tables: [inline], schema: "./schema2" };`,
    );
    const cfg = await loadMountConfig(cfgFile);
    const names = cfg.tables.map((t) => (t as any).def.name).sort();
    // When explicit tables are provided, schema folder is NOT auto-collected
    // (the schema field is informational / for CLI-only detection).
    expect(names).toEqual(["inline"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("auto-collects from schema folder when no explicit tables", async () => {
    const dir = mkdtempSync(join(here, ".cfg-schema-only-"));
    mkdirSync(join(dir, "schema_t"), { recursive: true });
    writeFileSync(
      join(dir, "schema_t", "items.js"),
      `import { defineTable, int, text } from "@mountsqli/core";
export const items = defineTable("items", { id: int().pk(), label: text().notNull() });`,
    );
    const cfgFile = join(dir, "mount.config.js");
    writeFileSync(cfgFile, `export default { driver: "sqlite", schema: "./schema_t" };`);
    const cfg = await loadMountConfig(cfgFile);
    const names = cfg.tables.map((t) => (t as any).def.name).sort();
    expect(names).toEqual(["items"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("walks up from cwd to find mount.config when -c is omitted", async () => {
    // root has mount.config.js; subdir call should still find it.
    const found = findMountConfig(join(tmp, "schema"));
    expect(found).not.toBeNull();
    expect(found!.endsWith("mount.config.js")).toBe(true);
  });

  it("mountsqli() loads the config and returns a usable Db (override merges)", async () => {
    const dir = mkdtempSync(join(here, ".cfg-mount-"));
    mkdirSync(join(dir, "schema"), { recursive: true });
    writeFileSync(
      join(dir, "schema", "users.js"),
      `import { defineTable, int, text } from "@mountsqli/core";
export const users = defineTable("users", { id: int().pk(), email: text().notNull() });`,
    );
    writeFileSync(join(dir, "mount.config.js"), `export default { driver: "sqlite", url: "./app.db", schema: "./schema" };`);
    // Run from inside `dir` so the walk-up finds its mount.config.js.
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const db = await mountsqli(); // no config object passed at all
      expect(db.tables.length).toBe(1);
      expect((db.tables[0] as any).def.name).toBe("users");
      await db.close();
    } finally {
      process.chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
