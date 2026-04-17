/**
 * CSRF protection middleware for Hono.
 * Validates Origin header on state-changing requests (POST, PUT, PATCH, DELETE).
 * Non-browser requests (no Origin) are allowed through — auth middleware
 * handles access control independently.
 */
import type { Context, Next } from 'hono';

/** Requests that can mutate state require Origin validation. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfProtection(allowedOrigins: string[]) {
  const originsSet = new Set(allowedOrigins);

  return async (c: Context, next: Next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      return next();
    }

    const origin = c.req.header('Origin');

    // No Origin header = non-browser request (curl, server-to-server, MCP).
    // These are authenticated via API key / JWT, not cookies, so CSRF
    // doesn't apply. Allow through.
    if (!origin) {
      return next();
    }

    if (!originsSet.has(origin)) {
      return c.json({ code: 'FORBIDDEN', message: 'Cross-origin request blocked' }, 403);
    }

    return next();
  };
}
