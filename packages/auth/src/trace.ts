// MountSQLI — auth tracing (optional OpenTelemetry integration).

export interface TraceSpan {
  end(): void;
  setAttribute(key: string, value: unknown): void;
  setStatus(status: { code: number; message?: string }): void;
}

let otelTracer: any = null;

function ensureOTel(): void {
  if (otelTracer !== null) return;
  try {
    const imp = Function("pkg", "return import(pkg)");
    imp("@opentelemetry/api").then((api: any) => {
      otelTracer = api.trace.getTracer("@mountsqli/auth", "0.1.0");
    }).catch(() => { otelTracer = false; });
  } catch {}
  if (otelTracer === null) otelTracer = false;
}

ensureOTel();

export function traceSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const t = otelTracer;
  if (!t || typeof t !== "object") return fn();
  const span = t.startSpan(name);
  for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
  return fn()
    .then((r) => { span.setStatus({ code: 1 }); span.end(); return r; })
    .catch((e) => { span.setStatus({ code: 2, message: e.message }); span.end(); throw e; });
}
