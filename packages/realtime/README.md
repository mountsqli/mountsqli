# @mountsqli/realtime

Realtime engine: live queries, presence, and broadcast channels.

## Install

```bash
pnpm add @mountsqli/realtime
```

## Hub & channels

```ts
import { Hub, Channel } from "@mountsqli/realtime";

const hub = new Hub();
const ch = hub.channel("room:42");

ch.on((msg) => console.log("recv", msg));
ch.publish({ type: "ping", from: "u1" });   // broadcast to subscribers
```

## Presence

`PresenceChannel` tracks who is in a channel:

```ts
import { PresenceChannel } from "@mountsqli/realtime";

const pc = new PresenceChannel(hub, "room:42");
pc.join("u1", { name: "Ada" });
pc.list(); // [{ id: "u1", meta: { name: "Ada" } }]
```

## Live queries

`LiveQuery` re-runs a query when its underlying data changes and pushes diffs:

```ts
import { LiveQuery } from "@mountsqli/realtime";

const live = new LiveQuery(() => db.query(users).where("active", "=", true).select());
live.subscribe((rows) => render(rows));
// live.notify() re-runs + diffs on mutation
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `Hub` | class | Registry of channels; `channel(name)`, `presence(name)`. |
| `Channel<TPayload>` | class | `on`, `publish`, `unsubscribe`. |
| `PresenceChannel` | class | `join`, `leave`, `list` of present members. |
| `LiveQuery<T>` | class | `subscribe`, `notify`, diff-based updates. |
| `Presence`, `LiveChange<T>`, `Unsubscribe` | type | Supporting types. |
