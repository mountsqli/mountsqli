/**
 * MountSQLI Auth — NextAuth.js compatible type definitions.
 */

export interface User {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
}

export interface Session {
  user?: User;
  expires: string;
  sessionToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface Account {
  providerAccountId: string;
  provider: string;
  type: string;
  userId: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  session_state?: string;
  oauth_token_secret?: string;
  oauth_token?: string;
}

export interface VerificationToken {
  identifier: string;
  token: string;
  expires: Date;
}

export interface Adapter {
  createUser(user: { name?: string | null; email?: string | null; image?: string | null; emailVerified?: Date | null }): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByAccount({ providerAccountId, provider }: { providerAccountId: string; provider: string }): Promise<User | null>;
  updateUser(user: { id: string; name?: string | null; email?: string | null; image?: string | null; emailVerified?: Date | null }): Promise<User>;
  deleteUser(id: string): Promise<void>;
  linkAccount(account: Account): Promise<Account>;
  unlinkAccount({ providerAccountId, provider }: { providerAccountId: string; provider: string }): Promise<void>;
  createSession({ sessionToken, userId, expires }: { sessionToken: string; userId: string; expires: Date }): Promise<Session>;
  getSessionAndUser(sessionToken: string): Promise<{ session: Session; user: User } | null>;
  updateSession({ sessionToken, expires }: { sessionToken: string; expires: Date }): Promise<Session>;
  deleteSession(sessionToken: string): Promise<void>;
  createVerificationToken({ identifier, token, expires }: { identifier: string; token: string; expires: Date }): Promise<VerificationToken>;
  useVerificationToken({ identifier, token }: { identifier: string; token: string }): Promise<VerificationToken | null>;
}

export interface CredentialsConfig {
  id: string;
  name: string;
  type: "credentials";
  credentials: Record<string, { label: string; type: string; placeholder?: string }>;
  authorize(credentials: Record<string, string>): Promise<User | null>;
}

export interface OAuthConfig {
  id: string;
  name: string;
  type: "oauth" | "oidc";
  version: string;
  scope?: string;
  clientId: string;
  clientSecret: string;
  authorization: { url: string; params?: Record<string, string> };
  token: { url: string; params?: Record<string, string> };
  userinfo?: { url: string; params?: Record<string, string> };
  profile: (profile: any) => User;
  wellKnown?: string;
  checks?: ("state" | "pkce")[];
}

export type Provider =
  | { id: string; name: string; type: "oauth" | "oidc"; version: string; scope?: string; clientId: string; clientSecret: string; supportsPkce?: boolean; authorization: { url: string; params?: Record<string, string> }; token: { url: string; params?: Record<string, string> }; userinfo?: { url: string; params?: Record<string, string> }; profile: (profile: any) => User; wellKnown?: string; checks?: ("state" | "pkce")[]; authorizeUrl(state?: string, codeChallenge?: string): string; exchangeCode(code: string, codeVerifier?: string): Promise<{ id: string; email: string; name: string; avatar?: string } | null> }
  | { id: string; name: string; type: "credentials"; credentials: Record<string, { label: string; type: string; placeholder?: string }>; authorize(credentials: Record<string, string>): Promise<User | null> }
  | { id: string; name: string; type: "email" | "credentials"; [key: string]: any };

export type Callbacks = {
  signIn?: (params: { user: User; account: Account | null; profile?: any; email?: { verificationRequest?: boolean }; credentials?: Record<string, string> }) => Promise<string | boolean>;
  redirect?: (params: { url: string; baseUrl: string }) => Promise<string>;
  jwt?: (params: { token: any; user?: User; account?: Account; profile?: any; isNewUser?: boolean }) => Promise<any>;
  session?: (params: { session: Session; token: any; user?: User }) => Promise<Session>;
};

export interface Events {
  createUser?: (user: User) => Promise<void>;
  updateUser?: (user: User) => Promise<void>;
  deleteUser?: (user: User) => Promise<void>;
  linkAccount?: (account: Account, user: User) => Promise<void>;
  unlinkAccount?: (account: Account) => Promise<void>;
  signIn?: (params: { user: User; account: Account | null; isNewUser: boolean }) => Promise<void>;
  signOut?: (params: { token?: string }) => Promise<void>;
}

export interface JWTPayload {
  sub?: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface AuthConfig {
  providers: Provider[];
  adapter?: Adapter;
  callbacks?: Callbacks;
  events?: Events;
  pages?: {
    signIn?: string;
    signOut?: string;
    error?: string;
    verifyRequest?: string;
    newUser?: string;
  };
  session?: {
    strategy?: "jwt" | "database";
    maxAge?: number;
    updateAge?: number;
  };
  jwt: {
    secret?: string;
    maxAge?: number;
    encode?: (params: { token: any; secret: string; maxAge: number }) => Promise<string>;
    decode?: (params: { token: string; secret: string }) => Promise<any>;
  };
  cookies?: {
    sessionToken?: { name: string; options: CookieOptions };
    callbackUrl?: { name: string; options: CookieOptions };
    csrfToken?: { name: string; options: CookieOptions };
    pkceVerifier?: { name: string; options: CookieOptions };
  };
  debug?: boolean;
  logger?: { error(code: string, ...args: any[]): void; warn(code: string, ...args: any[]): void; debug(code: string, ...args: any[]): void };
  secret?: string;
  trustHost?: boolean;
  useSecureCookies?: boolean;
  /**
   * OPT-IN brute-force protection for the login path. When set, the `Auth`
   * facade tracks failed logins per key (e.g. userId or IP) and locks the key
   * out after `maxAttempts` within `windowSec`, for `lockoutSec`.
   */
  rateLimit?: { windowSec: number; maxAttempts: number; lockoutSec: number };
}

export interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  secure?: boolean;
  maxAge?: number;
  domain?: string;
}