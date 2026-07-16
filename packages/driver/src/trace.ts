// MountSQLI — optional OpenTelemetry tracing.
//
// This module provides lightweight trace helpers that the key execution
// boundaries call. If `@opentelemetry/api` is installed, real spans are
// created. Otherwise, everything no-ops — zero overhead, zero dependencies.
//
// Usage:
//   import { tracer } from "@mountsqli/driver";
//   tracer.startSpan("name", () => { ... });

export interface TraceSpan {
  end(): void;
  setAttribute(key: string, value: unknown): void;
  setStatus(status: { code: number; message?: string }): void;
}

interface Tracer {
  startSpan(name: string, fn?: () => void): TraceSpan;
}

// Lazy-load OTel API if available (peer dependency — not required).
// Uses indirect eval/Function to bypass TypeScript module resolution
// since @opentelemetry/api is an optional dependency.
let otelTracer: any = null;

function getOTelTracer(): any {
  if (otelTracer !== null) return otelTracer;
  try {
    // eslint-disable-next-line no-eval
    const imp = Function("pkg", "return import(pkg)");
    imp("@opentelemetry/api").then((api: any) => {
      otelTracer = api.trace.getTracer("@mountsqli/core", "0.1.0");
    }).catch(() => {});
  } catch {}
  otelTracer = otelTracer ?? false; // false = loaded and not available
  return null;
}

getOTelTracer();

export const tracer: Tracer = {
  startSpan(name: string, fn?: () => void): TraceSpan {
    const t = otelTracer;
    if (t && typeof t === "object") {
      return t.startSpan(name);
    }
    // No-op span.
    return {
      end() {},
      setAttribute() {},
      setStatus() {},
    };
  },
};

/**
 * Run an async function inside a traced span.
 * Usage:
 *   await traceSpan("compilePlan", { "plan.table": table }, () => compilePlan(...));
 */
export async function traceSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name);
  for (const [k, v] of Object.entries(attributes)) {
    span.setAttribute(k, v);
  }
  try {
    const result = await fn();
    span.setStatus({ code: 1 }); // OK
    return result;
  } catch (e) {
    span.setStatus({ code: 2, message: (e as Error).message }); // ERROR
    throw e;
  } finally {
    span.end();
  }
}
