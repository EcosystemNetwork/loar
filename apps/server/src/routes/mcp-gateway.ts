/**
 * MCP Gateway service routes.
 *
 * Service-to-service endpoints called by @loar/mcp-gateway (hosted SSE at
 * mcp.loar.fun). Authenticated via `X-Gateway-Service-Key` against the
 * shared `MCP_GATEWAY_SERVICE_KEY` env var. Never exposed to end-users —
 * every endpoint requires the service key.
 *
 * Endpoints:
 *   POST /api/internal/mint-mcp-key   — mint-or-reuse mcp_server-scoped key
 *
 * See docs/prd-mcp-integration.md §Week 4 and docs/mcp-hosted-sse-deploy.md.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { generateApiKey } from '../lib/apiKeys';
import { db, firebaseAvailable } from '../lib/firebase';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Constant-time service-key comparison. Returns false when either side is
 * missing so a misconfigured gateway or leaked-then-rotated secret fails
 * closed rather than open.
 */
function verifyServiceKey(presented: string | undefined | null): boolean {
  const expected = process.env.MCP_GATEWAY_SERVICE_KEY;
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Key cache ─────────────────────────────────────────────────────────
//
// One MCP-scoped key per wallet, stored in Firestore so it survives
// server restarts and is shared across server replicas. TTL: 30 days;
// on expiry we mint a new key and return that. The old key stays active
// in the `apiKeys` collection until its own expiresAt — no forced revoke.

const OAUTH_KEY_TTL_DAYS = 30;

interface OAuthKeyCacheDoc {
  walletAddress: string;
  rawKey: string;
  keyId: string;
  issuedAt: Date;
  expiresAt: Date;
}

const cacheCol = () => {
  if (!firebaseAvailable || !db) return null;
  return db.collection('oauthGatewayKeys');
};

async function getCachedKey(walletAddress: string): Promise<string | null> {
  const col = cacheCol();
  if (!col) return null;
  try {
    const doc = await col.doc(walletAddress).get();
    if (!doc.exists) return null;
    const d = doc.data() as any;
    const expiresAt =
      d.expiresAt instanceof Date
        ? d.expiresAt
        : new Date((d.expiresAt as any)?.toDate?.() ?? d.expiresAt);
    if (!expiresAt || expiresAt.getTime() <= Date.now()) return null;
    return typeof d.rawKey === 'string' ? d.rawKey : null;
  } catch {
    return null;
  }
}

async function saveCachedKey(doc: OAuthKeyCacheDoc): Promise<void> {
  const col = cacheCol();
  if (!col) return;
  await col.doc(doc.walletAddress).set(doc);
}

// ── Hono routes ────────────────────────────────────────────────────────

export const mcpGatewayRoutes = new Hono();

const mintInputSchema = z.object({
  walletAddress: z.string().regex(ETH_ADDRESS_RE, 'Invalid Ethereum address'),
});

/**
 * Mint-or-reuse a per-wallet MCP-scoped API key for an OAuth gateway session.
 *
 * Contract:
 *   Request:  { walletAddress: "0x..." }
 *   Response: { result: { data: { rawKey: "loar_...", expiresAt: "..." } } }
 *
 * Uses the tRPC response envelope so the gateway can use the same JSON
 * unwrap pattern it uses for other LOAR calls. (Result shape mirrors what
 * a tRPC mutation would return, without actually going through tRPC —
 * service-key auth is incompatible with the SIWE-JWT-or-API-key context
 * builder.)
 */
mcpGatewayRoutes.post('/internal/mint-mcp-key', async (c) => {
  if (!verifyServiceKey(c.req.header('x-gateway-service-key'))) {
    return c.json({ error: 'invalid_service_key' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = mintInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
  }
  const walletAddress = parsed.data.walletAddress.toLowerCase();

  const cached = await getCachedKey(walletAddress);
  if (cached) {
    return c.json({ result: { data: { rawKey: cached, cached: true } } });
  }

  // Mint a new one.
  try {
    const { rawKey, keyDoc } = await generateApiKey({
      name: `oauth-gateway:${walletAddress.slice(0, 10)}`,
      ownerUid: walletAddress,
      permissions: ['mcp_server'],
      expiresInDays: OAUTH_KEY_TTL_DAYS,
    });

    await saveCachedKey({
      walletAddress,
      rawKey,
      keyId: keyDoc.id,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + OAUTH_KEY_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

    return c.json({
      result: {
        data: {
          rawKey,
          cached: false,
          keyId: keyDoc.id,
          expiresAt: keyDoc.expiresAt,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[mcp-gateway] mint failed for ${walletAddress}: ${msg}`);
    return c.json({ error: 'mint_failed', message: msg }, 500);
  }
});

/** Liveness probe for the gateway — service key required. */
mcpGatewayRoutes.get('/internal/ping', async (c) => {
  if (!verifyServiceKey(c.req.header('x-gateway-service-key'))) {
    return c.json({ error: 'invalid_service_key' }, 401);
  }
  return c.json({ ok: true, ts: Date.now() });
});
