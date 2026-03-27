/**
 * Security headers middleware — adds standard HTTP security headers
 * (HSTS, CSP, X-Frame-Options, etc.) to all responses.
 */
import type { Context, Next } from 'hono';

export async function securityHeaders(c: Context, next: Next) {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
