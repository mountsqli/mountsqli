/**
 * Fastify middleware adapter.
 */

import type { Auth } from '../core/auth.js';
import type { MiddlewareOptions } from '../types.js';
import { resolveAuth } from './generic.js';

export interface FastifyAuthMiddlewareOptions extends MiddlewareOptions {
  onError?: (err: Error, request: any, reply: any) => void;
}

/**
 * Create Fastify plugin.
 */
export function fastifyPlugin(auth: Auth, options?: FastifyAuthMiddlewareOptions) {
  return async function authPlugin(fastify: any) {
    fastify.decorateRequest('auth', null);

    fastify.addHook('onRequest', async (request: any, reply: any) => {
      try {
        const result = await resolveAuth(auth, { headers: request.headers }, options);
        request.auth = result;
      } catch (err) {
        if (options?.onError) {
          return options.onError(err as Error, request, reply);
        }
        throw err;
      }
    });
  };
}

/**
 * Create Fastify route protector.
 */
export function requireAuthFastify(auth: Auth, options?: FastifyAuthMiddlewareOptions) {
  return async function (request: any, reply: any) {
    try {
      const result = await resolveAuth(auth, { headers: request.headers }, {
        ...options,
        required: true,
      });
      request.auth = result;
    } catch (err) {
      if (options?.onError) {
        return options.onError(err as Error, request, reply);
      }
      throw err;
    }
  };
}
