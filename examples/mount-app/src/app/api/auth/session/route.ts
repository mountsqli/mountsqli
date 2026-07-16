import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("session")?.value ?? req.headers.get("authorization")?.slice(7);
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      display_name: payload.display_name,
    },
  });
}
