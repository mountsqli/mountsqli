/**
 * Express middleware adapter.
 */

import type { Auth } from '../core/auth.js';
import type { MiddlewareOptions } from '../types.js';
import { resolveAuth } from './generic.js';

export interface ExpressAuthMiddlewareOptions extends MiddlewareOptions {
  /** Custom error handler */
  onError?: (err: Error, req: any, res: any, next: any) => void;
}

/**
 * Create Express middleware.
 */
export function expressMiddleware(
  auth: Auth,
  options?: ExpressAuthMiddlewareOptions,
) {
  return async (req: any, res: any, next: any) => {
    try {
      const result = await resolveAuth(auth, { headers: req.headers }, options);
      req.auth = result;
      next();
    } catch (err) {
      if (options?.onError) {
        return options.onError(err as Error, req, res, next);
      }
      next(err);
    }
  };
}

/**
 * Create Express route protector.
 */
export function requireAuth(auth: Auth, options?: ExpressAuthMiddlewareOptions) {
  return async (req: any, res: any, next: any) => {
    try {
      const result = await resolveAuth(auth, { headers: req.headers }, {
        ...options,
        required: true,
      });
      req.auth = result;
      next();
    } catch (err) {
      if (options?.onError) {
        return options.onError(err as Error, req, res, next);
      }
      next(err);
    }
  };
}
