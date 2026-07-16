// MountSQLI — Analytics API (aggregates, window functions, GROUP BY, CTE, set ops)

import { NextRequest, NextResponse } from "next/server";
import { getDb, eq, gt, gte, lte, and, or } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { posts, users, comments }from "@/schema";

export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section") || "dashboard";

    switch (section) {

      // ── Dashboard: counts, sums, top posts ────────────────────────
      case "dashboard": {
        const [userCount] = await db.query(users).count("cnt", "id").select() as any[];
        const [postCount] = await db.query(posts).count("cnt", "id").select() as any[];
        const [commentCount] = await db.query(comments).count("cnt", "id").select() as any[];
        const [totalViews] = await db.query(posts).sum("view_count", "total").select() as any[];
        const topPosts = await db.query(posts).findMany({
          with: { author: true },
          where: eq("status", "published"),
          orderBy: [{ column: "view_count", dir: "desc" }],
          limit: 5,
        });

        return NextResponse.json({
          stats: { users: userCount.cnt, posts: postCount.cnt, comments: commentCount.cnt, total_views: totalViews.total ?? 0 },
          top_posts: topPosts.map((p: any) => ({ id: p.id, title: p.title, views: p.view_count, author: p.author?.username })),
        });
      }

      // ── Aggregates ─────────────────────────────────────────────────
      case "aggregates": {
        const [row] = await db.query(posts)
          .count("total", "id")
          .sum("view_count", "total_views")
          .avg("view_count", "avg_views")
          .min("view_count", "min_views")
          .max("view_count", "max_views")
          .select() as any[];
        return NextResponse.json(row);
      }

      // ── Window functions ───────────────────────────────────────────
      case "window": {
        if (searchParams.get("fn") === "ranking") {
          const rows = await db.query(posts)
            .rowNumber("rn", [], [{ column: "view_count", dir: "desc" }])
            .denseRank("dr", [], [{ column: "view_count", dir: "desc" }])
            .limit(20)
            .select("id", "title", "view_count", "user_id");
          return NextResponse.json(rows);
        }
        if (searchParams.get("fn") === "lag") {
          const rows = await db.query(posts)
            .lag("view_count", "prev_views", [], [{ column: "created_at", dir: "asc" }])
            .lead("view_count", "next_views", [], [{ column: "created_at", dir: "asc" }])
            .limit(20)
            .select("id", "title", "view_count", "created_at");
          return NextResponse.json(rows);
        }
        break;
      }

      // ── GROUP BY ───────────────────────────────────────────────────
      case "group-by": {
        if (searchParams.get("by") === "status") {
          const rows = await db.raw(
            "SELECT status, COUNT(*)::int as cnt FROM posts GROUP BY status ORDER BY cnt DESC"
          );
          return NextResponse.json(rows);
        }
        if (searchParams.get("by") === "author") {
          const rows = await db.raw(
            "SELECT user_id, COUNT(*)::int as post_count, SUM(view_count)::int as total_views FROM posts GROUP BY user_id HAVING COUNT(*) > $1 ORDER BY total_views DESC",
            [1],
          );
          return NextResponse.json(rows);
        }
        break;
      }

      // ── Select Expr (raw SQL in SELECT) ────────────────────────────
      case "select-expr": {
        const rows = await db.raw(
          "SELECT status, COUNT(*)::int as cnt, ROUND(COUNT(*)::numeric * 100 / (SELECT COUNT(*) FROM posts), 1) as pct_of_total FROM posts GROUP BY status"
        );
        return NextResponse.json(rows);
      }

      // ── UNION set operation ────────────────────────────────────────
      case "union": {
        const unionRows = await db.query(posts)
          .where(gt("view_count", 100))
          .union(db.query(posts).where(gte("view_count", 50)))
          .select("id", "title", "view_count", "user_id");
        return NextResponse.json(unionRows);
      }

      // ── DISTINCT ON ────────────────────────────────────────────────
      case "distinct-on": {
        const rows = await db.query(posts)
          .distinctOn("user_id").orderBy("user_id" as any)
          .select("id", "title", "user_id", "view_count");
        return NextResponse.json(rows);
      }

      // ── CTE (WITH) ─────────────────────────────────────────────────
      case "cte": {
        const rows = await db.raw(
          "WITH author_counts AS (SELECT user_id, COUNT(*)::int as post_count FROM posts GROUP BY user_id) " +
          "SELECT users.id as user_id, users.username, COALESCE(author_counts.post_count, 0) as post_count " +
          "FROM users LEFT JOIN author_counts ON users.id = author_counts.user_id"
        );
        return NextResponse.json(rows);
      }
    }

    return NextResponse.json({ error: "Unknown section", code: "VALIDATION" }, { status: 400 });
  } catch (err) {
    return apiError(err);
  }
}
