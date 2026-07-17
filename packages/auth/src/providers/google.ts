/**
 * Google OAuth provider.
 */

import type { OAuthProvider } from '../types.js';

export interface GoogleProviderConfig {
  clientId: string;
  clientSecret: string;
  scope?: string[];
}

export function google(config: GoogleProviderConfig): OAuthProvider {
  return {
    id: 'google',
    name: 'Google',
    type: 'oauth',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.scope ?? ['openid', 'email', 'profile'],
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  };
}
