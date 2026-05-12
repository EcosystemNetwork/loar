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
import { recordAuthEvent } from '../lib/metrics';

export const authRoutes = new Hono();

// Default IS_PRODUCTION to true unless NODE_ENV is explicitly development/test.
// Staging/preview deploys frequently ship with NODE_ENV unset, which previously
// fell through to the non-prod branch — leaking `Secure: false` cookies over
// plaintext http and widening SameSite to Lax. Fail-safe default closes that.
const IS_DEV_OR_TEST = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const IS_PRODUCTION = !IS_DEV_OR_TEST;
const COOKIE_NAME = 'siwe-session';
const COOKIE_MAX_AGE = 24 * 60 * 60; // 24h in seconds (matches JWT TTL)

/** Set the session cookie with security attributes. */
function setSessionCookie(c: any, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    // Always prefer Secure. The only case where we drop it is local
    // development where the dev server is http://localhost.
    secure: IS_PRODUCTION,
    // Strict in all non-dev envs — top-level cross-site navigations don't
    // carry the cookie, closing cookie-swap / session-fixation windows.
    sameSite: IS_DEV_OR_TEST ? 'Lax' : 'Strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Clear the session cookie. */
function clearSessionCookie(c: any) {
  deleteCookie(c, COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_DEV_OR_TEST ? 'Lax' : 'Strict',
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
// Rate limiting is handled by the middleware in index.ts (10 req/min on /auth/*)
authRoutes.get('/nonce', async (c) => {
  try {
    const nonce = await generateNonce();
    recordAuthEvent('nonce', 'success');
    return c.json({ nonce });
  } catch (err) {
    recordAuthEvent('nonce', 'failure');
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
  // Structural origin check — never substring-match `.includes('localhost')`,
  // because `http://localhost.evil.com` would pass. In dev, only the exact
  // localhost hostname is accepted; the allowlist set already covers prod.
  let isDevLocalhost = false;
  if (!IS_PRODUCTION) {
    try {
      isDevLocalhost = new URL(originUrl).hostname === 'localhost';
    } catch {
      isDevLocalhost = false;
    }
  }
  if (!ALLOWED_ORIGINS.has(originUrl) && !isDevLocalhost) {
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

    recordAuthEvent('verify', 'success');
    // PostHog funnel event — ties the signed-in user to any prior anonymous session.
    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('auth:siwe_verified', {
        distinctId: address,
        chain: 'evm',
      })
    );

    // Return address + expiry (NOT the token) — client uses these for UI state only
    return c.json({
      address,
      chain: 'evm',
      expiresAt: payload.exp * 1000,
    });
  } catch (err) {
    recordAuthEvent('verify', 'failure');
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
      recordAuthEvent('refresh', 'failure');
      clearSessionCookie(c);
      return c.json({ error: 'Session expired or invalid. Please sign in again.' }, 401);
    }

    setSessionCookie(c, newToken);

    const payload = JSON.parse(Buffer.from(newToken.split('.')[1], 'base64').toString());
    recordAuthEvent('refresh', 'success');
    return c.json({ ok: true, expiresAt: payload.exp * 1000 });
  } catch {
    recordAuthEvent('refresh', 'failure');
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

  // Surface the extended JWT claims so the wallet-settings page can render
  // both EVM and Solana identities without a second request. Legacy tokens
  // (no `ns`) default to eip155 — `evm` + `sol` will simply be undefined.
  return c.json({
    authenticated: true,
    address: payload.sub,
    chainNamespace: payload.ns ?? 'eip155',
    evm: payload.evm,
    sol: payload.sol,
    expiresAt: payload.exp ? payload.exp * 1000 : null,
  });
});
