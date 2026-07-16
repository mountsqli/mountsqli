// MountSQLI — Next.js API error helper.
// Returns structured JSON error responses matching MountError patterns.

import { NextResponse } from "next/server";

export interface ApiError {
  error: string;
  code: string;
  detail?: string;
}

const statusMap: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  FORBIDDEN: 403,
  QUERY_FAILED: 400,
  CONFIG: 500,
  CONNECTION: 503,
  INTERNAL: 500,
};

export function apiError(err: unknown): NextResponse<ApiError> {
  const isMountError = err instanceof Error && "code" in err;
  const code = isMountError ? (err as any).code : "INTERNAL";
  const status = statusMap[code] ?? 500;
  const message = isMountError ? (err as any).message : "Internal server error";
  const detail = isMountError ? (err as any).details?.detail : undefined;

  return NextResponse.json(
    { error: message, code, ...(detail ? { detail } : {}) },
    { status },
  );
}
