import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { users } from "@/schema";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized", code: "FORBIDDEN" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: "Invalid token", code: "FORBIDDEN", detail: "token_expired" }, { status: 401 });
    }

    const db = await getDb();
    const user = await db.query(users).where(eq("id", payload.sub)).findOne();

    return NextResponse.json({ user, authenticated: true });
  } catch (err) {
    return apiError(err);
  }
}
