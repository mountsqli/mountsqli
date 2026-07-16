// MountSQLI — Users API (CRUD + pagination + filters)

import { NextRequest, NextResponse } from "next/server";
import { getDb, eq, gte, lte, like, and, inArray, isNull } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { users } from "@/schema";

export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(req.url);

    const filters: any[] = [];
    if (searchParams.get("role")) filters.push(eq("role", searchParams.get("role")!));
    if (searchParams.get("active")) filters.push(eq("active", searchParams.get("active") === "true"));
    if (searchParams.get("min_points")) filters.push(gte("points", Number(searchParams.get("min_points"))));
    if (searchParams.get("username_like")) filters.push(like("username", `%${searchParams.get("username_like")}%`));
    if (searchParams.get("email_in")) filters.push(inArray("email", String(searchParams.get("email_in")).split(",")));
    if (searchParams.get("no_bio")) filters.push(isNull("bio"));

    let q = db.query(users);
    if (filters.length > 0) q = q.where(filters.length === 1 ? filters[0]! : and(...filters));

    const page = Number(searchParams.get("page")) || 1;
    const limit = Number(searchParams.get("limit")) || 10;
    q = q.paginate(page, limit);

    const sort = searchParams.get("sort") || "created_at";
    const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";
    q = q.orderBy(sort as any, dir);

    const rows = await q.select("id", "username", "email", "display_name", "role", "points", "active", "created_at");
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    const result = await db.query(users)
      .returning("id", "username", "email", "created_at")
      .insert({
        username: body.username ?? `user_${Date.now()}`,
        email: body.email ?? `${Date.now()}@test.com`,
        display_name: body.display_name ?? body.username ?? "New User",
        role: body.role ?? "user",
      });

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
