import { NextRequest, NextResponse } from "next/server";
import { getDb, eq } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { comments } from "@/schema";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const result = await db.query(comments).where(eq("id", id)).returning("id").delete();
    if (result.changes === 0) return NextResponse.json({ error: "Comment not found", code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) { return apiError(err); }
}
