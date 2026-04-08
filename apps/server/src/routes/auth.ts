/**
 * Multi-Chain Authentication Routes
 *
 * GET  /auth/nonce          — generate a fresh nonce (shared by SIWE + SIWS + SUI)
 * POST /auth/verify         — verify a signed SIWE message (EVM) and return JWT
 * POST /auth/verify-solana  — verify a signed SIWS message (Solana) and return JWT
 * POST /auth/verify-sui     — verify a signed personal message (SUI) and return JWT
 */
import { Hono } from 'hono';
import { generateNonce, verifySiweSignature, issueSessionToken } from '../lib/siwe';
import { verifySolanaSignature, issueSolanaSessionToken } from '../lib/solana-auth';
import { verifySuiSignature, issueSuiSessionToken } from '../lib/sui-auth';

export const authRoutes = new Hono();

/** Returns a fresh nonce for constructing a SIWE/SIWS message on the client. */
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

/** Verifies a signed SIWS message (Solana) and returns a JWT session token. */
authRoutes.post('/verify-solana', async (c) => {
  const body = await c.req.json<{
    message: string;
    signature: string;
    publicKey: string;
  }>();

  if (!body.message || !body.signature || !body.publicKey) {
    return c.json({ error: 'Missing message, signature, or publicKey' }, 400);
  }

  try {
    const address = await verifySolanaSignature(body.message, body.signature, body.publicKey);
    const token = await issueSolanaSessionToken(address);
    return c.json({ token, address, chain: 'solana' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return c.json({ error: message }, 401);
  }
});

/** Verifies a signed personal message (SUI) and returns a JWT session token. */
authRoutes.post('/verify-sui', async (c) => {
  const body = await c.req.json<{
    message: string;
    signature: string;
    address: string;
  }>();

  if (!body.message || !body.signature || !body.address) {
    return c.json({ error: 'Missing message, signature, or address' }, 400);
  }

  try {
    const address = await verifySuiSignature(body.message, body.signature, body.address);
    const token = await issueSuiSessionToken(address);
    return c.json({ token, address, chain: 'sui' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return c.json({ error: message }, 401);
  }
});
