/**
 * End-to-end integration test for Auth with real node:sqlite.
 */
import { describe, it, expect, beforeAll } from "vitest";
import "@mountsqli/driver-sqlite"; // registers "sqlite" driver
import { mountsqli } from "@mountsqli/core";
import { createAuth, Auth } from "../src/index.js";
import {
  authUsers,
  authSessions,
  authAccounts,
  authVerificationTokens,
  authRoles,
  authUserRoles,
} from "../src/index.js";

describe("Auth E2E with SQLite", () => {
  let auth: Auth;

  beforeAll(async () => {
    const db = await mountsqli({
      driver: "sqlite",
      url: ":memory:",
      tables: [authUsers, authSessions, authAccounts, authVerificationTokens, authRoles, authUserRoles],
    });

    auth = createAuth({
      db: db as any,
      secret: "test-secret-for-jwt",
      session: { strategy: "jwt", maxAge: 3600 },
      providers: [],
    });
  });

  it("registers a new user", async () => {
    const result = await auth.register({
      email: "test@example.com",
      password: "StrongP4ss!",
      name: "Test User",
    });
    expect(result.user.email).toBe("test@example.com");
    expect(result.token).toBeTruthy();
  });

  it("rejects duplicate email", async () => {
    await expect(
      auth.register({ email: "test@example.com", password: "StrongP4ss!" }),
    ).rejects.toThrow();
  });

  it("validates session from registered user", async () => {
    // register to get a token
    const user = await auth.register({
      email: "session-test@example.com",
      password: "StrongP4ss!",
    });

    const session = await auth.getSession({
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(session).not.toBeNull();
    expect(session!.user.email).toBe("session-test@example.com");
  });
});
