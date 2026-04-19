/**
 * Paymaster proxy (server-side).
 *
 * The web client calls `POST /api/paymaster` with an ERC-4337 UserOperation and
 * gets back a sponsored paymasterAndData blob. Provider is pluggable — we
 * pick based on env so we're not locked into one vendor:
 *
 *   1. THIRDWEB_SECRET_KEY     → thirdweb's paymaster (default — uses the
 *                                same thirdweb account the web client is on)
 *   2. PIMLICO_API_KEY         → Pimlico v2 RPC
 *   3. BICONOMY_API_KEY        → Biconomy v2 RPC
 *   4. (none)                  → 503
 *
 * Per-user daily cap is enforced with the existing rate limiter module, so
 * horizontal replicas share counts via Redis. Cap defaults to 50/day/user.
 *
 * Why proxy instead of calling vendor RPC from the client?
 *   - The vendor secret key must never appear in the web bundle.
 *   - Centralizes spend accounting + quota enforcement.
 *   - Lets us swap providers without rebuilding the client.
 */

import { Hono } from 'hono';
import { verifyAuth } from '../lib/auth';
import { consumeRateLimit } from '../middleware/rate-limit';

export const paymasterRoutes = new Hono();

const DAILY_SPONSOR_LIMIT = parseInt(process.env.PAYMASTER_DAILY_LIMIT || '50', 10);

type Provider =
  | { kind: 'thirdweb'; secret: string }
  | { kind: 'pimlico'; key: string; chainId: number }
  | { kind: 'biconomy'; key: string; chainId: number }
  | { kind: 'none' };

function resolveProvider(): Provider {
  // Default chain id — can be overridden per request via body.chainId
  const chainId = parseInt(process.env.PAYMASTER_DEFAULT_CHAIN_ID || '84532', 10);

  if (process.env.THIRDWEB_SECRET_KEY) {
    return { kind: 'thirdweb', secret: process.env.THIRDWEB_SECRET_KEY };
  }
  if (process.env.PIMLICO_API_KEY) {
    return { kind: 'pimlico', key: process.env.PIMLICO_API_KEY, chainId };
  }
  if (process.env.BICONOMY_API_KEY) {
    return { kind: 'biconomy', key: process.env.BICONOMY_API_KEY, chainId };
  }
  return { kind: 'none' };
}

interface SponsorBody {
  userOp: Record<string, unknown>;
  entryPoint?: string;
  chainId?: number;
  functionName?: string; // Used to check against SPONSORED_ACTIONS if we want server-side enforcement
}

paymasterRoutes.post('/sponsor', async (c) => {
  // Auth required — only signed-in users get sponsored gas
  const { getCookie } = await import('hono/cookie');
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) {
    return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
  }

  const provider = resolveProvider();
  if (provider.kind === 'none') {
    return c.json(
      {
        code: 'NOT_CONFIGURED',
        message:
          'Paymaster is not configured. Set THIRDWEB_SECRET_KEY, PIMLICO_API_KEY, or BICONOMY_API_KEY.',
      },
      503
    );
  }

  // Per-wallet daily quota — shared across replicas via Redis-backed limiter
  const { blocked } = await consumeRateLimit(
    `paymaster:daily:${user.uid.toLowerCase()}`,
    24 * 60 * 60 * 1000,
    DAILY_SPONSOR_LIMIT
  );
  if (blocked) {
    return c.json(
      {
        code: 'QUOTA_EXCEEDED',
        message: `Daily sponsored transaction limit reached (${DAILY_SPONSOR_LIMIT}/day).`,
      },
      429
    );
  }

  const body = (await c.req.json().catch(() => null)) as SponsorBody | null;
  if (!body?.userOp) {
    return c.json({ code: 'BAD_REQUEST', message: 'userOp required' }, 400);
  }

  try {
    const sponsored = await dispatch(provider, body);
    return c.json({
      provider: provider.kind,
      ...sponsored,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'paymaster error';
    console.error(`[paymaster] ${provider.kind} failed:`, msg);
    return c.json({ code: 'PAYMASTER_ERROR', message: msg }, 502);
  }
});

async function dispatch(provider: Provider, body: SponsorBody) {
  switch (provider.kind) {
    case 'thirdweb':
      return sponsorWithThirdweb(provider.secret, body);
    case 'pimlico':
      return sponsorWithPimlico(provider.key, body);
    case 'biconomy':
      return sponsorWithBiconomy(provider.key, body);
    default:
      throw new Error(`Unsupported provider: ${(provider as { kind: string }).kind}`);
  }
}

// ── Thirdweb ───────────────────────────────────────────────────────────

async function sponsorWithThirdweb(secret: string, body: SponsorBody) {
  const chainId = body.chainId ?? parseInt(process.env.PAYMASTER_DEFAULT_CHAIN_ID || '84532', 10);
  // thirdweb's bundler RPC speaks standard pimlico-compatible methods.
  const res = await fetch(`https://${chainId}.bundler.thirdweb.com`, {
    method: 'POST',
    headers: {
      'x-secret-key': secret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'pm_sponsorUserOperation',
      params: [body.userOp, body.entryPoint],
    }),
  });
  if (!res.ok) throw new Error(`thirdweb ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return { paymasterAndData: json.result };
}

// ── Pimlico v2 ─────────────────────────────────────────────────────────

async function sponsorWithPimlico(key: string, body: SponsorBody) {
  const chainId = body.chainId ?? parseInt(process.env.PAYMASTER_DEFAULT_CHAIN_ID || '84532', 10);
  const url = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'pm_sponsorUserOperation',
      params: [body.userOp, body.entryPoint],
    }),
  });
  if (!res.ok) throw new Error(`pimlico ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return { paymasterAndData: json.result };
}

// ── Biconomy v2 ────────────────────────────────────────────────────────

async function sponsorWithBiconomy(key: string, body: SponsorBody) {
  const chainId = body.chainId ?? parseInt(process.env.PAYMASTER_DEFAULT_CHAIN_ID || '84532', 10);
  const url = `https://paymaster.biconomy.io/api/v2/${chainId}/${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'pm_sponsorUserOperation',
      params: [
        body.userOp,
        body.entryPoint,
        { mode: 'SPONSORED', calculateGasLimits: true, expiryDuration: 300 },
      ],
    }),
  });
  if (!res.ok) throw new Error(`biconomy ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return { paymasterAndData: json.result };
}
