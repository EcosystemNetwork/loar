/**
 * Security headers middleware — adds standard HTTP security headers
 * (HSTS, CSP, X-Frame-Options, etc.) to all responses.
 *
 * CSP uses a strict policy with explicit allowlists for known third-party
 * services (FAL, Pinata, Firebase, Lighthouse, etc.).
 */
import type { Context, Next } from 'hono';
import { randomBytes } from 'crypto';

/** Trusted domains for connect-src (API calls from the frontend). */
const TRUSTED_CONNECT = [
  "'self'",
  'https://*.fal.ai',
  'https://*.pinata.cloud',
  'https://gateway.pinata.cloud',
  'https://*.lighthouse.storage',
  'https://*.firebaseio.com',
  'https://firestore.googleapis.com',
  'https://*.googleapis.com',
  'https://rpc.sepolia.org',
  'https://sepolia.base.org',
  'https://*.meshy.ai',
].join(' ');

/** Trusted domains for img-src. */
const TRUSTED_IMG = [
  "'self'",
  'data:',
  'blob:',
  'https://*.pinata.cloud',
  'https://*.mypinata.cloud',
  'https://gateway.pinata.cloud',
  'https://*.lighthouse.storage',
  'https://firebasestorage.googleapis.com',
  'https://w3s.link',
  'https://*.w3s.link',
  'https://ipfs.io',
  'https://dweb.link',
  'https://*.dweb.link',
].join(' ');

export async function securityHeaders(c: Context, next: Next) {
  // Generate a per-request nonce for inline scripts (if any are needed)
  const nonce = randomBytes(16).toString('base64');
  c.set('cspNonce', nonce);

  // Set security headers BEFORE the handler runs so they're always included
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '0');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src ${TRUSTED_CONNECT}`,
      `img-src ${TRUSTED_IMG}`,
      "font-src 'self' https://fonts.gstatic.com",
      "media-src 'self' blob: https://*.pinata.cloud https://gateway.pinata.cloud https://*.mypinata.cloud https://*.lighthouse.storage https://*.volces.com https://*.fal.ai https://*.fal.media https://w3s.link https://*.w3s.link https://ipfs.io https://dweb.link https://*.dweb.link",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ')
  );
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  c.header('Cross-Origin-Resource-Policy', 'cross-origin');

  await next();
}
