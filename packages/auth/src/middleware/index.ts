/**
 * Middleware barrel export.
 */

export { resolveAuth } from './generic.js';
export type { AuthMiddlewareResult } from '../types.js';
export { expressMiddleware, requireAuth, type ExpressAuthMiddlewareOptions } from './express.js';
export { nextjsMiddleware, nextjsApiAuth, type NextAuthMiddlewareOptions } from './nextjs.js';
export { fastifyPlugin, requireAuthFastify, type FastifyAuthMiddlewareOptions } from './fastify.js';
export { honoMiddleware, requireAuthHono, type HonoAuthMiddlewareOptions } from './hono.js';
