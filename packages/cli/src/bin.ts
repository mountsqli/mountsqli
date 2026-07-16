#!/usr/bin/env node
// MountSQLI CLI entry point. Wires commander to the engine in lib.ts.

import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { loadConfig, cmdGenerate, cmdApply, cmdStatus, cmdDown, cmdAnalyze } from "./lib.js";
import { buildDevContext, startDevServer, toOpenApi } from "./server.js";
import { createRouter, crudRoutes } from "@mountsqli/api";
import { mountsqliFull } from "@mountsqli/core";
import { buildMergedContext, startMergedServer } from "@mountsqli/studio";
import { scaffoldProject } from "./init.js";
import {
  cmdCacheStats,
  cmdCacheClear,
  cmdCacheInspect,
  cmdCacheAnalyze,
  cmdCacheWarm,
  cmdCacheBenchmark,
} from "./cmd-cache.js";

const program = new Command();

program.name("mountsqli").description("MountSQLI — type-safe SQL platform CLI").version("0.1.0");

// ---------------------------------------------------------------------------
// Migrate
// ---------------------------------------------------------------------------

program
  .command("migrate")
  .description("Schema migration commands")
  .addCommand(
    new Command("generate")
      .description("Print SQL to bring the DB up to the configured schema")
      .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
      .action(async (o: { config: string }) => {
        const r = await cmdGenerate(await loadConfig(o.config));
        console.log(r.lines.join("\n"));
        process.exit(r.ok ? 0 : 1);
      }),
  )
  .addCommand(
    new Command("apply")
      .description("Apply pending schema changes")
      .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
      .option("--allow-destructive", "permit destructive (drop/alter) changes", false)
      .action(async (o: { config: string; allowDestructive?: boolean }) => {
        const r = await cmdApply(await loadConfig(o.config), { allowDestructive: o.allowDestructive });
        console.log(r.lines.join("\n"));
        process.exit(r.ok ? 0 : 1);
      }),
  )
  .addCommand(
    new Command("status")
      .description("Show applied migrations")
      .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
      .action(async (o: { config: string }) => {
        const r = await cmdStatus(await loadConfig(o.config));
        console.log(r.lines.join("\n"));
        process.exit(r.ok ? 0 : 1);
      }),
  )
  .addCommand(
    new Command("down")
      .description("Roll back the last migration")
      .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
      .action(async (o: { config: string }) => {
        const r = await cmdDown(await loadConfig(o.config));
        console.log(r.lines.join("\n"));
        process.exit(r.ok ? 0 : 1);
      }),
  );

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

program
  .command("init")
  .description("Scaffold mountsqli.config.js + a schema/ folder with a starter table")
  .argument("[dir]", "project directory to scaffold", ".")
  .action((dir: string) => {
    const written = scaffoldProject(dir);
    if (written.length === 0) {
      console.log("✓ Already scaffolded (mountsqli.config.js + schema/ present).");
    } else {
      console.log(`✓ Scaffolded:\n  • ${written.join("\n  • ")}`);
      console.log("Edit schema/users.js (or add more tables), then run 'mountsqli migrate generate'.");
    }
  });

// ---------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------

program
  .command("analyze")
  .description("Advisory health report: schema drift, index suggestions, plan warnings")
  .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
  .action(async (o: { config: string }) => {
    const r = await cmdAnalyze(await loadConfig(o.config));
    console.log(r.lines.join("\n"));
    process.exit(r.ok ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// Dev
// ---------------------------------------------------------------------------

program
  .command("dev")
  .description("Run a zero-dependency server: REST CRUD + storage + realtime + Studio dashboard")
  .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
  .option("-p, --port <port>", "port to listen on", "3737")
  .action(async (o: { config: string; port: string }) => {
    const { db, config } = await mountsqliFull();
    const ctx = buildMergedContext(db, { port: Number(o.port), config });
    startMergedServer(ctx, { port: Number(o.port) });
  });

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

program
  .command("api")
  .description("API surface generation")
  .addCommand(
    new Command("generate")
      .description("Emit an OpenAPI 3.1 spec from configured table CRUD routes")
      .option("-c, --config <file>", "config file (auto-detected from project root if omitted)", "")
      .option("-o, --out <file>", "output file (default from mountsqli.config.js or 'openapi.json')")
      .action(async (o: { config: string; out?: string }) => {
        const cfg = await loadConfig(o.config);
        const outFile = o.out ?? ((cfg.api?.out as string) ?? "openapi.json");
        const title = (cfg.api?.title as string) ?? "MountSQLI API";
        const router = createRouter();
        for (const t of cfg.tables) for (const r of crudRoutes(t).routes) router.add(r);
        const spec = toOpenApi(router, title);
        writeFileSync(outFile, JSON.stringify(spec, null, 2));
        console.log(`✓ Wrote ${outFile} (${router.routes.length} routes).`);
      }),
  );

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = program.command("cache").description("Cache management commands");

cache
  .command("stats")
  .description("Show live cache metrics")
  .action(async () => {
    const lines = await cmdCacheStats();
    for (const l of lines) console.log(l);
  });

cache
  .command("clear")
  .description("Flush the entire cache (or a namespace)")
  .option("-n, --namespace <namespace>", "namespace to clear")
  .action(async (o: { namespace?: string }) => {
    const lines = await cmdCacheClear(o.namespace);
    for (const l of lines) console.log(l);
  });

cache
  .command("inspect")
  .description("Inspect a specific cache entry")
  .argument("<key>", "cache key to inspect")
  .action(async (key: string) => {
    const lines = await cmdCacheInspect(key);
    for (const l of lines) console.log(l);
  });

cache
  .command("analyze")
  .description("Analyze cache usage patterns and suggest improvements")
  .action(async () => {
    const lines = await cmdCacheAnalyze();
    for (const l of lines) console.log(l);
  });

cache
  .command("warm")
  .description("Manually warm the cache")
  .action(async () => {
    const lines = await cmdCacheWarm();
    for (const l of lines) console.log(l);
  });

cache
  .command("benchmark")
  .description("Run a cache performance benchmark")
  .action(async () => {
    const lines = await cmdCacheBenchmark();
    for (const l of lines) console.log(l);
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`✗ ${msg}`);
  process.exit(1);
});
