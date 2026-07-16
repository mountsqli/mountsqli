// MountSQLI — Comprehensive Express.js Example (Postgres)

import express from "express";
import type { Request, Response, RequestHandler, NextFunction } from "express";
import "@mountsqli/driver-postgres"; // registers "postgres" driver
import { MountError } from "@mountsqli/driver";
import { mountsqli, sql, eq, ne, gt, gte, lt, lte, like, inArray, isNull, and, or } from "@mountsqli/core";
import { users, posts, comments, categories, post_categories, profiles } from "../schema/index.js";
import config from "../mountsqli.config.js";

// ── Boot ─────────────────────────────────────────────────────────────────
async function main() {
  const db = await mountsqli(config);

  const app = express();
  app.use(express.json());

  const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res, next) => { fn(req, res).catch(next); };

  // ── Health ────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", driver: db.driver.name });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. BASIC CRUD — USERS
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/users", asyncHandler(async (req, res) => {
    let q = db.query(users);

    const filterList: any[] = [];
    if (req.query.role)          filterList.push(eq("role", req.query.role));
    if (req.query.active)        filterList.push(eq("active", req.query.active === "true"));
    if (req.query.min_points)    filterList.push(gte("points", Number(req.query.min_points)));
    if (req.query.max_points)    filterList.push(lte("points", Number(req.query.max_points)));
    if (req.query.username_like) filterList.push(like("username", `%${req.query.username_like}%`));
    if (req.query.email_in)      filterList.push(inArray("email", String(req.query.email_in).split(",")));
    if (req.query.no_bio)        filterList.push(isNull("bio"));

    if (filterList.length > 0) {
      q = q.where(filterList.length === 1 ? filterList[0]! : and(...filterList));
    }

    if (req.query.page) {
      q = q.paginate(Number(req.query.page) || 1, Number(req.query.limit) || 10);
    } else {
      if (req.query.limit)  q = q.limit(Number(req.query.limit));
      if (req.query.offset) q = q.offset(Number(req.query.offset));
    }
    if (req.query.sort) {
      q = q.orderBy(req.query.sort as any, req.query.dir === "desc" ? "desc" : "asc");
    }
    res.json(await q.select());
  }));

  app.get("/users/:id", asyncHandler(async (req, res) => {
    const user = await db.query(users).where(eq("id", String(req.params.id))).findOne();
    res.json(user ?? null);
  }));

  app.post("/users", asyncHandler(async (req, res) => {
    const { username, email, display_name, role } = req.body;
    const result = await db.query(users)
      .returning("id", "username", "email", "created_at")
      .insert({
        username: username ?? `user_${Date.now()}`,
        email: email ?? `${Date.now()}@test.com`,
        display_name: display_name ?? "New User",
        role: role ?? "user",
      });
    res.status(201).json(result.rows[0]);
  }));

  app.put("/users/:id", asyncHandler(async (req, res) => {
    const result = await db.query(users)
      .where(eq("id", String(req.params.id)))
      .returning("id", "username", "email", "updated_at")
      .update(req.body);
    if (result.changes === 0) throw new MountError("NOT_FOUND", "User not found");
    res.json(result.rows[0]);
  }));

  app.delete("/users/:id", asyncHandler(async (req, res) => {
    const result = await db.query(users)
      .where(eq("id", String(req.params.id)))
      .returning("id")
      .delete();
    if (result.changes === 0) throw new MountError("NOT_FOUND", "User not found");
    res.json({ deleted: result.rows[0] });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 2. EAGER-LOADING — findMany with nested `with`
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/posts", asyncHandler(async (req, res) => {
    const where = req.query.status ? eq("status", req.query.status) : undefined;
    const rows = await db.query(posts).findMany({
      with: {
        author: true,
        comments: { with: { author: true } },
        post_categories: { with: { category: true } },
      },
      where,
      orderBy: [{ column: "created_at", dir: "desc" }],
      limit: Number(req.query.limit) || 20,
      offset: Number(req.query.offset) || 0,
    });
    res.json(rows);
  }));

  app.get("/posts/:id", asyncHandler(async (req, res) => {
    const [post] = await db.query(posts).findMany({
      with: {
        author: { with: { profile: true } },
        comments: { with: { author: true }, orderBy: [{ column: "created_at", dir: "asc" }] },
      },
      where: eq("id", String(req.params.id)),
      limit: 1,
    });
    res.json(post ?? null);
  }));

  app.post("/posts", asyncHandler(async (req, res) => {
    const { title, slug, body, user_id, status } = req.body;
    const result = await db.query(posts)
      .returning()
      .insert({ title, slug: slug ?? title.toLowerCase().replace(/\s+/g, "-"), body: body ?? "", user_id, status: status ?? "draft" });
    res.status(201).json(result.rows[0]);
  }));

  app.put("/posts/:id", asyncHandler(async (req, res) => {
    const result = await db.query(posts)
      .where(eq("id", String(req.params.id)))
      .returning("id", "title", "updated_at")
      .update(req.body);
    if (!result) throw new MountError("NOT_FOUND", "Post not found");
    res.json(result.rows[0]);
  }));

  app.delete("/posts/:id", asyncHandler(async (req, res) => {
    const result = await db.query(posts).where(eq("id", String(req.params.id))).delete();
    if (result.changes === 0) throw new MountError("NOT_FOUND", "Post not found");
    res.json({ deleted: true });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 3. COMMENTS
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/comments", asyncHandler(async (req, res) => {
    let q = db.query(comments);
    if (req.query.post_id) q = q.where(eq("post_id", String(req.query.post_id)));
    if (req.query.sort) q = q.orderBy(req.query.sort as any, "desc");
    res.json(await q.select());
  }));

  app.post("/comments", asyncHandler(async (req, res) => {
    const { post_id, user_id, body } = req.body;
    const result = await db.query(comments)
      .returning("id", "post_id", "user_id", "created_at")
      .insert({ post_id, user_id, body });
    res.status(201).json(result.rows[0]);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 4. AGGREGATES — count, sum, avg, min, max
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/stats/posts", asyncHandler(async (_req, res) => {
    const [row] = await db.query(posts)
      .count("total", "id")
      .sum("view_count", "total_views")
      .avg("view_count", "avg_views")
      .min("view_count", "min_views")
      .max("view_count", "max_views")
      .select();
    res.json(row);
  }));

  app.get("/stats/users/:id", asyncHandler(async (req, res) => {
    const postStats: any = (await db.query(posts)
      .where(eq("user_id", String(req.params.id)))
      .count("total_posts", "id")
      .select())[0];
    const [user] = await db.query(users)
      .where(eq("id", String(req.params.id)))
      .select("username", "points");
    res.json({ ...postStats, ...user });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 5. WINDOW FUNCTIONS — row_number, dense_rank, lag, lead
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/ranking", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .rowNumber("rn", [], [{ column: "view_count", dir: "desc" }])
      .denseRank("dr", [], [{ column: "view_count", dir: "desc" }])
      .limit(20)
      .select("id", "title", "view_count", "user_id");
    res.json(rows);
  }));

  app.get("/analytics/posts/lag", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .lag("view_count", "prev_views", [], [{ column: "created_at", dir: "asc" }])
      .lead("view_count", "next_views", [], [{ column: "created_at", dir: "asc" }])
      .limit(20)
      .select("id", "title", "view_count", "created_at");
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 6. GROUP BY / HAVING
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/by-status", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .groupBy("status")
      .count("cnt", "id")
      .orderBy("cnt" as any, "desc")
      .select();
    res.json(rows);
  }));

  app.get("/analytics/posts/by-author", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .groupBy("user_id")
      .count("post_count", "id")
      .sum("view_count", "total_views")
      .having("post_count", ">", 1)
      .orderBy("total_views" as any, "desc")
      .select();
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 7. SELECT EXPR — raw SQL expressions in SELECT
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/select-expr", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .count("cnt", "id")
      .selectExpr("CAST(view_count AS REAL) / MAX(view_count) * 100", [], "pct_of_max")
      .groupBy("status")
      .select();
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 8. SET OPERATIONS — UNION
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/set", asyncHandler(async (_req, res) => {
    const highViews = await db.query(posts).where(gt("view_count", 100)).select("id", "title", "view_count");
    const lowViews  = await db.query(posts).where(lte("view_count", 10)).select("id", "title", "view_count");
    const unionRows = await db.query(posts)
      .where(gt("view_count", 100))
      .union(db.query(posts).where(gte("view_count", 50)))
      .select("id", "title", "view_count");
    res.json({ high_view_count: highViews, low_view_count: lowViews, union: unionRows });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 9. UPSERT & INSERT IGNORE
  // ═══════════════════════════════════════════════════════════════════════

  app.post("/categories", asyncHandler(async (req, res) => {
    const { name, slug, description, sort_order } = req.body;
    const result = await db.query(categories)
      .returning("id", "name", "slug")
      .upsert(
        { name, slug, description: description ?? "", sort_order: sort_order ?? 0 },
        ["slug"],
        { name, description: description ?? "", sort_order: sort_order ?? 0 },
      );
    res.json(result.rows[0]);
  }));

  app.post("/users/ensure", asyncHandler(async (req, res) => {
    const { username, email, display_name } = req.body;
    const result = await db.query(users)
      .insertIgnore({ username, email, display_name }, ["username"]);
    res.json({ inserted: result.changes > 0 });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 10. TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  app.post("/posts/:id/publish", asyncHandler(async (req, res) => {
    const postId = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const existing = await tx.query(posts).where(eq("id", postId)).select("id", "title");
      if (existing.length === 0) throw new MountError("NOT_FOUND", "Post not found");
      await tx.query(posts)
        .where(eq("id", postId))
        .update({ status: "published", published_at: new Date().toISOString() as any });
      const [post] = await tx.query(posts).where(eq("id", postId)).select("id", "title", "status", "published_at");
      return post;
    });
    res.json(result);
  }));

  app.post("/transfer-points", asyncHandler(async (req, res) => {
    const { from_user_id, to_user_id, amount } = req.body;
    const result = await db.transaction(async (tx) => {
      const [from] = await tx.query(users).where(eq("id", from_user_id)).select("id", "points");
      if (!from) throw new MountError("NOT_FOUND", "User not found");
      if (from.points < amount) throw new MountError("VALIDATION", "Insufficient points");
      await tx.query(users).where(eq("id", from_user_id)).update({ points: from.points - amount });
      const [to] = await tx.query(users).where(eq("id", to_user_id)).select("points");
      await tx.query(users).where(eq("id", to_user_id)).update({ points: to.points + amount });
      return { from: from_user_id, to: to_user_id, amount, status: "transferred" };
    });
    res.json(result);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 11. CTE (WITH)
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/cte", asyncHandler(async (_req, res) => {
    const authorCounts = db.query(posts).groupBy("user_id").count("post_count", "id");
    const rows = await db.query(users)
      .with("author_counts", authorCounts)
      .selectExpr("users.id", [], "user_id")
      .selectExpr("users.username", [], "username")
      .selectExpr("COALESCE(author_counts.post_count, 0)", [], "post_count")
      .selectExpr("COALESCE(author_counts.user_id, users.id)", [], "cte_ref")
      .select();
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 12. DISTINCT ON
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/distinct-on", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .distinctOn("user_id")
      .orderBy("user_id")
      .select("id", "title", "user_id", "view_count");
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 13. COMPLEX COMPOSABLE FILTERS
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/posts/advanced", asyncHandler(async (req, res) => {
    const minViews = Number(req.query.min_views) || 0;
    const rows = await db.query(posts)
      .where(and(
        eq("status", req.query.status || "published"),
        gte("view_count", minViews),
        or(eq("user_id", String(req.query.user_id || "")), ne("user_id", "")),
      ))
      .orderBy("view_count", "desc")
      .limit(20)
      .select("id", "title", "user_id", "view_count", "status");
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 14. WHERE EXPR — raw SQL in WHERE (Postgres-style)
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/posts/recent", asyncHandler(async (_req, res) => {
    const rows = await db.query(posts)
      .where(eq("status", "published"))
      .whereExpr("created_at >= CURRENT_DATE - INTERVAL '7 days'")
      .orderBy("created_at", "desc")
      .select("id", "title", "created_at", "view_count");
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 15. RAW SQL — sql template tag + raw()
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/analytics/posts/raw-sql", asyncHandler(async (_req, res) => {
    const q = sql`SELECT id, title, view_count, CAST(view_count AS REAL) / 10.0 AS score FROM posts WHERE view_count > 0 ORDER BY score DESC LIMIT 20`;
    const rows = await db.sql<{ id: string; title: string; view_count: number; score: number }>(q);
    res.json(rows);
  }));

  app.get("/analytics/custom", asyncHandler(async (_req, res) => {
    const rows = await db.raw(
      "SELECT status, COUNT(*) as cnt, SUM(view_count) as total FROM posts GROUP BY status"
    );
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 16. FULL-TEXT SEARCH via LIKE
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/search/posts", asyncHandler(async (req, res) => {
    const q = String(req.query.q || "");
    if (!q) { res.json([]); return; }
    const rows = await db.query(posts)
      .where(or(
        like("title", `%${q}%`),
        like("body", `%${q}%`),
        like("excerpt", `%${q}%`),
      ))
      .orderBy("view_count", "desc")
      .limit(20)
      .select("id", "title", "body", "status", "view_count");
    res.json(rows);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 17. JSON OPERATIONS — jsonExtract (Postgres JSONB uses ->>
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/users/:id/metadata", asyncHandler(async (req, res) => {
    const [row] = await db.query(users)
      .where(eq("id", String(req.params.id)))
      .jsonExtract("metadata", "$.theme", "theme")
      .jsonExtract("metadata", "$.notifications", "notifications")
      .select("id", "username") as any;
    res.json(row ?? null);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 18. CURSOR PAGINATION (Postgres — uuid ordering is lexical)
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/users/cursor/:id", asyncHandler(async (req, res) => {
    const afterId = String(req.params.id);
    const limit = Number(req.query.limit) || 10;
    const rows = await db.query(users)
      .cursor("id", afterId, "gt")
      .limit(limit)
      .select("id", "username", "email", "points");
    res.json({
      data: rows,
      next_cursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
    });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 19. BATCH — multi-query transaction
  // ═══════════════════════════════════════════════════════════════════════

  app.post("/batch", asyncHandler(async (req, res) => {
    const { queries } = req.body;
    const result = await db.transaction(async (tx) => {
      const out = [];
      for (const q of queries) {
        out.push(await tx.raw(q.sql, q.params ?? []));
      }
      return out;
    });
    res.json(result);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 20. MULTI-ROW INSERT
  // ═══════════════════════════════════════════════════════════════════════

  app.post("/posts/bulk", asyncHandler(async (req, res) => {
    const { posts: postsData } = req.body;
    if (!Array.isArray(postsData) || postsData.length === 0) {
      res.status(400).json({ error: "posts array required" });
      return;
    }
    const result = await db.query(posts).returning("id", "title").insert(postsData);
    res.status(201).json({ count: result.rows.length, posts: result.rows });
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // 21. DASHBOARD — summary with aggregates + findMany
  // ═══════════════════════════════════════════════════════════════════════

  app.get("/", asyncHandler(async (_req, res) => {
    const [userCount] = await db.query(users).count("cnt", "id").select();
    const [postCount] = await db.query(posts).count("cnt", "id").select();
    const [commentCount] = await db.query(comments).count("cnt", "id").select();
    const [totalViews] = await db.query(posts).sum("view_count", "total").select();
    const topPosts = await db.query(posts).findMany({
      with: { author: true },
      where: eq("status", "published"),
      orderBy: [{ column: "view_count", dir: "desc" }],
      limit: 5,
    });

    const uc = userCount as any;
    const pc = postCount as any;
    const cc = commentCount as any;
    const tv = totalViews as any;

    res.json({
      stats: {
        users: uc.cnt,
        posts: pc.cnt,
        comments: cc.cnt,
        total_views: tv.total ?? 0,
      },
      top_posts: topPosts.map((p: any) => ({
        id: p.id, title: p.title, views: p.view_count, author: p.author?.username,
      })),
    });
  }));

  // ── Global error handler — returns structured JSON, hides internals ───
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof MountError ? MountError.httpStatus(err.code) : 500;
    const body: Record<string, any> = {
      error: err instanceof MountError ? err.message : "Internal server error",
      code: err instanceof MountError ? err.code : "INTERNAL",
    };
    if (err instanceof MountError && err.details) body.detail = err.details;
    if (process.env.NODE_ENV !== "production" && !(err instanceof MountError)) body.raw = err.message;
    res.status(status).json(body);
  });

  // ── Start server ──────────────────────────────────────────────────────
  const port = Number(process.env.PORT) || 3741;
  app.listen(port, () => {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  MountSQLI Express Example (Postgres)              ║`);
    console.log(`║  http://localhost:${port}                              ║`);
    console.log(`║  Driver: ${String(db.driver.name).padEnd(37)}║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    const routes = [
      ["GET  /", "Dashboard (aggregates + findMany)"],
      ["", "── USERS ──"],
      ["GET  /users", "List with composable filters, pagination, sort"],
      ["GET  /users/:id", "findOne"],
      ["POST /users", "Create with RETURNING"],
      ["PUT  /users/:id", "Update with RETURNING"],
      ["DEL  /users/:id", "Delete with RETURNING"],
      ["GET  /users/cursor/:id", "Cursor-based pagination"],
      ["POST /users/ensure", "Insert ignore (ON CONFLICT DO NOTHING)"],
      ["GET  /users/:id/metadata", "JSON extract"],
      ["", "── POSTS ──"],
      ["GET  /posts", "List with nested relations (author, comments, categories)"],
      ["GET  /posts/:id", "Get post with nested author → profile"],
      ["POST /posts", "Create with RETURNING *"],
      ["POST /posts/bulk", "Multi-row insert"],
      ["PUT  /posts/:id", "Update"],
      ["DEL  /posts/:id", "Delete"],
      ["POST /posts/:id/publish", "Atomic publish (transaction)"],
      ["GET  /posts/advanced", "Composable and/or/eq filters"],
      ["GET  /posts/recent", "whereExpr (raw SQL in WHERE)"],
      ["", "── COMMENTS ──"],
      ["GET  /comments", "List comments"],
      ["POST /comments", "Create comment with RETURNING"],
      ["", "── STATS & ANALYTICS ──"],
      ["GET  /stats/posts", "Aggregates (count/sum/avg/min/max)"],
      ["GET  /stats/users/:id", "User stats"],
      ["GET  /analytics/posts/ranking", "Window: row_number + dense_rank"],
      ["GET  /analytics/posts/lag", "Window: lag + lead"],
      ["GET  /analytics/posts/by-status", "GROUP BY + count"],
      ["GET  /analytics/posts/by-author", "GROUP BY + HAVING"],
      ["GET  /analytics/posts/select-expr", "Raw SQL selectExpr"],
      ["GET  /analytics/posts/set", "UNION set operation"],
      ["GET  /analytics/posts/distinct-on", "DISTINCT ON (Postgres)"],
      ["GET  /analytics/posts/cte", "CTE (WITH)"],
      ["GET  /analytics/posts/raw-sql", "sql template tag"],
      ["GET  /analytics/custom", "raw() method"],
      ["", "── OTHER ──"],
      ["POST /categories", "Upsert with RETURNING"],
      ["POST /transfer-points", "Atomic transfer (transaction)"],
      ["POST /batch", "Batch queries in transaction"],
      ["GET  /search/posts", "LIKE search across columns"],
      ["GET  /health", "Health check"],
    ];

    const maxLen = Math.max(...routes.map(([r]) => r.length));
    for (const [route, desc] of routes) {
      if (!route) { console.log(`   ${desc}`); continue; }
      console.log(`   ${route.padEnd(maxLen)}  ${desc}`);
    }
    console.log("");
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
