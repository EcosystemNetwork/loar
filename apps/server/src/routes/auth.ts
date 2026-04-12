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
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Clear the session cookie. */
function clearSessionCookie(c: any) {
  deleteCookie(c, COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'Lax',
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

/** Returns a fresh nonce for constructing a SIWE message on the client. */
authRoutes.get('/nonce', async (c) => {
  try {
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
