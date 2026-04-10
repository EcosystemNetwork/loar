/**
 * EVM Authentication Routes
 *
 * GET  /auth/nonce   — generate a fresh nonce for SIWE
 * POST /auth/verify  — verify a signed SIWE message (EVM) and return JWT
 */
import { Hono } from 'hono';
import {
  generateNonce,
  verifySiweSignature,
  issueSessionToken,
  refreshSessionToken,
  revokeToken,
  verifySessionToken,
} from '../lib/siwe';

export const authRoutes = new Hono();

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

/** Verifies a signed SIWE message (EVM) and returns a JWT session token. */
authRoutes.post('/verify', async (c) => {
  const body = await c.req.json<{ message: string; signature: string }>();

  if (!body.message || !body.signature) {
    return c.json({ error: 'Missing message or signature' }, 400);
  }

  try {
    const address = await verifySiweSignature(body.message, body.signature as `0x${string}`);
    const token = await issueSessionToken(address);
    return c.json({ token, address, chain: 'evm' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return c.json({ error: message }, 401);
  }
});

/** Refresh an existing session — returns a new JWT if the current one is still valid. */
authRoutes.post('/refresh', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  try {
    const newToken = await refreshSessionToken(token);
    if (!newToken) {
      return c.json({ error: 'Session expired or invalid. Please sign in again.' }, 401);
    }
    return c.json({ token: newToken });
  } catch (err) {
    return c.json({ error: 'Refresh failed' }, 401);
  }
});

/** Revoke the current session token (logout). */
authRoutes.post('/revoke', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  try {
    const payload = await verifySessionToken(token);
    if (payload?.jti) {
      await revokeToken(payload.jti);
    }
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: true }); // Revoke is idempotent — always succeed
  }
});
