/**
 * GitHub OAuth provider.
 */

import type { OAuthProvider } from '../types.js';

export interface GitHubProviderConfig {
  clientId: string;
  clientSecret: string;
  scope?: string[];
}

export function github(config: GitHubProviderConfig): OAuthProvider {
  return {
    id: 'github',
    name: 'GitHub',
    type: 'oauth',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.scope ?? ['read:user', 'user:email'],
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
  };
}
