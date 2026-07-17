/**
 * Framework-agnostic auth middleware helper.
 */

import type { Auth } from '../core/auth.js';
import type { MiddlewareOptions, AuthMiddlewareResult } from '../types.js';
import { UnauthorizedError, ForbiddenError } from '../errors.js';

/**
 * Resolve auth session from a request-like object.
 */
export async function resolveAuth(
  auth: Auth,
  request: { headers?: Record<string, string | undefined> },
  options?: MiddlewareOptions,
): Promise<AuthMiddlewareResult> {
  const session = await auth.getSession(request);

  if (options?.required && !session) {
    throw new UnauthorizedError('Authentication required');
  }

  if (options?.requiredRole && session) {
    const hasRole = await auth.rbac.hasRole(session.user.id, options.requiredRole);
    if (!hasRole) {
      throw new ForbiddenError(`Role "${options.requiredRole}" required`);
    }
  }

  if (options?.requiredPermission && session) {
    const hasPermission = await auth.rbac.authorize(session.user.id, options.requiredPermission);
    if (!hasPermission) {
      throw new ForbiddenError(`Permission "${options.requiredPermission}" required`);
    }
  }

  return {
    user: session?.user ?? null,
    session,
  };
}
