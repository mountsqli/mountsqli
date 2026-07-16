// MountSQLI — Full-Text Search API (LIKE across multiple columns)

import { NextRequest, NextResponse } from "next/server";
import { getDb, like, or } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { posts, users, comments } from "@/schema";

export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const type = searchParams.get("type") || "all";

    if (!q.trim()) return NextResponse.json([]);

    let results: any = {};

    // Search posts by title, body, excerpt
    if (type === "all" || type === "posts") {
      results.posts = await db.query(posts)
        .where(or(
          like("title", `%${q}%`),
          like("body", `%${q}%`),
          like("excerpt", `%${q}%`),
        ))
        .orderBy("view_count" as any, "desc")
        .limit(10)
        .select("id", "title", "excerpt", "status", "view_count", "created_at");
    }

    // Search users by username, display_name, email
    if (type === "all" || type === "users") {
      results.users = await db.query(users)
        .where(or(
          like("username", `%${q}%`),
          like("display_name", `%${q}%`),
          like("email", `%${q}%`),
        ))
        .limit(10)
        .select("id", "username", "display_name", "email", "role");
    }

    // Search comments by body
    if (type === "all" || type === "comments") {
      results.comments = await db.query(comments)
        .where(like("body", `%${q}%`))
        .limit(10)
        .select("id", "body", "post_id", "user_id", "created_at");
    }

    return NextResponse.json(results);
  } catch (err) {
    return apiError(err);
  }
}
