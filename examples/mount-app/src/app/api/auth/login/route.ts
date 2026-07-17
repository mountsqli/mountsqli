import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { users } from "@/schema";
import { verifyPassword } from "@mountsqli/auth";
import { signToken } from "@/lib/auth";

// Simple in-memory rate limiter for brute-force protection.
// 5 failed attempts per username+IP within 60s, then lock out for 5 minutes.
const failureCounts = new Map<string, { count: number; lockedUntil: number }>();
const WINDOW_MS = 60_000;
const LOCKOUT_MS = 300_000;
const MAX_ATTEMPTS = 5;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = failureCounts.get(key);
  if (entry && entry.lockedUntil > now) return false; // locked
  return true;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failureCounts.get(key);
  if (!entry || now - entry.lockedUntil > WINDOW_MS) {
    failureCounts.set(key, { count: 1, lockedUntil: now + WINDOW_MS });
  } else {
    const count = entry.count + 1;
    failureCounts.set(key, {
      count,
      lockedUntil: count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : entry.lockedUntil,
    });
  }
}

function resetRateLimit(key: string): void {
  failureCounts.delete(key);
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    const name = String(username ?? "");
    const pass = String(password ?? "");
    if (!name || !pass) {
      return NextResponse.json({ error: "Username and password required", code: "VALIDATION" }, { status: 400 });
    }

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limitKey = `${name}:${clientIp}`;
    if (!checkRateLimit(limitKey)) {
      return NextResponse.json({ error: "Too many failed attempts. Try again later.", code: "RATE_LIMITED" }, { status: 429 });
    }

    const db = await getDb();
    const user = await db.query(users).where(eq("username", name)).findOne();

    if (!user || !user.password_hash || !(await verifyPassword(pass, user.password_hash))) {
      recordFailure(limitKey);
      return NextResponse.json({ error: "Invalid username or password", code: "FORBIDDEN" }, { status: 401 });
    }
    resetRateLimit(limitKey);

    // Stateless JWT — user data encoded in the token, no DB lookup on verify
    const token = await signToken({ id: user.id, username: user.username, role: user.role, display_name: user.display_name });

    const response = NextResponse.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    });
    response.cookies.set("session", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });

    return response;
  } catch (err) {
    return apiError(err);
  }
}
