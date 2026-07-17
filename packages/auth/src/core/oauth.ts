/**
 * OAuth flow handlers.
 */

import type { OAuthCallbackParams, OAuthTokenResponse, OAuthUserInfo, OAuthProvider } from '../types.js';

/**
 * Get the authorization URL for an OAuth provider.
 */
export function getAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
): string {
  const scope = provider.scope?.join(' ') ?? 'openid email profile';
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: `${getBaseUrl()}/auth/callback/${provider.id}`,
    response_type: 'code',
    scope,
    state,
  });

  const authUrl = provider.authorizationUrl ?? getDefaultAuthorizationUrl(provider.id);
  return `${authUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
): Promise<OAuthTokenResponse> {
  const tokenUrl = provider.tokenUrl ?? getDefaultTokenUrl(provider.id);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${getBaseUrl()}/auth/callback/${provider.id}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.statusText}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

/**
 * Get user info from an OAuth provider.
 */
export async function getUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthUserInfo> {
  const userInfoUrl = provider.userInfoUrl ?? getDefaultUserInfoUrl(provider.id);

  const response = await fetch(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`OAuth user info fetch failed: ${response.statusText}`);
  }

  const data = await response.json() as Record<string, any>;

  // Normalize user info across providers
  return normalizeUserInfo(provider.id, data);
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Provider-specific defaults
// ---------------------------------------------------------------------------

function getDefaultAuthorizationUrl(providerId: string): string {
  const urls: Record<string, string> = {
    google: 'https://accounts.google.com/o/oauth2/v2/auth',
    github: 'https://github.com/login/oauth/authorize',
  };
  return urls[providerId] ?? '';
}

function getDefaultTokenUrl(providerId: string): string {
  const urls: Record<string, string> = {
    google: 'https://oauth2.googleapis.com/token',
    github: 'https://github.com/login/oauth/access_token',
  };
  return urls[providerId] ?? '';
}

function getDefaultUserInfoUrl(providerId: string): string {
  const urls: Record<string, string> = {
    google: 'https://www.googleapis.com/oauth2/v2/userinfo',
    github: 'https://api.github.com/user',
  };
  return urls[providerId] ?? '';
}

function normalizeUserInfo(providerId: string, data: Record<string, any>): OAuthUserInfo {
  switch (providerId) {
    case 'google':
      return {
        id: data.id ?? data.sub,
        email: data.email,
        name: data.name ?? data.given_name,
        image: data.picture,
        emailVerified: data.verified_email ?? false,
      };
    case 'github':
      // GitHub primary email is always verified
      return {
        id: String(data.id),
        email: data.email,
        name: data.name ?? data.login,
        image: data.avatar_url,
        emailVerified: true,
      };
    default:
      return {
        id: String(data.id ?? data.sub),
        email: data.email,
        name: data.name,
        image: data.image ?? data.picture ?? data.avatar_url,
        emailVerified: data.email_verified ?? false,
      };
  }
}

function getBaseUrl(): string {
  return process.env.AUTH_BASE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}
