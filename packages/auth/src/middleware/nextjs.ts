/**
 * Next.js middleware adapter.
 */

import type { Auth } from '../core/auth.js';
import type { MiddlewareOptions } from '../types.js';
import { resolveAuth } from './generic.js';

export interface NextAuthMiddlewareOptions extends MiddlewareOptions {
  /** Pages to redirect to */
  pages?: {
    signIn?: string;
    signUp?: string;
  };
  /** Authorized callbacks */
  authorized?: (auth: { user: any } | null, request: any) => boolean | Promise<boolean>;
}

/**
 * Create Next.js middleware.
 * Returns a redirect object or null (continue to next middleware).
 */
export function nextjsMiddleware(auth: Auth, options?: NextAuthMiddlewareOptions) {
  return async (request: any): Promise<{ redirect: string } | null> => {
    const result = await resolveAuth(auth, { headers: request.headers });

    // Custom authorization check
    if (options?.authorized) {
      const isAuthorized = await options.authorized(result.session, request);
      if (!isAuthorized) {
        return { redirect: options.pages?.signIn ?? '/auth/signin' };
      }
    }

    // If required and no session
    if (options?.required && !result.session) {
      return { redirect: options.pages?.signIn ?? '/auth/signin' };
    }

    return null; // Continue to next middleware
  };
}

/**
 * Create Next.js API route helper.
 */
export function nextjsApiAuth(auth: Auth) {
  return async (request: any) => {
    return resolveAuth(auth, { headers: Object.fromEntries(request.headers.entries()) });
  };
}
