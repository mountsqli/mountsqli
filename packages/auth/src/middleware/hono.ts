/**
 * Hono middleware adapter.
 */

import type { Auth } from '../core/auth.js';
import type { MiddlewareOptions } from '../types.js';
import { resolveAuth } from './generic.js';

export interface HonoAuthMiddlewareOptions extends MiddlewareOptions {
  onError?: (err: Error, c: any) => Response | Promise<Response>;
}

/**
 * Create Hono middleware.
 */
export function honoMiddleware(auth: Auth, options?: HonoAuthMiddlewareOptions) {
  return async (c: any, next: () => Promise<void>) => {
    try {
      const result = await resolveAuth(auth, { headers: Object.fromEntries(c.req.raw.headers.entries()) }, options);
      c.set('auth', result);
      await next();
    } catch (err) {
      if (options?.onError) {
        return options.onError(err as Error, c);
      }
      return c.json({ error: (err as Error).message }, 401);
    }
  };
}

/**
 * Create Hono route protector.
 */
export function requireAuthHono(auth: Auth, options?: HonoAuthMiddlewareOptions) {
  return async (c: any, next: () => Promise<void>) => {
    try {
      const result = await resolveAuth(auth, { headers: Object.fromEntries(c.req.raw.headers.entries()) }, {
        ...options,
        required: true,
      });
      c.set('auth', result);
      await next();
    } catch (err) {
      if (options?.onError) {
        return options.onError(err as Error, c);
      }
      return c.json({ error: (err as Error).message }, 401);
    }
  };
}
