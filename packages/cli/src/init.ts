// MountSQLI — `mount init` scaffold.
//
// Produces a type-safe `mountsqli.config.js` that points at a `schema/` folder,
// and a starter `schema/` folder with one example table. Every
// `defineTable(...)` export under that folder is auto-detected, so you never
// list tables by hand.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function scaffoldConfig(): string {
  return `// MountSQLI config — type-safe, shared by the CLI and your app.
// Uses both "schema" (for CLI auto-detection) and explicit "tables"
// (for bundlers like Next.js Turbopack that can't trace dynamic imports).
import { defineConfig } from "@mountsqli/core";
import { users } from "./schema/users.js";

export default defineConfig({
  driver: "sqlite",        // "sqlite" | "postgres" | "mysql"
  url: "./dev.db",         // file path (sqlite) or connection string (postgres/mysql)
  schema: "./schema",      // folder of defineTable(...) modules (auto-collected)
  tables: [users],         // explicit list — required for bundlers, works everywhere

  // (optional) subsystem configs:
  // ai:       { provider: "openai", model: "gpt-4o" },
  // auth:     { jwtSecret: process.env.JWT_SECRET },
  // storage:  { bucket: "./uploads" },
  // realtime: { maxChannels: 100 },
});
`;
}

/** Starter table module written into ./schema. */
export function scaffoldTable(): string {
  return `// MountSQLI table — exported with 'export const' so it is auto-detected.
import { defineTable, int, text, bool } from "@mountsqli/core";

export const users = defineTable("users", {
  id: int().pk(),
  email: text().notNull().unique(),
  name: text(),
  active: bool().notNull().default(true),
});
`;
}

/**
 * Scaffold the whole project at `root`: write `mountsqli.config.js` and a
 * `schema/` folder containing one starter table. Returns the list of paths
 * written (relative to `root`).
 */
export function scaffoldProject(root: string = "."): string[] {
  const written: string[] = [];

  const configPath = join(root, "mountsqli.config.js");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, scaffoldConfig());
    written.push("mountsqli.config.js");
  }

  const schemaDir = join(root, "schema");
  mkdirSync(schemaDir, { recursive: true });
  const tablePath = join(schemaDir, "users.js");
  if (!existsSync(tablePath)) {
    writeFileSync(tablePath, scaffoldTable());
    written.push("schema/users.js");
  }

  return written;
}

