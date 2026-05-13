/**
 * Solana Pay routes.
 *
 *   POST /api/solana-pay/intent  — create a payment intent, return URL + reference
 *   GET  /api/solana-pay/status  — poll on-chain settlement for a reference
 *
 * Auth required on intent creation (we attribute payments to a uid for
 * crediting/attribution). Status is public-readable — the reference is a
 * one-time-use 32-byte key so leaking it doesn't reveal anything about
 * other buyers.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyAuth } from '../lib/auth';
import { createPaymentIntent, getPaymentStatus } from '../lib/solana-pay';
import { hasScope } from '../lib/apiKeys';

export const solanaPayRoutes = new Hono();

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

solanaPayRoutes.use('*', async (c, next) => {
  if (!process.env.SOLANA_PAY_RECIPIENT) {
    return c.json({ error: 'Solana Pay not configured (SOLANA_PAY_RECIPIENT missing)' }, 503);
  }
  await next();
});

const intentBody = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'amount must be a non-negative decimal string'),
  splToken: z.string().regex(SOLANA_ADDR_RE).optional(),
  label: z.string().max(100).optional(),
  memo: z.string().max(200).optional(),
});

solanaPayRoutes.post('/intent', async (c) => {
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  // API-key callers (MCP relays etc) need explicit Solana Pay permission;
  // JWT/session users (apiKeyPermissions undefined) always pass.
  if (!hasScope(user.apiKeyPermissions, 'solana.pay')) {
    return c.json({ error: 'API key missing required scope: solana.pay' }, 403);
  }

  const parsed = intentBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }

  try {
    const intent = await createPaymentIntent({
      userId: user.uid,
      amount: parsed.data.amount,
      splToken: parsed.data.splToken,
      label: parsed.data.label,
      memo: parsed.data.memo,
    });
    return c.json(intent);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to create intent' }, 500);
  }
});

solanaPayRoutes.get('/status', async (c) => {
  const reference = c.req.query('reference');
  if (!reference || !SOLANA_ADDR_RE.test(reference)) {
    return c.json({ error: 'reference query param required (Solana address)' }, 400);
  }

  try {
    const status = await getPaymentStatus(reference);
    if (!status) return c.json({ error: 'reference not found' }, 404);
    return c.json(status);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to check status' }, 500);
  }
});
