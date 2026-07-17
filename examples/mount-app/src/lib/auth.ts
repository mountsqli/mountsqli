// MountSQLI — JWT auth library.
// Stateless: user data encoded in the JWT payload, no DB lookup on verify.
// Uses createToken/verifyToken from @mountsqli/auth (jose-based, async).

import { createToken, verifyToken as authVerifyToken } from "@mountsqli/auth";

const JWT_KEY = process.env.JWT_SECRET ?? "dev-secret";

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  display_name: string;
}

export interface AuthPayload {
  sub: string;
  username: string;
  role: string;
  display_name: string;
  iat: number;
  exp: number;
}

/** Sign a JWT for the given user. Returns the token string. */
export async function signToken(user: AuthUser): Promise<string> {
  return createToken(
    { sub: user.id, username: user.username, role: user.role, display_name: user.display_name } as any,
    JWT_KEY,
    { maxAge: 3600 },
  );
}

/** Verify a JWT and return the decoded payload, or null if invalid/expired. */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  const payload = await authVerifyToken(token, JWT_KEY);
  return payload as AuthPayload | null;
}

/** Extract user from a cookie header (raw Cookie string). */
export async function userFromCookies(cookieHeader: string | null): Promise<AuthUser | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;
  const payload = await verifyToken(match[1]!);
  if (!payload) return null;
  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    display_name: payload.display_name,
  };
}

/** Create a Response with a session cookie set (login). */
export function withSessionCookie(body: unknown, token: string): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600`,
    },
  });
}

/** Create a Response with the session cookie cleared (logout). */
export function clearSessionCookie(body: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    },
  });
}
