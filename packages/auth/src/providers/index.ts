/**
 * OAuth providers for MountSQLI Auth — NextAuth.js compatible.
 */

import type { OAuthConfig, CredentialsConfig, Provider } from "../types/index.js";

// Built-in providers
export function GoogleProvider(config: { clientId: string; clientSecret: string; authorization?: { params?: Record<string, string> } }) {
  return {
    id: "google",
    name: "Google",
    type: "oauth",
    version: "2.0",
    scope: "openid email profile",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: {
      url: "https://accounts.google.com/o/oauth2/v2/auth",
      params: { scope: "openid email profile", access_type: "offline", prompt: "consent", ...config.authorization?.params },
    },
    token: { url: "https://oauth2.googleapis.com/token" },
    userinfo: { url: "https://www.googleapis.com/oauth2/v3/userinfo" },
    profile(profile: any) {
      return {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
        emailVerified: profile.email_verified,
      };
    },
  };
}

export function GitHubProvider(config: { clientId: string; clientSecret: string }) {
  return {
    id: "github",
    name: "GitHub",
    type: "oauth",
    version: "2.0",
    scope: "read:user user:email",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { url: "https://github.com/login/oauth/authorize" },
    token: { url: "https://github.com/login/oauth/access_token" },
    userinfo: { url: "https://api.github.com/user" },
    profile(profile: any) {
      return {
        id: profile.id.toString(),
        name: profile.name ?? profile.login,
        email: profile.email,
        image: profile.avatar_url,
      };
    },
  };
}

export function DiscordProvider(config: { clientId: string; clientSecret: string }) {
  return {
    id: "discord",
    name: "Discord",
    type: "oauth",
    version: "2.0",
    scope: "identify email",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { url: "https://discord.com/api/oauth2/authorize", params: { scope: "identify email" } },
    token: { url: "https://discord.com/api/oauth2/token" },
    userinfo: { url: "https://discord.com/api/users/@me" },
    profile(profile: any) {
      return {
        id: profile.id,
        name: profile.global_name ?? profile.username,
        email: profile.email,
        image: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
      };
    },
  };
}

export function TwitterProvider(config: { clientId: string; clientSecret: string }) {
  return {
    id: "twitter",
    name: "Twitter",
    type: "oauth",
    version: "2.0",
    scope: "tweet.read users.read",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { url: "https://twitter.com/i/oauth2/authorize", params: { scope: "tweet.read users.read" } },
    token: { url: "https://api.twitter.com/2/oauth2/token" },
    userinfo: { url: "https://api.twitter.com/2/users/me", params: { "user.fields": "profile_image_url,description" } },
    profile(profile: any) {
      return {
        id: profile.data.id,
        name: profile.data.name,
        email: null,
        image: profile.data.profile_image_url,
      };
    },
  };
}

export function CredentialsProvider(config: { name: string; credentials: Record<string, { label: string; type: string }>; authorize: (creds: Record<string, string>) => Promise<any> }) {
  return {
    id: "credentials",
    name: config.name,
    type: "credentials",
    credentials: config.credentials,
    authorize: config.authorize,
  };
}

// PKCE helpers
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return arrayBufferToBase64URL(hash);
}

function arrayBufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// State management
export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}