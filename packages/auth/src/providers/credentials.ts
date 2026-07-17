/**
 * Credentials (email/password) provider.
 */

import type { CredentialsProvider } from '../types.js';

export interface CredentialsProviderConfig {
  /** Custom authorization function */
  authorize?: (credentials: Record<string, string>) => Promise<any | null>;
}

export function credentials(config?: CredentialsProviderConfig): CredentialsProvider {
  return {
    id: 'credentials',
    name: 'Email & Password',
    type: 'credentials',
    authorize: config?.authorize ?? (async () => null),
  };
}
