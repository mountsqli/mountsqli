import { describe, it, expect } from "vitest";
import { Hub, Channel, PresenceChannel, LiveQuery } from "@mountsqli/realtime";

describe("realtime engine", () => {
  it("broadcasts typed payloads to subscribers", () => {
    const hub = new Hub();
    const received: string[] = [];
    hub.channel<string>("chat").subscribe((m) => received.push(m));
    hub.broadcast("chat", "hi");
    hub.broadcast("chat", "there");
    expect(received).toEqual(["hi", "there"]);
  });

  it("tracks presence with conflict-free merge", () => {
    const room = new PresenceChannel();
    room.join({ id: "u1", meta: { name: "A" } });
    room.join({ id: "u2" });
    room.merge([{ id: "u1", meta: { name: "A2" } }, { id: "u3" }]);
    const ids = room.list().map((p) => p.id).sort();
    expect(ids).toEqual(["u1", "u2", "u3"]);
    expect(room.list().find((p) => p.id === "u1")?.meta?.name).toBe("A2");
    room.leave("u2");
    expect(room.list().map((p) => p.id)).not.toContain("u2");
  });

  it("live query emits init then change on invalidate", async () => {
    let state = [1, 2];
    const lq = new LiveQuery<number>(async () => state);
    const events: string[] = [];
    const stop = await lq.start();
    lq.subscribe((c) => events.push(c.type));
    expect(events).toEqual(["init"]);
    state = [1, 2, 3]; // simulate a write
    await lq.invalidate();
    expect(events).toEqual(["init", "insert"]);
    expect(lq.snapshot).toEqual([1, 2, 3]);
    stop.unsubscribe();
  });

  it("hub.live wires a query to a named channel", async () => {
    let state = ["a"];
    const lq = new LiveQuery<string>(async () => state);
    const received: string[] = [];
    const hub = new Hub();
    hub.channel<LiveChange<string>>("feed").subscribe((c) => received.push(c.type));
    const stop = await hub.live("feed", lq);
    state = ["a", "b"];
    await lq.invalidate();
    expect(received).toContain("init");
    expect(received).toContain("insert");
    stop.unsubscribe();
  });
});
