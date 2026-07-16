# @mountsqli/storage

A uniform storage interface with pluggable adapters, content-addressed versioning, HMAC-signed URLs, and **RLS policies over object ACLs**.

> **Security:** `verifySignedUrl` compares the HMAC with `timingSafeEqual` (not a plain `===`), so a signed URL can't be forged byte-by-byte via a timing side-channel. Sign with `signUrl(key, { expiresInSec })` and verify the `expires`/`sig`/`method` query params in your serving layer.

## Install

```bash
pnpm add @mountsqli/storage
```

## Upload / download / sign URLs

```ts
import { Storage, MemoryStorage, contentHash } from "@mountsqli/storage";

const store = new Storage(new MemoryStorage(), "my-secret");

const obj = await store.upload("avatars/1.png", bytes, { contentType: "image/png" });
obj.version;                       // content hash (content-addressed versioning)
store.publicUrl("avatars/1.png", obj.version);   // immutable, CDN-friendly

const signed = store.signUrl("avatars/1.png", { expiresInSec: 3600 });
store.verifySignedUrl(/* key, exp, sig, method from URL */);   // used by the serving layer
```

## Content addressing & transforms

Objects are versioned by SHA-256 hash, so a byte-identical upload is deduplicated and URLs are immutable. `transform()` applies a pure `Transform` to produce a **new** versioned object.

## Adapters

`StorageAdapter` is the pluggable contract (`put` / `get` / `delete` / `list`). `MemoryStorage` ships for tests; production adapters (FileSystem, S3, R2, LibSQL-blob) implement the same interface.

## RLS over object ACLs

Objects carry an `ObjectAcl` (`owner`, `tenant`, `visibility`, `roles`). Storage reuses the **same policy engine as row-level security** from `@mountsqli/auth`:

```ts
import { allowOwner } from "@mountsqli/auth";

const policy = allowOwner("owner");
const me = { userId: "u1" };

// denied unless obj.acl.owner === "u1"
await store.downloadSecure("docs/secret", me, policy);
await store.removeSecure("docs/secret", me, policy);
(await store.listSecure("", me, policy)); // only objects you may access
```

`canAccess(obj, subject, policy)` compiles the policy against the **subject's** context (resolving `equalsContext` to the subject's claims) into `FilterNode[]`, then verifies each filter against the stored ACL (`obj.acl[column] === value`). A `deny` blocks anonymous/other subjects.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `Storage` | class | `upload/download/remove/list`, `publicUrl`, `signUrl`, `verifySignedUrl`, `canAccess`, `downloadSecure`, `removeSecure`, `listSecure`. |
| `StorageAdapter` | type | Pluggable backend contract. |
| `MemoryStorage` | class | In-memory adapter (tests). |
| `ObjectAcl`, `StoredObject`, `PutOptions` | type | Object + access-control shape. |
| `StoragePolicy` | type | `= Policy` from `@mountsqli/auth`. |
| `contentHash(data)` | fn | SHA-256 content address (first 16 hex). |
| `transform(storage, key, fn, contentType?)` | fn | Produce a new versioned object. |
| `randomKey(prefix?)` | fn | Random upload key. |
