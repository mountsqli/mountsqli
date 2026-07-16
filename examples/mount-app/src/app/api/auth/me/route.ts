import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { users } from "@/schema";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized", code: "FORBIDDEN" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const db = await getDb();
    if (!db.auth) {
      return NextResponse.json({ error: "Auth subsystem unavailable", code: "UNAVAILABLE" }, { status: 503 });
    }
    const result = await db.auth.authenticate(token);

    if (!result.ok) {
      return NextResponse.json({ error: "Invalid token", code: "FORBIDDEN", detail: result.reason }, { status: 401 });
    }

    const user = await db.query(users).where(eq("id", result.user?.userId)).findOne();

    return NextResponse.json({ user, authenticated: result });
  } catch (err) {
    return apiError(err);
  }
}
