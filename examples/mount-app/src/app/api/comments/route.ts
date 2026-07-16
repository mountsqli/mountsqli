import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { comments } from "@/schema";

export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(req.url);

    let q = db.query(comments);
    if (searchParams.get("post_id")) q = q.where(eq("post_id", String(searchParams.get("post_id"))));
    if (searchParams.get("user_id")) q = q.where(eq("user_id", String(searchParams.get("user_id"))));
    q = q.orderBy("created_at" as any, "desc");
    if (searchParams.get("limit")) q = q.limit(Number(searchParams.get("limit")));

    const rows = await q.select("id", "post_id", "user_id", "body", "parent_id", "upvotes", "created_at");
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    const result = await db.query(comments)
      .returning("id", "post_id", "user_id", "body", "created_at")
      .insert({
        post_id: body.post_id,
        user_id: body.user_id,
        body: body.body,
        parent_id: body.parent_id ?? null,
      });

    // Publish realtime event via db.realtime
    try {
      if (db.realtime) {
        const channel = db.realtime.channel(`post:${body.post_id}`);
        channel.publish({ type: "new_comment", comment: result.rows[0] });
      }
    } catch { /* fire-and-forget */ }

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
