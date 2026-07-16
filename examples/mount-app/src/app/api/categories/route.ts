// MountSQLI — Categories API (upsert + list)

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { categories } from "@/schema";

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.query(categories).orderBy("sort_order" as any, "asc").select("id", "name", "slug", "description", "color", "sort_order");
    return NextResponse.json(rows);
  } catch (err) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    const result = await db.query(categories)
      .returning("id", "name", "slug")
      .upsert(
        { name: body.name, slug: body.slug, description: body.description ?? "", color: body.color ?? null, sort_order: body.sort_order ?? 0 },
        ["slug"],
        { name: body.name, description: body.description ?? "", color: body.color ?? null },
      );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) { return apiError(err); }
}
