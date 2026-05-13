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
  BridgeLimitError,
  getBridgeStatus,
  initiateBridgeTransfer,
  isAnyBridgeAvailable,
  isBridgeConfigured,
  quoteBridge,
} from '../lib/wormhole-bridge';
import { getIntent } from '../lib/bridge-custodial';
import type { Chain } from '@wormhole-foundation/sdk';

export const bridgeRoutes = new Hono();

const SUPPORTED_CHAINS = ['Solana', 'Sepolia', 'BaseSepolia', 'Base'] as const;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Per-direction recipient shape: Solana destinations need base58, EVM
 * destinations need 0x-hex. Without this, a base58 recipient on a
 * Solana→EVM bridge would land the source-side SPL in the vault and then
 * fail at the EVM mint with a hard-to-debug viem encoding error — funds
 * recoverable only via operator intervention.
 */
const quoteBody = z
  .object({
    from: z.enum(SUPPORTED_CHAINS),
    to: z.enum(SUPPORTED_CHAINS),
    amount: z.string().regex(/^\d+(\.\d+)?$/, 'amount must be a non-negative decimal'),
    recipient: z.string().min(32).max(64),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .superRefine((data, ctx) => {
    const okEvm = EVM_ADDR_RE.test(data.recipient);
    const okSol = SOLANA_ADDR_RE.test(data.recipient);
    if (data.to === 'Solana' && !okSol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipient'],
        message: 'recipient must be a Solana base58 address when to=Solana',
      });
    } else if (data.to !== 'Solana' && !okEvm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipient'],
        message: 'recipient must be a 0x EVM address when destination is EVM',
      });
    }
  });

bridgeRoutes.post('/quote', async (c) => {
  const parsed = quoteBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  const from = parsed.data.from as Chain;
  const to = parsed.data.to as Chain;
  if (!isAnyBridgeAvailable(from, to)) {
    return c.json(
      {
        error:
          'Bridge not configured for this route — set custodial vault env vars or deploy NTT managers',
      },
      503
    );
  }
  try {
    const quote = await quoteBridge({
      from,
      to,
      amount: parsed.data.amount,
      recipient: parsed.data.recipient,
    });
    // Annotate which backend will service this pair so the UI can show a
    // "custodial testnet" warning vs the trustless NTT path.
    return c.json({
      ...quote,
      backend: isBridgeConfigured(from, to) ? 'wormhole_ntt' : 'custodial',
    });
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
  const from = parsed.data.from as Chain;
  const to = parsed.data.to as Chain;
  if (!isAnyBridgeAvailable(from, to)) {
    return c.json({ error: 'Bridge not configured for this route' }, 503);
  }
  try {
    const result = await initiateBridgeTransfer({
      userId: user.uid,
      from,
      to,
      amount: parsed.data.amount,
      recipient: parsed.data.recipient,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return c.json(result);
  } catch (err) {
    // Cap violations are user-actionable → 400; pass through the structured code.
    if (err instanceof BridgeLimitError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    return c.json({ error: err instanceof Error ? err.message : 'transfer failed' }, 500);
  }
});

bridgeRoutes.get('/status', async (c) => {
  const from = c.req.query('from');
  const sourceTxRef = c.req.query('txRef');
  if (!from || !SUPPORTED_CHAINS.includes(from as any) || !sourceTxRef) {
    return c.json({ error: 'from + txRef query params required' }, 400);
  }

  // Ownership gate for custodial intents — only the originator (or an
  // operator with API key scope) can see full intent state. Anonymous
  // callers get a stripped view: state + tx refs only, no userId.
  let isOwner = false;
  if (sourceTxRef.startsWith('bridge_')) {
    const intent = await getIntent(sourceTxRef);
    if (intent) {
      const token = getCookie(c, 'siwe-session');
      const user = await verifyAuth(c.req.raw.headers, token);
      isOwner = user?.uid === intent.userId;
    }
  }

  try {
    const status = await getBridgeStatus({ from: from as Chain, sourceTxRef });
    if (!isOwner) {
      // Public view — strip anything that maps txRef → user identity.
      return c.json({
        state: status.state,
        sourceTxRef: status.sourceTxRef,
        destinationTxRef: status.destinationTxRef,
        vaaSequence: status.vaaSequence,
      });
    }
    return c.json(status);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'status failed' }, 500);
  }
});
