import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";

export async function GET() {
  try {
    const db = await getDb();
    if (!db.cache) {
      return NextResponse.json({ error: "Cache not available", code: "UNAVAILABLE" }, { status: 503 });
    }
    const stats = await db.cache.stats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("CACHE ERROR:", err);
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { key, value, ttl } = await req.json();
    const db = await getDb();
    if (!db.cache) {
      return NextResponse.json({ error: "Cache not available", code: "UNAVAILABLE" }, { status: 503 });
    }
    await db.cache.manager.set(key, value, { ttl: ttl ?? 300 });
    return NextResponse.json({ cached: true, key });
  } catch (err) { return apiError(err); }
}

export async function DELETE() {
  try {
    const db = await getDb();
    if (!db.cache) {
      return NextResponse.json({ error: "Cache not available", code: "UNAVAILABLE" }, { status: 503 });
    }
    await db.cache.clear();
    return NextResponse.json({ cleared: true });
  } catch (err) { return apiError(err); }
}
