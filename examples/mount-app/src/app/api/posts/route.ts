// MountSQLI — Posts API (CRUD + aggregates + eager-loading + multi-row insert)

import { NextRequest, NextResponse } from "next/server";
import { getDb, eq, gte, lte, like, and, or, inArray } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { posts, post_categories } from "@/schema";

// GET /api/posts — list with composable filters, pagination, sort, eager-loading
export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(req.url);

    // If requesting a single post with full relations (detail view)
    if (searchParams.get("id")) {
      const [post] = await db.query(posts).findMany({
        with: {
          author: { with: { profile: true } },
          comments: {
            with: { author: true },
            orderBy: [{ column: "created_at", dir: "asc" }],
          },
          post_categories: { with: { category: true } },
        },
        where: eq("id", String(searchParams.get("id"))),
        limit: 1,
      });
      return NextResponse.json(post ?? null);
    }

    // Composable filters
    const filters: any[] = [];
    if (searchParams.get("status")) filters.push(eq("status", searchParams.get("status")!));
    if (searchParams.get("author_id")) filters.push(eq("user_id", searchParams.get("author_id")!));
    if (searchParams.get("min_views")) filters.push(gte("view_count", Number(searchParams.get("min_views"))));
    if (searchParams.get("max_views")) filters.push(lte("view_count", Number(searchParams.get("max_views"))));
    if (searchParams.get("search")) {
      const q = String(searchParams.get("search"));
      filters.push(or(like("title", `%${q}%`), like("body", `%${q}%`)));
    }
    if (searchParams.get("category_id")) {
      const catId = searchParams.get("category_id");
      const linked = await db.query(post_categories).where(eq("category_id", String(catId))).select("post_id");
      const postIds = linked.map((r: any) => r.post_id).filter(Boolean);
      if (postIds.length > 0) filters.push(inArray("id", postIds));
      else return NextResponse.json([]);
    }

    let q = db.query(posts);
    if (filters.length > 0) q = q.where(filters.length === 1 ? filters[0]! : and(...filters));

    // Pagination
    const page = Number(searchParams.get("page")) || 1;
    const limit = Number(searchParams.get("limit")) || 20;
    q = q.paginate(page, limit);

    // Sort
    const sort = searchParams.get("sort") || "created_at";
    const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";
    q = q.orderBy(sort as any, dir);

    const rows = await q.select("id", "title", "slug", "excerpt", "status", "view_count", "created_at", "user_id");
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err);
  }
}

// POST /api/posts — create post with RETURNING
export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    // Single insert
    if (!Array.isArray(body)) {
      const result = await db.query(posts)
        .returning("id", "title", "slug", "status", "created_at")
        .insert({
          title: body.title,
          slug: body.slug ?? body.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
          body: body.body ?? "",
          excerpt: body.excerpt ?? null,
          user_id: body.user_id,
          status: body.status ?? "draft",
          cover_image: body.cover_image ?? null,
        });
      return NextResponse.json(result.rows[0], { status: 201 });
    }

    // Multi-row insert
    const result = await db.query(posts).returning("id", "title").insert(body);
    return NextResponse.json({ count: result.rows.length, posts: result.rows }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
