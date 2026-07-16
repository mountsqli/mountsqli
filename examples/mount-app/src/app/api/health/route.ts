// MountSQLI — Health check endpoint

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";


export async function GET() {
  try {
    const db = await getDb();
    const alive = (await db.driver.ping?.()) ?? true;

    // Optionally test cache
    let cacheAlive = false;
    try {
      if (db.cache) {
        await db.cache.manager.set("health:test", "ok", { ttl: 10 });
        const val = await db.cache.manager.get("health:test");
        cacheAlive = val !== undefined;
      }
    } catch { /* cache not available */ }

    return NextResponse.json({
      status: alive ? "ok" : "degraded",
      driver: db.driver.name,
      cache: cacheAlive ? "connected" : "unavailable",
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ status: "error", error: err.message }, { status: 503 });
  }
}
