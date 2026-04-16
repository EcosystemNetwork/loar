/**
 * EVM Authentication Routes
 *
 * GET  /auth/nonce   — generate a fresh nonce for SIWE
 * POST /auth/verify  — verify a signed SIWE message (EVM), set httpOnly cookie
 * POST /auth/refresh — refresh session cookie
 * POST /auth/revoke  — revoke session and clear cookie
 * GET  /auth/me      — return current session info (address, expiry)
 *
 * Session tokens are stored in httpOnly cookies (not exposed to JS).
 * The client stores only the address and expiry for UI purposes.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  generateNonce,
  verifySiweSignature,
  issueSessionToken,
  refreshSessionToken,
  revokeToken,
  verifySessionToken,
} from '../lib/siwe';

export const authRoutes = new Hono();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'siwe-session';
const COOKIE_MAX_AGE = 24 * 60 * 60; // 24h in seconds (matches JWT TTL)

/** Set the session cookie with security attributes. */
function setSessionCookie(c: any, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'Strict' : 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Clear the session cookie. */
function clearSessionCookie(c: any) {
  deleteCookie(c, COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'Strict' : 'Lax',
    path: '/',
  });
}

/** Extract the session token from cookie or Authorization header (backward compat). */
function getSessionToken(c: any): string | undefined {
  // Prefer cookie (new flow)
  const cookieToken = getCookie(c, COOKIE_NAME);
  if (cookieToken) return cookieToken;
  // Fall back to Authorization header (API key users, legacy clients)
  return c.req.header('Authorization')?.replace('Bearer ', '') || undefined;
}

// Per-IP rate limiting for nonce generation (prevent Firestore bloat)
const nonceRateLimit = new Map<string, { count: number; resetAt: number }>();
const NONCE_LIMIT = 10; // max nonces per IP per minute
const NONCE_WINDOW = 60_000;

/** Returns a fresh nonce for constructing a SIWE message on the client. */
authRoutes.get('/nonce', async (c) => {
  try {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    const entry = nonceRateLimit.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= NONCE_LIMIT) {
        return c.json({ error: 'Too many nonce requests. Try again later.' }, 429);
      }
      entry.count++;
    } else {
      nonceRateLimit.set(ip, { count: 1, resetAt: now + NONCE_WINDOW });
    }
    // Periodic cleanup to prevent memory leak
    if (nonceRateLimit.size > 10000) {
      for (const [key, val] of nonceRateLimit) {
        if (now > val.resetAt) nonceRateLimit.delete(key);
      }
    }

    const nonce = await generateNonce();
    return c.json({ nonce });
  } catch (err) {
    console.error('Failed to generate nonce:', err);
    return c.json({ error: 'Failed to generate nonce' }, 500);
  }
});

/** Verifies a signed SIWE message (EVM), sets httpOnly session cookie. */
authRoutes.post('/verify', async (c) => {
  // CSRF protection: validate Origin header on state-changing auth requests
  const origin = c.req.header('Origin') || c.req.header('Referer');
  if (!origin) {
    return c.json({ error: 'Missing Origin header' }, 403);
  }

  // Validate origin against allowed domains
  const ALLOWED_ORIGINS = new Set(
    (process.env.CORS_ORIGIN || 'https://loar.fun').split(',').map((o) => o.trim())
  );
  // Also allow localhost in dev
  if (!IS_PRODUCTION) {
    ALLOWED_ORIGINS.add('http://localhost:5173');
    ALLOWED_ORIGINS.add('http://localhost:3000');
  }
  const originUrl = origin.replace(/\/$/, '');
  if (!ALLOWED_ORIGINS.has(originUrl) && !(originUrl.includes('localhost') && !IS_PRODUCTION)) {
    return c.json({ error: 'Origin not allowed' }, 403);
  }

  const contentType = c.req.header('Content-Type');
  if (!contentType?.includes('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 400);
  }

  const body = await c.req.json<{ message: string; signature: string }>();

  if (!body.message || !body.signature) {
    return c.json({ error: 'Missing message or signature' }, 400);
  }

  try {
    const address = await verifySiweSignature(
      body.message,
      body.signature as `0x${string}`,
      origin
    );
    const token = await issueSessionToken(address);

    // Set httpOnly cookie — JS cannot read this
    setSessionCookie(c, token);

    // Decode expiry for client UI (not secret — just a timestamp)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    // Return address + expiry (NOT the token) — client uses these for UI state only
    return c.json({
      address,
      chain: 'evm',
      expiresAt: payload.exp * 1000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return c.json({ error: message }, 401);
  }
});

/** Refresh an existing session — reads cookie, sets new cookie. */
authRoutes.post('/refresh', async (c) => {
  const token = getSessionToken(c);
  if (!token) {
    return c.json({ error: 'No session' }, 401);
  }

  try {
    const newToken = await refreshSessionToken(token);
    if (!newToken) {
      clearSessionCookie(c);
      return c.json({ error: 'Session expired or invalid. Please sign in again.' }, 401);
    }

    setSessionCookie(c, newToken);

    const payload = JSON.parse(Buffer.from(newToken.split('.')[1], 'base64').toString());
    return c.json({ ok: true, expiresAt: payload.exp * 1000 });
  } catch {
    clearSessionCookie(c);
    return c.json({ error: 'Refresh failed' }, 401);
  }
});

/** Revoke the current session token (logout) and clear cookie. */
authRoutes.post('/revoke', async (c) => {
  const token = getSessionToken(c);

  if (token) {
    try {
      const payload = await verifySessionToken(token);
      if (payload?.jti) {
        await revokeToken(payload.jti);
      }
    } catch {
      // Best-effort revocation
    }
  }

  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** Check current session — returns address + expiry if authenticated. */
authRoutes.get('/me', async (c) => {
  const token = getSessionToken(c);
  if (!token) {
    return c.json({ authenticated: false }, 200);
  }

  const payload = await verifySessionToken(token);
  if (!payload?.sub) {
    clearSessionCookie(c);
    return c.json({ authenticated: false }, 200);
  }

  return c.json({
    authenticated: true,
    address: payload.sub,
    expiresAt: payload.exp ? payload.exp * 1000 : null,
  });
});
