// MountSQLI — Tags API

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { tags } from "@/schema";

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.query(tags).orderBy("name" as any, "asc").select("id", "name", "slug");
    return NextResponse.json(rows);
  } catch (err) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    const result = await db.query(tags)
      .returning("id", "name", "slug")
      .upsert(
        { name: body.name, slug: body.slug },
        ["slug"],
        { name: body.name },
      );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) { return apiError(err); }
}
