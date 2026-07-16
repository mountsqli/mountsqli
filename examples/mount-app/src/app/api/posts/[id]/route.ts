// MountSQLI — Single Post API (GET/PUT/DELETE with RETURNING)

import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { posts } from "@/schema";

// GET /api/posts/[id] — get post with nested relations
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const [post] = await db.query(posts).findMany({
      with: {
        author: { with: { profile: true } },
        comments: { with: { author: true }, orderBy: [{ column: "created_at", dir: "asc" }] },
        post_categories: { with: { category: true } },
      },
      where: eq("id", id),
      limit: 1,
    });

    return NextResponse.json(post ?? null);
  } catch (err) {
    return apiError(err);
  }
}

// PUT /api/posts/[id] — update post with RETURNING
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const body = await req.json();

    const result = await db.query(posts)
      .where(eq("id", id))
      .returning("id", "title", "status", "updated_at")
      .update(body);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Post not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    return apiError(err);
  }
}

// DELETE /api/posts/[id] — delete post
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const result = await db.query(posts).where(eq("id", id)).returning("id").delete();

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Post not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
