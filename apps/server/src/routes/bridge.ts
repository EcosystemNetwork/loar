/**
 * Cross-chain $LOAR bridge routes (Wormhole NTT).
 *
 *   POST /api/bridge/quote     — fee + ETA quote for from→to/amount
 *   POST /api/bridge/transfer  — initiate source-chain tx (Circle-signed)
 *   GET  /api/bridge/status    — poll VAA + destination redeem
 *
 * Returns 503 until NTT manager addresses are configured. The bridge will
 * stay unavailable for hackathon submission (mainnet deploy is post-)
 * but the API contract is in place so the frontend can wire it now.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyAuth } from '../lib/auth';
import {
  getBridgeStatus,
  initiateBridgeTransfer,
  isBridgeConfigured,
  quoteBridge,
} from '../lib/wormhole-bridge';
import type { Chain } from '@wormhole-foundation/sdk';

export const bridgeRoutes = new Hono();

const SUPPORTED_CHAINS = ['Solana', 'Sepolia', 'BaseSepolia', 'Base'] as const;

const quoteBody = z.object({
  from: z.enum(SUPPORTED_CHAINS),
  to: z.enum(SUPPORTED_CHAINS),
  amount: z.string().regex(/^\d+$/, 'amount must be a non-negative integer (smallest unit)'),
  recipient: z.string().min(32).max(64),
});

bridgeRoutes.post('/quote', async (c) => {
  const parsed = quoteBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  if (!isBridgeConfigured(parsed.data.from as Chain, parsed.data.to as Chain)) {
    return c.json(
      { error: 'Bridge not configured for this route — NTT managers not deployed yet' },
      503
    );
  }
  try {
    const quote = await quoteBridge({
      from: parsed.data.from as Chain,
      to: parsed.data.to as Chain,
      amount: parsed.data.amount,
      recipient: parsed.data.recipient,
    });
    return c.json(quote);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'quote failed' }, 500);
  }
});

bridgeRoutes.post('/transfer', async (c) => {
  const token = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, token);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const parsed = quoteBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  if (!isBridgeConfigured(parsed.data.from as Chain, parsed.data.to as Chain)) {
    return c.json({ error: 'Bridge not configured for this route' }, 503);
  }
  try {
    const result = await initiateBridgeTransfer({
      userId: user.uid,
      from: parsed.data.from as Chain,
      to: parsed.data.to as Chain,
      amount: parsed.data.amount,
      recipient: parsed.data.recipient,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'transfer failed' }, 500);
  }
});

bridgeRoutes.get('/status', async (c) => {
  const from = c.req.query('from');
  const sourceTxRef = c.req.query('txRef');
  if (!from || !SUPPORTED_CHAINS.includes(from as any) || !sourceTxRef) {
    return c.json({ error: 'from + txRef query params required' }, 400);
  }
  try {
    const status = await getBridgeStatus({ from: from as Chain, sourceTxRef });
    return c.json(status);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'status failed' }, 500);
  }
});
