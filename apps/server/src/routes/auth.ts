/**
 * SIWE Authentication Routes
 *
 * GET  /auth/nonce   — generate a fresh nonce for SIWE message signing
 * POST /auth/verify  — verify a signed SIWE message and return a JWT session token
 */
import { Hono } from 'hono';
import { generateNonce, verifySiweSignature, issueSessionToken } from '../lib/siwe';

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

/** Verifies a signed SIWE message and returns a JWT session token. */
authRoutes.post('/verify', async (c) => {
  const body = await c.req.json<{ message: string; signature: string }>();

  if (!body.message || !body.signature) {
    return c.json({ error: 'Missing message or signature' }, 400);
  }

  try {
    const address = await verifySiweSignature(
      body.message,
      body.signature as `0x${string}`
    );
    const token = await issueSessionToken(address);
    return c.json({ token, address });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return c.json({ error: message }, 401);
  }
});
