// MountSQLI — OAuth2 providers (Google + GitHub).
//
// Usage:
//   const google = new GoogleOAuthProvider({
//     clientId: process.env.GOOGLE_CLIENT_ID!,
//     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
//     redirectUri: "http://localhost:3737/auth/google/callback",
//   });
//   // Step 1: redirect user to google.authorizeUrl()
//   // Step 2: exchange code for user info via google.exchangeCode(code)

export interface OAuthProvider {
  readonly name: string;
  /** True if the provider supports PKCE (code_challenge). */
  readonly supportsPkce?: boolean;
  /**
   * URL to redirect the user to for authorization.
   * @param state CSRF state — MUST be verified on the callback.
   * @param codeChallenge PKCE code_challenge (S256) — when provided, added to the URL.
   */
  authorizeUrl(state?: string, codeChallenge?: string): string;
  /**
   * Exchange an authorization code for user profile info.
   * @param code the `code` from the callback.
   * @param codeVerifier the original PKCE verifier (for providers that require it).
   * Returns `null` if the code is invalid.
   */
  exchangeCode(code: string, codeVerifier?: string): Promise<{ id: string; email: string; name: string; avatar?: string } | null>;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// ---- Google OAuth 2.0 ----

export class GoogleOAuthProvider implements OAuthProvider {
  readonly name = "google";
  readonly supportsPkce = true;
  private cfg: OAuthConfig;

  constructor(cfg: OAuthConfig) {
    this.cfg = cfg;
  }

  authorizeUrl(state = crypto.randomUUID(), codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<{ id: string; email: string; name: string; avatar?: string } | null> {
    try {
      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        code,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri: this.cfg.redirectUri,
        grant_type: "authorization_code",
      });
      if (codeVerifier) tokenBody.set("code_verifier", codeVerifier);
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      });
      if (!tokenRes.ok) return null;
      let tokens: any;
      try { tokens = await tokenRes.json(); } catch { return null; }
      if (!tokens.access_token) return null;

      // Fetch user profile
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!userRes.ok) return null;
      let user: any;
      try { user = await userRes.json(); } catch { return null; }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.picture,
      };
    } catch { return null; }
  }
}

// ---- GitHub OAuth 2.0 ----

export class GitHubOAuthProvider implements OAuthProvider {
  readonly name = "github";
  readonly supportsPkce = true;
  private cfg: OAuthConfig;

  constructor(cfg: OAuthConfig) {
    this.cfg = cfg;
  }

  authorizeUrl(state = crypto.randomUUID(), codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      scope: "read:user user:email",
      state,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<{ id: string; email: string; name: string; avatar?: string } | null> {
    try {
      // Exchange code for access token
      const tokenBody = new URLSearchParams({
        code,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri: this.cfg.redirectUri,
      });
      if (codeVerifier) tokenBody.set("code_verifier", codeVerifier);
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenBody,
      });
      if (!tokenRes.ok) return null;
      let tokens: any;
      try { tokens = await tokenRes.json(); } catch { return null; }
      if (!tokens.access_token) return null;

      // Fetch user profile
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "MountSQLI" },
      });
      if (!userRes.ok) return null;
      let user: any;
      try { user = await userRes.json(); } catch { return null; }
      return {
        id: String(user.id),
        email: user.email ?? "",
        name: user.name ?? user.login,
        avatar: user.avatar_url,
      };
    } catch { return null; }
  }
}
