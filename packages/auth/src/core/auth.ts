/**
 * MountSQLI Auth — NextAuth.js compatible core.
 * Handles JWT/database sessions, provider flows, callbacks, events.
 */

import { MountError } from "@mountsqli/driver";
import { signJwt, verifyJwt, hashPassword as scryptHash, verifyPassword as scryptVerify } from "../crypto.js";
import { MemoryRateLimiter, type RateLimiter } from "../rate-limit.js";
import { generateState, generateCodeVerifier, generateCodeChallenge } from "../providers/index.js";
import { createPgAdapter } from "../adapters/pg.js";
import type {
  AuthConfig,
  Provider,
  User,
  Session,
  Account,
  Adapter,
  Callbacks,
  Events,
  CookieOptions,
} from "../types/index.js";

export class MountAuth {
  private config: AuthConfig;
  private adapter?: Adapter;
  private cookieName: string;
  private cookieOpts: CookieOptions;
  private jwtMaxAge: number;
  private jwtSecret: string;
  private rateLimiter?: RateLimiter;

  constructor(config: AuthConfig) {
    this.config = config;
    if (config.adapter) {
      this.adapter = config.adapter;
    }
    const cookies = {
      sessionToken: { name: "mountsqli.session-token", options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true } },
      callbackUrl: { name: "mountsqli.callback-url", options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true } },
      csrfToken: { name: "mountsqli.csrf-token", options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true } },
      pkceVerifier: { name: "mountsqli.pkce-verifier", options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true } },
      ...config.cookies,
    };
    this.config.cookies = cookies;
    this.cookieName = cookies.sessionToken.name;
    this.cookieOpts = { ...cookies.sessionToken.options, maxAge: config.jwt.maxAge ?? 30 * 24 * 60 * 60 };
    this.jwtMaxAge = config.jwt.maxAge ?? 30 * 24 * 60 * 60;
    this.jwtSecret = config.jwt.secret ?? config.secret ?? "";
    if (config.rateLimit) this.rateLimiter = new MemoryRateLimiter(config.rateLimit);
  }

  // JWT encoding/decoding
  private async encodeToken(token: Record<string, unknown>): Promise<string> {
    const { encode } = this.config.jwt;
    if (encode) return encode({ token, secret: this.jwtSecret, maxAge: this.jwtMaxAge });
    const { signJwt } = await import("../crypto.js");
    return signJwt(token, { key: this.jwtSecret, expiresInSec: this.jwtMaxAge });
  }

  private async decodeToken(token: string): Promise<Record<string, unknown> | null> {
    const { decode } = this.config.jwt;
    if (decode) return decode({ token, secret: this.jwtSecret });
    const { verifyJwt } = await import("../crypto.js");
    const result = verifyJwt(token, { key: this.jwtSecret });
    return result.ok ? (result.payload ?? null) : null;
  }

  // Cookie helpers
  private setCookie(res: Response, name: string, value: string, options: CookieOptions): void {
    const parts = [
      `${name}=${value}`,
      `Path=${options.path ?? "/"}`,
      `HttpOnly`,
      options.secure ? `Secure` : "",
      `SameSite=${options.sameSite ?? "lax"}`,
      options.maxAge != null ? `Max-Age=${options.maxAge}` : "",
      options.domain ? `Domain=${options.domain}` : "",
    ].filter(Boolean);
    res.headers.append("Set-Cookie", parts.join("; "));
  }

  private clearCookie(res: Response, name: string, options: CookieOptions): void {
    this.setCookie(res, name, "", { ...options, maxAge: 0 });
  }

  // Session handling
  async getSession(requestHeaders: Headers): Promise<Session | null> {
    const cookieHeader = requestHeaders.get("cookie") || "";
    const cookies = this.parseCookies(cookieHeader);
    const sessionCookie = cookies.get(this.cookieName);
    if (!sessionCookie) return null;

    const token = await this.decodeToken(sessionCookie);
    if (!token) return null;

    const exp = typeof token.exp === "number" ? token.exp : 0;
    if (exp && Date.now() >= exp * 1000) {
      return null;
    }

    const fromToken: User = {
      id: typeof token.sub === "string" ? token.sub : "",
      name: typeof token.name === "string" ? token.name : null,
      email: typeof token.email === "string" ? token.email : null,
      image: typeof token.picture === "string" ? token.picture : null,
    };
    const user = (token.user as User | undefined) ?? fromToken;
    return {
      user,
      expires: new Date(exp * 1000).toISOString(),
    };
  }

  async signIn(credentials: Record<string, string>): Promise<{ user: User; token: string } | null> {
    const credentialsProvider = this.config.providers.find(
      (p): p is Extract<Provider, { type: "credentials" }> => p.type === "credentials",
    );
    if (!credentialsProvider) throw new MountError("CONFIG", "MountSQLI: no credentials provider configured — add a CredentialsProvider to your MountAuth providers.");

    // OPT-IN brute-force guard (AuthConfig.rateLimit). Key by the credential
    // identifier so each account is rate-limited independently.
    if (this.rateLimiter) {
      const key = String(credentials.id ?? credentials.email ?? credentials.username ?? "unknown");
      if (this.rateLimiter.isLocked(key)) return null;
      const user = await credentialsProvider.authorize(credentials);
      if (!user) {
        this.rateLimiter.recordFailure(key);
        return null;
      }
      this.rateLimiter.reset(key);
      const token = await this.createToken({ user, isNewUser: false });
      return { user, token };
    }

    const user = await credentialsProvider.authorize(credentials);
    if (!user) return null;

    const token = await this.createToken({ user, isNewUser: false });
    return { user, token };
  }

  async signOut(): Promise<void> {
    // Client should clear cookie; server can't delete HttpOnly cookie
  }

  /** Set the session cookie on a Response (used by Next.js route handlers). */
  setSessionCookie(res: Response, token: string): void {
    this.setCookie(res, this.cookieName, token, this.cookieOpts);
  }

  /** Clear the session cookie on a Response (logout). */
  clearSessionCookie(res: Response): void {
    this.clearCookie(res, this.cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }

  private async createToken(params: { user: User; account?: Account; profile?: any; isNewUser?: boolean }): Promise<string> {
    const token: Record<string, unknown> = {
      sub: params.user.id,
      name: params.user.name,
      email: params.user.email,
      picture: params.user.image,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.jwtMaxAge,
    };

    const jwtCallback = this.config.callbacks?.jwt;
    if (jwtCallback) {
      const result = await jwtCallback({ token, user: params.user, account: params.account, profile: params.profile, isNewUser: params.isNewUser });
      if (result) Object.assign(token, result);
    }

    return this.encodeToken(token);
  }

  // Callback runners
  async runSignInCallback(params: { user: User; account: Account | null; profile?: any; email?: { verificationRequest?: boolean }; credentials?: Record<string, string> }): Promise<string | boolean> {
    const signIn = this.config.callbacks?.signIn;
    if (signIn) return signIn(params);
    return true;
  }

  async runRedirectCallback(params: { url: string; baseUrl: string }): Promise<string> {
    const redirect = this.config.callbacks?.redirect;
    if (redirect) return redirect(params);
    return params.url;
  }

  // Event emitters
  async emitCreateUser(user: User) {
    if (this.config.events?.createUser) await this.config.events.createUser(user);
  }

  async emitSignIn(user: User, account: Account | null, isNewUser: boolean) {
    if (this.config.events?.signIn) await this.config.events.signIn({ user, account, isNewUser });
  }

  // Provider utilities
  getProvider(id: string): Provider | undefined {
    return this.config.providers.find((p) => p.id === id);
  }

  getProviders(): Provider[] {
    return this.config.providers;
  }

  /**
   * Begin an OAuth 2.0 authorization-code flow. Generates a CSRF `state`
   * and (for PKCE-capable providers) a `code_verifier`, stores BOTH in
   * HttpOnly cookies, and returns the provider's authorization URL. The
   * cookies MUST be present (and verified) when `handleCallback` runs — this
   * is what prevents login-CSRF / authorization-code injection.
   */
  async getAuthorizationUrl(providerId: string, res: Response): Promise<string> {
    const provider = this.getProvider(providerId);
    if (!provider || (provider.type !== "oauth" && provider.type !== "oidc")) {
      throw new MountError("CONFIG", `MountSQLI: unknown OAuth provider "${providerId}"`);
    }
    const state = generateState();
    this.setCookie(res, this.config.cookies!.csrfToken!.name, state, this.cookieOpts);
    let codeChallenge: string | undefined;
    if (provider.supportsPkce) {
      const verifier = generateCodeVerifier();
      this.setCookie(res, this.config.cookies!.pkceVerifier!.name, verifier, this.cookieOpts);
      codeChallenge = await generateCodeChallenge(verifier);
    }
    return provider.authorizeUrl(state, codeChallenge);
  }

  /**
   * Complete the OAuth flow. Verifies the callback `state` matches the
   * `csrfToken` cookie (CSRF protection) and, for PKCE providers, that
   * the `code_verifier` cookie is supplied to `exchangeCode`. On success
   * returns `{ user, token }`; on any mismatch returns `null` and clears
   * the flow cookies.
   */
  async handleCallback(
    providerId: string,
    code: string,
    state: string | null,
    reqHeaders: Headers,
    res: Response,
  ): Promise<{ user: User; token: string } | null> {
    const provider = this.getProvider(providerId);
    if (!provider || (provider.type !== "oauth" && provider.type !== "oidc")) return null;

    // CSRF: the callback state must match the cookie we set at redirect.
    const cookies = this.parseCookies(reqHeaders.get("cookie") || "");
    const expectedState = cookies.get(this.config.cookies!.csrfToken!.name);
    if (!state || !expectedState || state !== expectedState) {
      this.clearCookie(res, this.config.cookies!.csrfToken!.name, this.cookieOpts);
      return null;
    }

    // PKCE: pass the stored verifier to the token exchange.
    const verifier = provider.supportsPkce
      ? cookies.get(this.config.cookies!.pkceVerifier!.name)
      : undefined;

    try {
      const profile = await provider.exchangeCode(code, verifier);
      if (!profile) return null;
      const user: User = {
        id: String(profile.id),
        name: profile.name,
        email: profile.email,
        image: profile.avatar ?? null,
      };
      const token = await this.createToken({ user, isNewUser: false });
      // Consume the flow cookies.
      this.clearCookie(res, this.config.cookies!.csrfToken!.name, this.cookieOpts);
      if (provider.supportsPkce) {
        this.clearCookie(res, this.config.cookies!.pkceVerifier!.name, this.cookieOpts);
      }
      return { user, token };
    } catch {
      return null;
    }
  }

  // Adapter access
  getAdapter(): Adapter | undefined {
    return this.adapter;
  }

  // Parse cookies
  private parseCookies(cookieHeader: string): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const cookie of cookieHeader.split(";")) {
      const [name, ...rest] = cookie.trim().split("=");
      if (name && rest.length) cookies.set(name, rest.join("="));
    }
    return cookies;
  }

  // Password helpers (scrypt, constant-time verify)
  hashPassword(password: string): string {
    return scryptHash(password);
  }

  verifyPassword(password: string, stored: string): boolean {
    return scryptVerify(password, stored);
  }
}

// Factory for creating auth instance
export function createAuth(config: AuthConfig): MountAuth {
  return new MountAuth(config);
}

// Export types
export type { AuthConfig, Provider, User, Session, Account, Adapter, Callbacks, Events, User as AdapterUser } from "../types/index.js";
export { createPgAdapter } from "../adapters/pg.js";