// MountSQLI — Single User API (GET/PUT/DELETE + JSON extract)

import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { users } from "@/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const user = await db.query(users).where(eq("id", id)).findOne();
    return NextResponse.json(user ?? null);
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const body = await req.json();

    const result = await db.query(users)
      .where(eq("id", id))
      .returning("id", "username", "email", "updated_at")
      .update(body);

    if (result.changes === 0) {
      return NextResponse.json({ error: "User not found", code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const result = await db.query(users).where(eq("id", id)).returning("id").delete();
    if (result.changes === 0) {
      return NextResponse.json({ error: "User not found", code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
