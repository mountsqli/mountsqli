import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/realtime?channel=post:xxx — SSE stream
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channelName = searchParams.get("channel") || "global";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const db = await getDb();
      if (!db.realtime) {
        controller.enqueue(encoder.encode(`event: error\ndata: {"error":"realtime unavailable"}\n\n`));
        controller.close();
        return;
      }
      const channel = db.realtime.channel(channelName);

      const unsubscribe = channel.subscribe((payload: any) => {
        const data = JSON.stringify({ channel: channelName, payload });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      req.signal.addEventListener("abort", () => {
        unsubscribe.unsubscribe();
        clearInterval(keepAlive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// POST /api/realtime — publish to a channel
export async function POST(req: NextRequest) {
  try {
    const { channel: channelName, payload } = await req.json();
    const db = await getDb();
    if (!db.realtime) {
      return NextResponse.json({ error: "Realtime subsystem unavailable", code: "UNAVAILABLE" }, { status: 503 });
    }
    const channel = db.realtime.channel(channelName ?? "global");
    channel.publish(payload);
    return NextResponse.json({ published: true, channel: channelName });
  } catch (err) { return apiError(err); }
}
