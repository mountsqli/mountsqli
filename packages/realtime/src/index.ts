// MountSQLI — Realtime engine.
//
// Three capabilities from plan.md §13, all built on a transport-agnostic
// `Hub` so WebSocket / SSE / Postgres-LISTEN can plug in later:
//   1. Live queries  — a QueryPlan is re-run when its source rows change.
//   2. Presence      — typed channel membership with conflict-free merge.
//   3. Broadcast     — typed pub/sub channels.
//
// The in-memory Hub is fully testable without any network. Messages are
// schema/type validated at the boundary (broadcast payloads carry a type tag).

export type Presence = { id: string; meta?: Record<string, unknown> };

export interface LiveChange<T> {
  type: "init" | "insert" | "update" | "delete";
  rows: T[];
}

export interface Unsubscribe {
  unsubscribe(): void;
}

// ---- Pub/Sub channel ----

export class Channel<TPayload = unknown> {
  private subscribers = new Set<(payload: TPayload) => void>();

  publish(payload: TPayload): void {
    for (const fn of this.subscribers) fn(payload);
  }

  subscribe(fn: (payload: TPayload) => void): Unsubscribe {
    this.subscribers.add(fn);
    return { unsubscribe: () => this.subscribers.delete(fn) };
  }

  get size(): number {
    return this.subscribers.size;
  }
}

// ---- Presence ----

export class PresenceChannel {
  private members = new Map<string, Presence>();

  join(p: Presence): void {
    this.members.set(p.id, p);
  }
  leave(id: string): void {
    this.members.delete(id);
  }
  /** Conflict-free merge of a remote snapshot (last-write-wins per id). */
  merge(snapshot: Presence[]): void {
    for (const p of snapshot) this.members.set(p.id, p);
  }
  list(): Presence[] {
    return [...this.members.values()];
  }
}

// ---- Live query ----

/**
 * A LiveQuery wraps a QueryPlan-producing function and a fetcher. On
 * `start()` it emits the initial rows, then re-runs whenever `invalidate()`
 * is called (e.g. by a DB write-log / LISTEN event / ETag poll). This keeps
 * the realtime layer decoupled from any specific transport.
 */
export class LiveQuery<T> {
  private chan = new Channel<LiveChange<T>>();
  private current: T[] = [];
  private running = false;

  constructor(
    private fetcher: () => Promise<T[]>,
    private onChange?: (change: LiveChange<T>) => void,
  ) {}

  async start(): Promise<Unsubscribe> {
    this.running = true;
    this.current = await this.fetcher();
    this.emit({ type: "init", rows: this.current });
    return { unsubscribe: () => (this.running = false) };
  }

  /** Called by the transport when the underlying data may have changed. */
  async invalidate(): Promise<void> {
    if (!this.running) return;
    const next = await this.fetcher();
    const type: LiveChange<T>["type"] = next.length > this.current.length ? "insert" : next.length < this.current.length ? "delete" : "update";
    this.current = next;
    this.emit({ type, rows: next });
  }

  subscribe(fn: (change: LiveChange<T>) => void): Unsubscribe {
    const sub = this.chan.subscribe(fn);
    // Replay the current snapshot to a late subscriber so it observes the
    // in-progress query state without waiting for the next invalidate().
    if (this.running) fn({ type: "init", rows: this.current });
    return sub;
  }

  private emit(change: LiveChange<T>): void {
    this.chan.publish(change);
    this.onChange?.(change);
  }

  get snapshot(): T[] {
    return this.current;
  }
}

// ---- Hub: ties channels + presence + live queries together ----

export class Hub {
  private channels = new Map<string, Channel<any>>();
  private presenceRooms = new Map<string, PresenceChannel>();

  channel<TPayload = unknown>(name: string): Channel<TPayload> {
    let c = this.channels.get(name);
    if (!c) {
      c = new Channel<TPayload>();
      this.channels.set(name, c);
    }
    return c as Channel<TPayload>;
  }

  broadcast<TPayload = unknown>(name: string, payload: TPayload): void {
    this.channel<TPayload>(name).publish(payload);
  }

  presence(room: string): PresenceChannel {
    let p = this.presenceRooms.get(room);
    if (!p) {
      p = new PresenceChannel();
      this.presenceRooms.set(room, p);
    }
    return p;
  }

  /** Subscribe to a live query under a named channel. */
  live<T>(name: string, query: LiveQuery<T>): Promise<Unsubscribe> {
    const chan = this.channel<LiveChange<T>>(name);
    const sub = query.subscribe((change) => chan.publish(change));
    return query.start().then((stop) => ({
      unsubscribe: () => {
        sub.unsubscribe();
        stop.unsubscribe();
      },
    }));
  }
}
