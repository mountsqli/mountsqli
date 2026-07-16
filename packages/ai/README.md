# @mountsqli/ai

AI engine for MountSQLI: natural-language → SQL, plan explain, optimizer suggestions, and review — all routed through the **same compiler validator** as hand-written queries.

## Install

```bash
pnpm add @mountsqli/ai
```

## NL → SQL

```ts
import { Ai, schemaContext } from "@mountsqli/ai";

const ai = new Ai({ provider });   // any ModelProvider
const ctx = schemaContext(tablesOf(users, posts));

const { sql, plan } = await ai.nlToSql("users older than 18, newest first", ctx);
// sql is compiled + validated by @mountsqli/compiler before it is returned
```

## Explain / optimize / review

```ts
import { explainPlan, optimizePlan, reviewPlans } from "@mountsqli/ai";

explainPlan(plan);        // human-readable breakdown
optimizePlan(plan);       // OptimizeSuggestion[] (indexes, rewrites)
reviewPlans([plan]);      // ReviewFinding[] (anti-patterns, SELECT *)
```

Every generated plan is validated by the compiler, so AI-produced SQL cannot sidestep injection-safety or type-checking.

## Provider

```ts
interface ModelProvider {
  complete(prompt: string): Promise<string>;
}
```

Supply any LLM-backed `ModelProvider`; the engine is provider-agnostic.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `Ai` | class | `nlToSql(prompt, schemaCtx)` → validated `{ sql, plan }`. |
| `ModelProvider`, `AiConfig` | type | Provider contract + config. |
| `schemaContext(tables)` | fn | Render `TableDef[]` as an LLM prompt fragment. |
| `NlResult` | type | NL→SQL output. |
| `explainPlan(plan)` | fn | `ExplainResult`. |
| `optimizePlan(plan)` | fn | `OptimizeSuggestion[]`. |
| `reviewPlans(plans)` | fn | `ReviewFinding[]`. |
