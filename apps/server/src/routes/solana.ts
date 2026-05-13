/**
 * Solana operational routes — Circle DCW Solana wallet provisioning + tx status.
 *
 * GET  /api/solana/wallet            — return the caller's Circle Solana wallet (provisions if missing)
 * GET  /api/solana/wallet/balances   — SOL + SPL balances for the caller's Circle wallet
 * GET  /api/solana/tx/status         — poll a Solana tx by signature
 *
 * Actual transaction builders (mint episode, send SOL, etc) live alongside
 * the relevant feature routers — those call into circle-solana.executeSolanaTransaction.
 * This file only exposes the lifecycle endpoints.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyAuth } from '../lib/auth';
import {
  getOrCreateSolanaWallet,
  getSolanaTransactionStatus,
  getSolanaWalletBalances,
  isCircleSolanaConfigured,
  activeCluster,
} from '../lib/circle-solana';
import { mintEpisodeCnft } from '../services/solana/episode-mint';
import { canonizeEpisode, CanonizePrecheckError } from '../services/solana/canon-promote';
import { decompressCnft, CnftDecompressError } from '../services/solana/cnft-decompress';
import { getAttestationPublicKey, getTrustedAttestationKeys } from '../lib/attestation';
import { hasScope } from '../lib/apiKeys';

export const solanaRoutes = new Hono();

// Public read-only routes that don't depend on Circle DCW — the dashboard
// activity feed should keep rendering even if signing creds aren't set up.
// Path-prefix match (startsWith) so /attestation/<pda> and /attestation/key
// both pass through.
const PUBLIC_PATH_PREFIXES = ['/activity', '/config', '/attestation'];

solanaRoutes.use('*', async (c, next) => {
  const subpath = new URL(c.req.url).pathname.replace(/^.*\/api\/solana/, '');
  if (PUBLIC_PATH_PREFIXES.some((p) => subpath === p || subpath.startsWith(p + '/'))) {
    await next();
    return;
  }
  if (!isCircleSolanaConfigured()) {
    return c.json(
      { error: 'Solana DCW not configured (CIRCLE_* and SOLANA_RPC_URL required)' },
      503
    );
  }
  await next();
});

type AuthGate =
  | { user: NonNullable<Awaited<ReturnType<typeof verifyAuth>>>; res: null }
  | { user: null; res: Response };

async function requireAuth(c: any): Promise<AuthGate> {
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) {
    return { user: null, res: c.json({ error: 'Unauthorized' }, 401) };
  }
  return { user, res: null };
}

/**
 * Scope check for API-key callers. JWT/session callers (no apiKeyPermissions)
 * always pass — they're real users acting on their own behalf. API keys
 * (e.g. MCP relays) must hold the named Solana scope.
 */
function requireScope(
  user: NonNullable<Awaited<ReturnType<typeof verifyAuth>>>,
  scope: 'solana.mint' | 'solana.canonize' | 'solana.pay' | 'solana.bridge'
): boolean {
  // No permissions array means JWT-authed user, not an API key — allowed.
  return hasScope(user.apiKeyPermissions, scope);
}

function denyScope(c: any, scope: string) {
  return c.json({ error: `API key missing required scope: ${scope}` }, 403);
}

/**
 * Return the caller's Circle Solana wallet, provisioning it on first call.
 * uid is used as the wallet key so EVM-signed-in users get a Solana wallet
 * tied to their existing identity (no extra Solana sign-in required for
 * Circle-managed flows).
 */
solanaRoutes.get('/wallet', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;

  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    return c.json({
      walletId: wallet.walletId,
      address: wallet.address,
      cluster: wallet.cluster,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to provision Solana wallet' },
      500
    );
  }
});

solanaRoutes.get('/wallet/balances', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;

  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    const balances = await getSolanaWalletBalances(wallet.walletId);
    return c.json({ address: wallet.address, cluster: wallet.cluster, balances });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch balances' }, 500);
  }
});

solanaRoutes.get('/tx/status', async (c) => {
  const signature = c.req.query('signature');
  if (!signature) return c.json({ error: 'signature query param required' }, 400);
  try {
    const result = await getSolanaTransactionStatus(signature);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch tx status' }, 500);
  }
});

solanaRoutes.get('/config', (c) => {
  return c.json({
    cluster: activeCluster(),
    configured: isCircleSolanaConfigured(),
  });
});

// ── Public activity feed ───────────────────────────────────────────────────
//
// Read-only endpoint that powers the /solana dashboard. Aggregates from the
// Firestore mirrors written by apps/solana-indexer + a couple of live on-chain
// reads. Public (no auth) so judges and external integrators can curl it.

import { db, firebaseAvailable } from '../lib/firebase';
import { getSolanaConnection } from '../lib/circle-solana';
import { PublicKey } from '@solana/web3.js';

interface ActivityResponse {
  cluster: string;
  totals: {
    universes: number;
    episodes: number;
    canonEpisodes: number;
    cnftMints: number;
  };
  recent: {
    universes: Array<{ universe: string; creator: string; visibility: string; createdSig: string }>;
    episodes: Array<{
      episode: string;
      universe: string;
      title: string;
      creator: string;
      isCanon: boolean;
      mintedSig: string;
    }>;
    cnftMints: Array<{ signature: string; assetId: string | null; leafOwner: string | null }>;
  };
  treasury: {
    address: string | null;
    solBalance: number | null;
  };
}

solanaRoutes.get('/activity', async (c) => {
  const cluster = activeCluster();
  const empty: ActivityResponse = {
    cluster,
    totals: { universes: 0, episodes: 0, canonEpisodes: 0, cnftMints: 0 },
    recent: { universes: [], episodes: [], cnftMints: [] },
    treasury: { address: null, solBalance: null },
  };

  if (!firebaseAvailable) {
    return c.json(empty);
  }

  // Totals + recent rows in parallel — bounded reads, no joins.
  const [universesSnap, episodesSnap, canonSnap, cnftSnap, recentUniv, recentEp, recentCnft] =
    await Promise.all([
      db.collection('solanaUniverses').count().get(),
      db.collection('solanaEpisodes').count().get(),
      db.collection('solanaEpisodes').where('isCanon', '==', true).count().get(),
      db.collection('solanaCnftAssets').count().get(),
      db.collection('solanaUniverses').orderBy('timestamp', 'desc').limit(8).get(),
      db.collection('solanaEpisodes').orderBy('timestamp', 'desc').limit(12).get(),
      db.collection('solanaCnftAssets').orderBy('mintedAt', 'desc').limit(12).get(),
    ]);

  // Treasury balance — read live so the dashboard always reflects on-chain truth.
  const treasury = process.env.SOLANA_PAY_RECIPIENT ?? null;
  let solBalance: number | null = null;
  if (treasury) {
    try {
      const lamports = await getSolanaConnection().getBalance(new PublicKey(treasury));
      solBalance = lamports / 1e9;
    } catch {
      // Public-RPC throttling can null this out — UI will just hide the row.
    }
  }

  const resp: ActivityResponse = {
    cluster,
    totals: {
      universes: universesSnap.data().count,
      episodes: episodesSnap.data().count,
      canonEpisodes: canonSnap.data().count,
      cnftMints: cnftSnap.data().count,
    },
    recent: {
      universes: recentUniv.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          universe: (data.universe as string) ?? d.id,
          creator: (data.creator as string) ?? '',
          visibility: (data.visibility as string) ?? 'unknown',
          createdSig: (data.createdSig as string) ?? '',
        };
      }),
      episodes: recentEp.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          episode: (data.episode as string) ?? d.id,
          universe: (data.universe as string) ?? '',
          title: (data.title as string) ?? '',
          creator: (data.creator as string) ?? '',
          isCanon: Boolean(data.isCanon),
          mintedSig: (data.mintedSig as string) ?? '',
        };
      }),
      cnftMints: recentCnft.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          signature: (data.mintedSig as string) ?? d.id,
          assetId: (data.assetId as string) ?? null,
          leafOwner: (data.leafOwner as string) ?? null,
        };
      }),
    },
    treasury: { address: treasury, solBalance },
  };

  // Brief CDN cache — 5s is enough to absorb traffic spikes during demos
  // while still feeling "live" (the indexer's webhook lag is ~2s anyway).
  c.header('Cache-Control', 'public, max-age=5');
  return c.json(resp);
});

// ── Cross-chain attestation receipts ───────────────────────────────────────

/**
 * Public signer pubkey. External verifiers fetch this once and verify any
 * LOAR cross-chain receipt offline via Ed25519. Now returns both the active
 * signer AND any prior signers from a rotation, so receipts emitted under
 * the previous key still verify cleanly.
 */
solanaRoutes.get('/attestation/key', async (c) => {
  const { active, previous } = await getTrustedAttestationKeys();
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    schema: 'loar-cnft-cross-chain-v1',
    pubKey: active, // back-compat alias for the active signer
    activePubKey: active,
    previousPubKeys: previous,
    curve: 'ed25519',
    encoding: 'base58',
    verify: 'standard ed25519 over canonical JSON of receipt minus { signer, sig }',
  });
});

/**
 * Fetch a published receipt by episode PDA. Returns 404 if the cNFT was
 * minted before attestations were wired or in the rare case the post-mint
 * signing failed (the mint still landed; the lineage doc may exist).
 *
 * Public by design — the entire point of attestation receipts is that
 * third parties can verify the cross-chain claim without trusting LOAR.
 * The receipt itself contains only on-chain references (PDA, tx sig,
 * universe address) — no PII, no balance, no auth state. Gating this
 * would defeat the verifiability use case.
 */
solanaRoutes.get('/attestation/:episodePda', async (c) => {
  const pda = c.req.param('episodePda');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pda)) {
    return c.json({ error: 'invalid Solana address' }, 400);
  }
  if (!firebaseAvailable) {
    return c.json({ error: 'attestation store unavailable' }, 503);
  }
  const doc = await db.collection('solanaAttestations').doc(pda).get();
  if (!doc.exists) {
    return c.json({ error: 'no attestation for that PDA' }, 404);
  }
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(doc.data());
});

// ── Episode mint (Bubblegum cNFT) ──────────────────────────────────────────

const mintBody = z.object({
  universeAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid Solana address'),
  /** 32-byte content hash as 0x-prefixed hex (matches EVM bytes32 shape). */
  contentHashHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x + 64 hex chars'),
  metadataUri: z.string().url().max(200),
  title: z.string().min(1).max(64),
  /**
   * Optional VLM / content lineage. Mirrored to a Firestore doc so off-chain
   * UIs can join cNFT mints → LOAR content → VLM sceneIndex → wiki entities.
   * None of these fields go on-chain; the cNFT URI is authoritative for that.
   */
  lineage: z
    .object({
      contentId: z.string().max(128).optional(),
      extractionId: z.string().max(128).optional(),
      sceneIndex: z.number().int().min(0).max(10_000).optional(),
      evmUniverseAddress: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/, 'expected EVM 0x address')
        .optional(),
      entityId: z.string().max(128).optional(),
    })
    .optional(),
});

/**
 * Mint an Episode as a Bubblegum cNFT. Composes the Anchor record ix and
 * the Bubblegum mint_v1 ix into a single Circle-signed tx — atomic.
 *
 * Auth: required (caller's uid maps to a Circle DCW Solana wallet).
 * Authz: program-side — episode::mint_episode constraint enforces that the
 * signing creator matches universe.creator. A user can only mint episodes
 * under their own Universes.
 */
solanaRoutes.post('/episode/mint', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.mint')) return denyScope(c, 'solana.mint');

  const parsed = mintBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await mintEpisodeCnft({
      userId: auth.user.uid,
      universeAddress: parsed.data.universeAddress,
      contentHash: Buffer.from(parsed.data.contentHashHex.slice(2), 'hex'),
      metadataUri: parsed.data.metadataUri,
      title: parsed.data.title,
      lineage: parsed.data.lineage,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Mint failed' }, 500);
  }
});

// ── Canon promotion (decompress → Metaplex Core) ───────────────────────────

const canonizeBody = z.object({
  universeAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid Solana address'),
  contentHashHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x + 64 hex chars'),
  metadataUri: z.string().url().max(200),
  name: z.string().min(1).max(64),
  cnftAssetId: z.string().optional(),
});

/**
 * Promote an Episode to canon. Flips `is_canon` on the EpisodeRecord PDA and
 * mints a Metaplex Core asset alongside the existing cNFT — the Core asset
 * becomes the marketplace-tradable canon artifact while the cNFT stays as
 * historical mint record.
 */
// ── cNFT decompression ─────────────────────────────────────────────────────

const decompressBody = z.object({
  cnftAssetId: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid Solana address'),
});

/**
 * Decompress a Bubblegum cNFT into a standard SPL Token Metadata NFT.
 *
 * Use this when you want a single, marketplace-grade asset (Tensor /
 * MagicEden / DeFi) instead of the dual-asset Core path. Cost: ~0.012 SOL
 * for the mint + metadata rent. Permission: only the leaf owner can
 * decompress, so this route checks caller's Circle wallet against the cNFT.
 *
 * Returns 404 NOT_FOUND if the asset doesn't exist, 403 NOT_OWNER if the
 * caller doesn't own the leaf, 409 if the cNFT is already decompressed.
 */
solanaRoutes.post('/cnft/decompress', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  // Reuse the canonize scope — decompress is a similar high-value op
  // (irreversibly retires a leaf), so anyone permitted to canonize is
  // also permitted to decompress.
  if (!requireScope(auth.user, 'solana.canonize')) return denyScope(c, 'solana.canonize');
  const parsed = decompressBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await decompressCnft({
      userId: auth.user.uid,
      cnftAssetId: parsed.data.cnftAssetId,
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof CnftDecompressError) {
      const status = err.code === 'NOT_OWNER' ? 403 : err.code === 'NOT_FOUND' ? 404 : 409;
      return c.json({ error: err.message, code: err.code }, status);
    }
    // Bubblegum's "LeafAlreadyDecompressed" surfaces as a custom program error
    // in the tx logs; surface it as 409 with a clear message.
    const msg = err instanceof Error ? err.message : 'decompress failed';
    if (/already.*decompress/i.test(msg)) {
      return c.json({ error: 'cNFT already decompressed', code: 'ALREADY_DECOMPRESSED' }, 409);
    }
    return c.json({ error: msg }, 500);
  }
});

solanaRoutes.post('/episode/canonize', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.canonize')) return denyScope(c, 'solana.canonize');

  const parsed = canonizeBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await canonizeEpisode({
      userId: auth.user.uid,
      universeAddress: parsed.data.universeAddress,
      contentHash: Buffer.from(parsed.data.contentHashHex.slice(2), 'hex'),
      metadataUri: parsed.data.metadataUri,
      name: parsed.data.name,
      cnftAssetId: parsed.data.cnftAssetId,
    });
    return c.json(result);
  } catch (err) {
    // Pre-flight failures map to deterministic client-side errors so the
    // frontend can show a clear message instead of a generic 500.
    if (err instanceof CanonizePrecheckError) {
      return c.json({ error: err.message, code: err.code }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    return c.json({ error: err instanceof Error ? err.message : 'Canonize failed' }, 500);
  }
});
