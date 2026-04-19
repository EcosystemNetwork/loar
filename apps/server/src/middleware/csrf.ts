/**
 * CSRF protection middleware for Hono.
 * Validates Origin header on state-changing requests (POST, PUT, PATCH, DELETE).
 * Non-browser requests (no Origin) are allowed through — auth middleware
 * handles access control independently.
 */
import type { Context, Next } from 'hono';

/** Requests that can mutate state require Origin validation. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Name of the auth cookie. When this cookie is present on a mutating request,
 * the request is implicitly cookie-authed and therefore CSRF-sensitive, so a
 * missing Origin header must not be allowed through.
 */
const SESSION_COOKIE_NAME = 'siwe-session';

export function csrfProtection(allowedOrigins: string[]) {
  const originsSet = new Set(allowedOrigins);

  return async (c: Context, next: Next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      return next();
    }

    const origin = c.req.header('Origin');
    const cookie = c.req.header('Cookie') || '';
    const hasSessionCookie = cookie.includes(`${SESSION_COOKIE_NAME}=`);

    if (!origin) {
      // For cookie-authed requests, a missing Origin is not safe: an older
      // WebView, a proxy, or certain form-submission contexts can omit
      // Origin while still carrying the session cookie. Reject instead of
      // allowing through.
      if (hasSessionCookie) {
        return c.json(
          { code: 'FORBIDDEN', message: 'Missing Origin header on cookie-authed request' },
          403
        );
      }
      // Non-cookie requests (API key / bearer JWT) are authenticated by
      // header and are not CSRF-vulnerable — allow through.
      return next();
    }

    if (!originsSet.has(origin)) {
      return c.json({ code: 'FORBIDDEN', message: 'Cross-origin request blocked' }, 403);
    }

    return next();
  };
}
