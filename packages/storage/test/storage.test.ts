import { describe, it, expect } from "vitest";
import { Storage, MemoryStorage, contentHash, transform } from "@mountsqli/storage";
import { allowOwner } from "@mountsqli/auth";

const enc = (s: string) => new TextEncoder().encode(s);

describe("storage engine", () => {
  it("uploads, downloads, and content-addresses by hash", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    const obj = await store.upload("avatars/1.png", enc("hello"), { contentType: "image/png" });
    expect(obj.version).toBe(contentHash(enc("hello")));
    const got = await store.download("avatars/1.png");
    expect(got?.data).toEqual(enc("hello"));
    expect(got?.contentType).toBe("image/png");
  });

  it("produces immutable public URLs per version", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    const obj = await store.upload("a", enc("x"));
    expect(store.publicUrl("a", obj.version)).toContain(obj.version);
  });

  it("signs URLs that verify and expire", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    const url = store.signUrl("private/1", { expiresInSec: 60 });
    const u = new URL(url);
    const exp = Number(u.searchParams.get("expires"));
    const sig = u.searchParams.get("sig")!;
    expect(store.verifySignedUrl("private/1", exp, sig, "GET")).toBe(true);
    expect(store.verifySignedUrl("private/1", exp - 1000, sig, "GET")).toBe(false); // expired
    expect(store.verifySignedUrl("other", exp, sig, "GET")).toBe(false); // wrong key
    // Tampered signature must be rejected (timing-safe compare).
    const tampered = sig.slice(0, -1) + (sig.slice(-1) === "a" ? "b" : "a");
    expect(store.verifySignedUrl("private/1", exp, tampered, "GET")).toBe(false);
  });

  it("applies a transform to a new versioned object", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    await store.upload("pic.png", enc("rawbytes"));
    const out = await transform(store, "pic.png", (d) => d, "image/webp");
    expect(out.contentType).toBe("image/webp");
    expect(out.metadata.source).toBe("pic.png");
  });

  it("lists by prefix", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    await store.upload("docs/a", enc("1"));
    await store.upload("docs/b", enc("2"));
    await store.upload("img/c", enc("3"));
    expect((await store.list("docs/")).sort()).toEqual(["docs/a", "docs/b"]);
  });
});

describe("storage RLS (policy over object ACL)", () => {
  // Policy: a subject may access an object whose `owner` ACL equals their userId.
  const policy = allowOwner("owner");

  it("grants the owner and denies others / anonymous", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    await store.upload("docs/secret", enc("vault"), { acl: { owner: "u1" } });

    const owner = await store.downloadSecure("docs/secret", { userId: "u1" }, policy);
    expect(owner?.data).toEqual(enc("vault"));

    const other = await store.downloadSecure("docs/secret", { userId: "u2" }, policy);
    expect(other).toBeNull();

    const anon = await store.downloadSecure("docs/secret", {}, policy);
    expect(anon).toBeNull();
  });

  it("removes only when the subject passes the policy", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    await store.upload("docs/x", enc("1"), { acl: { owner: "u1" } });

    expect(await store.removeSecure("docs/x", { userId: "u2" }, policy)).toBe(false);
    expect(await store.removeSecure("docs/x", { userId: "u1" }, policy)).toBe(true);
  });

  it("lists only objects the subject may access", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    await store.upload("a", enc("1"), { acl: { owner: "u1" } });
    await store.upload("b", enc("2"), { acl: { owner: "u2" } });

    expect((await store.listSecure("", { userId: "u1" }, policy)).sort()).toEqual(["a"]);
    expect((await store.listSecure("", {}, policy))).toEqual([]); // anonymous sees nothing
  });

  it("open access when no policy is supplied", async () => {
    const store = new Storage(new MemoryStorage(), "secret");
    await store.upload("open/1", enc("hi"), { acl: { owner: "u1" } });
    expect((await store.downloadSecure("open/1", {}, undefined))?.data).toEqual(enc("hi"));
  });
});
