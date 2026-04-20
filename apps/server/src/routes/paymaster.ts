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

// Chains the app is actually deployed on. Reject anything else so a caller
// cannot burn the paymaster balance sponsoring transactions on unrelated
// networks that thirdweb/Pimlico/Biconomy happen to support.
const ALLOWED_CHAIN_IDS = new Set<number>([
  11155111, // Sepolia
  84532, // Base Sepolia
]);

// Optional allowlist of ERC-4337 function selectors the paymaster will sponsor,
// comma-separated (e.g. "purchaseMerch,execute"). If unset we accept any.
const SPONSORED_ACTIONS = (process.env.PAYMASTER_SPONSORED_ACTIONS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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

  const body = (await c.req.json().catch(() => null)) as SponsorBody | null;
  if (!body?.userOp) {
    return c.json({ code: 'BAD_REQUEST', message: 'userOp required' }, 400);
  }

  // Pin chainId to the protocol's allowlist. Without this, an attacker can
  // ask the paymaster to sponsor a transaction on any EVM chain the vendor
  // supports, draining the paymaster balance against arbitrary targets.
  const chainId = body.chainId ?? parseInt(process.env.PAYMASTER_DEFAULT_CHAIN_ID || '84532', 10);
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    return c.json(
      {
        code: 'BAD_REQUEST',
        message: `chainId ${chainId} is not sponsored on this deployment`,
      },
      400
    );
  }
  body.chainId = chainId;

  const sender = (body.userOp as { sender?: unknown })?.sender;
  if (typeof sender !== 'string' || !ADDRESS_RE.test(sender)) {
    return c.json(
      { code: 'BAD_REQUEST', message: 'userOp.sender must be a 0x-prefixed address' },
      400
    );
  }

  // Optional functionName allowlist — when configured, reject everything else
  // so a compromised session cannot sponsor arbitrary contract calls.
  if (
    SPONSORED_ACTIONS.length > 0 &&
    (!body.functionName || !SPONSORED_ACTIONS.includes(body.functionName))
  ) {
    return c.json(
      { code: 'FORBIDDEN', message: 'Requested action is not sponsored by this paymaster' },
      403
    );
  }

  // Quota is anchored to the authenticated session uid — `userOp.sender` is
  // attacker-controlled (counterfactual ERC-4337 addresses pass the regex
  // without needing to exist on-chain), so keying on sender alone lets one
  // session mint unlimited fresh buckets by rotating the field. The
  // per-sender bucket below is retained only as a secondary cap so a
  // compromised session cannot funnel all of its quota into a single
  // target smart account.
  const { blocked: userBlocked } = await consumeRateLimit(
    `paymaster:daily:${user.uid.toLowerCase()}:${chainId}`,
    24 * 60 * 60 * 1000,
    DAILY_SPONSOR_LIMIT
  );
  if (userBlocked) {
    return c.json(
      {
        code: 'QUOTA_EXCEEDED',
        message: `Daily sponsored transaction limit reached (${DAILY_SPONSOR_LIMIT}/day).`,
      },
      429
    );
  }

  const { blocked: senderBlocked } = await consumeRateLimit(
    `paymaster:daily:sender:${sender.toLowerCase()}:${chainId}`,
    24 * 60 * 60 * 1000,
    DAILY_SPONSOR_LIMIT
  );
  if (senderBlocked) {
    return c.json(
      {
        code: 'QUOTA_EXCEEDED',
        message: `Daily sponsored transaction limit reached for this smart account (${DAILY_SPONSOR_LIMIT}/day).`,
      },
      429
    );
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
