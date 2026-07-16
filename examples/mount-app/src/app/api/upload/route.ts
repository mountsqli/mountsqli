// MountSQLI — File upload API (storage subsystem)

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { files as filesTable } from "@/schema";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userId = formData.get("user_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided", code: "VALIDATION" }, { status: 400 });
    }

    const db = await getDb();
    const storageKey = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    // Store file reference in DB
    const result = await db.query(filesTable)
      .returning("id", "filename", "storage_key", "created_at")
      .insert({
        user_id: userId ?? "00000000-0000-0000-0000-000000000000",
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        storage_key: storageKey,
        url: `/api/files/${storageKey}`,
      });

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
