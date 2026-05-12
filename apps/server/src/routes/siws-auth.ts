/**
 * Solana Authentication Routes
 *
 * POST /auth/solana/verify     — verify a signed SIWS message, set httpOnly cookie
 * POST /auth/solana/link       — link a Solana wallet to an existing EVM session
 *
 * Reuses the SIWE nonce store (GET /auth/nonce) so a single nonce inventory
 * serves both chains. The JWT issued here has ns='solana' and sub=base58 pubkey.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { verifySiwsSignature } from '../lib/siws';
import { issueSessionToken, verifySessionToken } from '../lib/siwe';
import { recordAuthEvent } from '../lib/metrics';

export const siwsAuthRoutes = new Hono();

const IS_DEV_OR_TEST = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const IS_PRODUCTION = !IS_DEV_OR_TEST;
const COOKIE_NAME = 'siwe-session';
const COOKIE_MAX_AGE = 24 * 60 * 60;

function setSessionCookie(c: any, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_DEV_OR_TEST ? 'Lax' : 'Strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

function clearSessionCookie(c: any) {
  deleteCookie(c, COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_DEV_OR_TEST ? 'Lax' : 'Strict',
    path: '/',
  });
}

function getSessionToken(c: any): string | undefined {
  const cookieToken = getCookie(c, COOKIE_NAME);
  if (cookieToken) return cookieToken;
  return c.req.header('Authorization')?.replace('Bearer ', '') || undefined;
}

function checkOrigin(c: any): { ok: true; origin: string } | { ok: false; res: Response } {
  const origin = c.req.header('Origin') || c.req.header('Referer');
  if (!origin) {
    return { ok: false, res: c.json({ error: 'Missing Origin header' }, 403) };
  }
  const ALLOWED_ORIGINS = new Set(
    (process.env.CORS_ORIGIN || 'https://loar.fun').split(',').map((o: string) => o.trim())
  );
  if (!IS_PRODUCTION) {
    ALLOWED_ORIGINS.add('http://localhost:5173');
    ALLOWED_ORIGINS.add('http://localhost:3000');
  }
  const originUrl = origin.replace(/\/$/, '');
  let isDevLocalhost = false;
  if (!IS_PRODUCTION) {
    try {
      isDevLocalhost = new URL(originUrl).hostname === 'localhost';
    } catch {
      isDevLocalhost = false;
    }
  }
  if (!ALLOWED_ORIGINS.has(originUrl) && !isDevLocalhost) {
    return { ok: false, res: c.json({ error: 'Origin not allowed' }, 403) };
  }
  return { ok: true, origin };
}

/** Verify a signed SIWS message (Solana) and set a session cookie. */
siwsAuthRoutes.post('/verify', async (c) => {
  const originCheck = checkOrigin(c);
  if (!originCheck.ok) return originCheck.res;

  const contentType = c.req.header('Content-Type');
  if (!contentType?.includes('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 400);
  }

  const body = await c.req.json<{ message: string; signature: string }>();
  if (!body.message || !body.signature) {
    return c.json({ error: 'Missing message or signature' }, 400);
  }

  try {
    const address = await verifySiwsSignature(body.message, body.signature, originCheck.origin);
    const token = await issueSessionToken(address, {
      namespace: 'solana',
      solanaAddress: address,
    });

    setSessionCookie(c, token);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    recordAuthEvent('verify', 'success');
    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('auth:siws_verified', {
        distinctId: address,
        chain: 'solana',
      })
    );

    return c.json({
      address,
      chain: 'solana',
      expiresAt: payload.exp * 1000,
    });
  } catch (err) {
    recordAuthEvent('verify', 'failure');
    const message = err instanceof Error ? err.message : 'Verification failed';
    return c.json({ error: message }, 401);
  }
});

/**
 * Link a Solana wallet to an existing EVM session. Must be authenticated
 * with an EVM JWT (ns='eip155' or absent). Issues a new JWT that retains
 * the EVM primary identity but carries `sol` claim for the Solana address.
 */
siwsAuthRoutes.post('/link', async (c) => {
  const originCheck = checkOrigin(c);
  if (!originCheck.ok) return originCheck.res;

  const token = getSessionToken(c);
  if (!token) return c.json({ error: 'No session' }, 401);

  const currentPayload = await verifySessionToken(token);
  if (!currentPayload?.sub) {
    clearSessionCookie(c);
    return c.json({ error: 'Invalid session' }, 401);
  }
  if (currentPayload.ns === 'solana') {
    return c.json({ error: 'Already signed in with Solana — cannot link to itself' }, 400);
  }

  const body = await c.req.json<{ message: string; signature: string }>();
  if (!body.message || !body.signature) {
    return c.json({ error: 'Missing message or signature' }, 400);
  }

  let solanaAddress: string;
  try {
    solanaAddress = await verifySiwsSignature(body.message, body.signature, originCheck.origin);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Verification failed' }, 401);
  }

  // Reissue JWT preserving EVM primary identity, adding linked Solana address.
  const newToken = await issueSessionToken(currentPayload.sub, {
    namespace: 'eip155',
    solanaAddress,
  });
  setSessionCookie(c, newToken);

  void import('../lib/analytics').then(({ captureServerEvent }) =>
    captureServerEvent('auth:solana_linked', {
      distinctId: currentPayload.sub,
      solanaAddress,
    })
  );

  return c.json({ ok: true, solanaAddress });
});
