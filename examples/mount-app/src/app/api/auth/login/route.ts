import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { users } from "@/schema";
import { verifyPassword, MemoryRateLimiter } from "@mountsqli/auth";
import { signToken } from "@/lib/auth";

// Brute-force guard: max 5 failed attempts per username+IP within 60s,
// then lock out for 5 minutes.
const loginLimiter = new MemoryRateLimiter({ windowSec: 60, maxAttempts: 5, lockoutSec: 300 });

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
    if (loginLimiter.isLocked(limitKey)) {
      return NextResponse.json({ error: "Too many failed attempts. Try again later.", code: "RATE_LIMITED" }, { status: 429 });
    }

    const db = await getDb();
    const user = await db.query(users).where(eq("username", name)).findOne();

    if (!user || !user.password_hash || !verifyPassword(pass, user.password_hash)) {
      loginLimiter.recordFailure(limitKey);
      return NextResponse.json({ error: "Invalid username or password", code: "FORBIDDEN" }, { status: 401 });
    }
    loginLimiter.reset(limitKey);

    // Stateless JWT — user data encoded in the token, no DB lookup on verify
    const token = signToken({ id: user.id, username: user.username, role: user.role, display_name: user.display_name });

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
