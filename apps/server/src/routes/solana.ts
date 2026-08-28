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
import { initializeSolanaUniverse } from '../services/solana/universe-init';
import { getAttestationPublicKey, getTrustedAttestationKeys } from '../lib/attestation';
import { hasScope } from '../lib/apiKeys';
import { consumeRateLimit, getClientKey } from '../middleware/rate-limit';

export const solanaRoutes = new Hono();

// Public read-only routes that don't depend on Circle DCW — the dashboard
// activity feed should keep rendering even if signing creds aren't set up.
// Path-prefix match (startsWith) so /attestation/<pda> and /attestation/key
// both pass through. The /licensing/registration, /canon-market/submission,
// /bonding-curve/state, /premium-actions/<label>, and /split-router/splits
// reads are all content-addressed PDA lookups (Solana RPC only, no Circle),
// so they stay reachable even before Circle DCW is provisioned.
const PUBLIC_PATH_PREFIXES = [
  '/activity',
  '/config',
  '/attestation',
  '/licensing/registration',
  '/canon-market/submission',
  '/bonding-curve/state',
  '/premium-actions/read',
  '/split-router/splits',
];

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

/**
 * M3: per-user rate limit on Solana write endpoints. Every POST under
 * /api/solana that signs a tx via Circle DCW costs us (a) Helius RPC quota,
 * (b) Circle KMS signing volume, (c) on-chain SOL fees from the platform fee
 * payer. A single uid spamming `/episode/mint` could exhaust any of those.
 *
 * Bucket: 30 requests / 60s per authenticated uid, shared across all write
 * routes. Anonymous callers fall through (the per-route `requireAuth` 401s
 * them anyway). Reads (GET) are unaffected.
 *
 * In-memory via `consumeRateLimit` — production should set REDIS_URL so the
 * limit is shared across server instances. TODO(prod): wire Redis here.
 */
const SOLANA_WRITE_RATE_LIMIT_MAX = 30;
const SOLANA_WRITE_RATE_LIMIT_ANON_MAX = 10;
const SOLANA_WRITE_RATE_LIMIT_WINDOW_MS = 60_000;

solanaRoutes.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS') {
    await next();
    return;
  }
  const cookieToken = getCookie(c, 'siwe-session');
  let user: Awaited<ReturnType<typeof verifyAuth>> = null;
  try {
    user = await verifyAuth(c.req.raw.headers, cookieToken);
  } catch {
    user = null;
  }
  let key: string;
  let max: number;
  if (user) {
    key = `solana-write:${user.uid}`;
    max = SOLANA_WRITE_RATE_LIMIT_MAX;
  } else {
    const ip = getClientKey(c);
    key = `solana-anon:${ip}`;
    max = SOLANA_WRITE_RATE_LIMIT_ANON_MAX;
  }
  const result = await consumeRateLimit(key, SOLANA_WRITE_RATE_LIMIT_WINDOW_MS, max);
  c.header('X-RateLimit-Limit', String(max));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  if (result.blocked) {
    c.header('Retry-After', String(Math.ceil(SOLANA_WRITE_RATE_LIMIT_WINDOW_MS / 1000)));
    return c.json(
      { error: 'Too many Solana write requests — slow down', code: 'RATE_LIMITED' },
      429
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
type SolanaScope =
  | 'solana.mint'
  | 'solana.canonize'
  | 'solana.pay'
  | 'solana.bridge'
  | 'solana.license'
  | 'solana.canon.vote'
  | 'solana.stake'
  | 'solana.credits'
  | 'solana.subscribe'
  | 'solana.curve'
  | 'solana.fees'
  | 'solana.premium'
  | 'solana.remix'
  | 'solana.splits';

function requireScope(
  user: NonNullable<Awaited<ReturnType<typeof verifyAuth>>>,
  scope: SolanaScope
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

// ── Universe initialization (Anchor `initialize_universe`) ─────────────────

const universeInitBody = z.object({
  contentHashHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x + 64 hex chars'),
  plotHashHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x + 64 hex chars'),
  visibility: z.enum(['Private', 'Public']),
  name: z.string().min(1).max(200),
  imageUrl: z.string().url().max(2048),
  portraitImageUrl: z.string().url().max(2048).optional(),
  description: z.string().min(1).max(1000),
  universeType: z.enum(['fun', 'monetized']).default('fun'),
});

/**
 * Deploy a new Universe PDA via Circle DCW + persist its Firestore mirror.
 * The caller's uid maps to a server-custodied Solana wallet (auto-provisioned),
 * which signs the `initialize_universe` ix. No browser wallet adapter required.
 */
solanaRoutes.post('/universe/initialize', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;

  const parsed = universeInitBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await initializeSolanaUniverse({
      userId: auth.user.uid,
      contentHash: Buffer.from(parsed.data.contentHashHex.slice(2), 'hex'),
      plotHash: Buffer.from(parsed.data.plotHashHex.slice(2), 'hex'),
      visibility: parsed.data.visibility,
      name: parsed.data.name,
      imageUrl: parsed.data.imageUrl,
      portraitImageUrl: parsed.data.portraitImageUrl,
      description: parsed.data.description,
      universeType: parsed.data.universeType,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Universe init failed' }, 500);
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

// ───────────────────────────────────────────────────────────────────────────
// Ported Anchor programs — feature parity with the EVM monetization stack
// ───────────────────────────────────────────────────────────────────────────
//
// Each block below wraps one Anchor program's user-facing surface area as
// HTTP. SDKs live in apps/server/src/lib/solana-<program>.ts. The auth model
// is identical to the routes above: JWT auth on every endpoint, scope check
// on writes (so MCP API keys can be permissioned per program).
//
// All write routes resolve the caller's wallet via getOrCreateSolanaWallet
// before delegating, so the Circle DCW wallet exists by the time the SDK
// looks it up. Read routes are public where the read is content-addressed
// (PDA derived from a hash anyone can compute) and require auth where the
// read is identity-scoped (e.g. "what credits do I have").

import {
  buyContent as licensingBuyContent,
  readRegistration as licensingReadRegistration,
  hasContentAccess as licensingHasAccess,
} from '../lib/solana-licensing';
import {
  vote as canonMarketVote,
  readSubmission as canonMarketReadSubmission,
} from '../lib/solana-canon-market';
import {
  stake as stakingStake,
  unstake as stakingUnstake,
  readStakeInfo as stakingReadInfo,
} from '../lib/solana-staking';
import {
  purchaseWithSol as creditsPurchaseSol,
  purchaseWithLoar as creditsPurchaseLoar,
  readUserCredits as creditsReadBalance,
} from '../lib/solana-credit-manager';
import {
  subscribe as subscriptionSubscribe,
  readSubscription as subscriptionRead,
} from '../lib/solana-subscription';
import {
  buyTokens as curveBuy,
  sellTokens as curveSell,
  readCurve as curveReadState,
} from '../lib/solana-bonding-curve';
import {
  claimFees as feeLockerClaim,
  readFeeBalance as feeLockerReadBalance,
} from '../lib/solana-fee-locker';
import {
  executeAction as premiumExecuteAction,
  readAction as premiumReadAction,
  PREMIUM_ACTION_LABELS,
} from '../lib/solana-premium-actions';
import { chargeRemixFee } from '../lib/solana-remix-fees';
import {
  routeWithSplits as splitRouterRoute,
  readSplits as splitRouterReadSplits,
} from '../lib/solana-split-router';

// ── Shared helpers ─────────────────────────────────────────────────────────

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

const hexBytes = (hex: string): Buffer => Buffer.from(hex.slice(2), 'hex');

/**
 * H-3: platform fee for the split router. Server-controlled — clients must NOT
 * be able to set this, or a malicious caller could route ~all of a payment to
 * the platform fee bucket and zero out collaborator splits.
 *
 * 250 bps = 2.5%, matches the EVM PaymentRouter default. Bump via deploy, not
 * via request body.
 */
const SPLIT_ROUTER_PLATFORM_FEE_BPS = 250;

/**
 * Read a Solana Universe's `creator` from the on-chain Universe account.
 *
 * C-2 (CRITICAL): previously read Firestore (`solanaUniverses.<pda>.creator`),
 * which let anyone with write access to that doc redirect creator royalties.
 * The on-chain account is the only trustworthy source for the CPI destination
 * pubkey passed into `subscribe` / `chargeRemixFee`.
 *
 * Falls back to the Firestore mirror ONLY when (a) the on-chain read fails
 * (RPC outage) AND (b) the explicit `ALLOW_UNIVERSE_CREATOR_MIRROR_FALLBACK`
 * env flag is set to "true". Default behaviour: on-chain or nothing.
 *
 * Returns null when the universe doesn't exist on-chain (and no fallback);
 * caller surfaces a 404.
 */
async function resolveUniverseCreator(universePda: string): Promise<PublicKey | null> {
  const { decodeUniverseAccount, UNIVERSE_DISCRIMINATOR } = await import('../lib/anchor-ix');
  const conn = getSolanaConnection();

  let pda: PublicKey;
  try {
    pda = new PublicKey(universePda);
  } catch {
    return null;
  }

  const universeProgramIdStr = process.env.UNIVERSE_PROGRAM_ID;
  if (!universeProgramIdStr) {
    throw new Error('UNIVERSE_PROGRAM_ID is not set');
  }
  const universeProgramId = new PublicKey(universeProgramIdStr);

  try {
    const acct = await conn.getAccountInfo(pda, 'confirmed');
    if (acct) {
      if (!acct.owner.equals(universeProgramId)) {
        return null;
      }
      if (acct.data.length < 8 || !acct.data.subarray(0, 8).equals(UNIVERSE_DISCRIMINATOR)) {
        return null;
      }
      const decoded = decodeUniverseAccount(Buffer.from(acct.data));
      if (decoded) return decoded.creator;
      // Account exists but decode failed — treat as not-a-Universe rather than
      // silently falling back to a redirectable Firestore value.
      return null;
    }
    // acct === null → universe not deployed at that PDA.
    return null;
  } catch (err) {
    // RPC failure path. Only fall back to the indexer mirror when explicitly
    // opted-in via env flag (e.g. for read-only ops during RPC degradation).
    // Default-deny so a Helius outage can't open the redirect attack window.
    if (process.env.ALLOW_UNIVERSE_CREATOR_MIRROR_FALLBACK === 'true' && firebaseAvailable) {
      try {
        const doc = await db.collection('solanaUniverses').doc(universePda).get();
        if (!doc.exists) return null;
        const data = doc.data() as { creator?: string };
        if (!data.creator) return null;
        return new PublicKey(data.creator);
      } catch {
        return null;
      }
    }
    // Re-throw so the route surfaces a 500 rather than silently 404 — caller
    // distinguishes "no such universe" (404) from "RPC down" (500).
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Decode `platform` (offset 64) out of a Subscription `Config` account body.
 * Layout per `programs/subscription/src/lib.rs`:
 *   admin(32) pending_admin(32) platform(32) ...
 * We avoid pulling the program's IDL just to read one field.
 */
async function resolveSubscriptionPlatform(): Promise<PublicKey> {
  const { deriveSubscriptionConfigPda } = await import('../lib/anchor-ix');
  const programIdStr = process.env.SUBSCRIPTION_PROGRAM_ID;
  if (!programIdStr) throw new Error('SUBSCRIPTION_PROGRAM_ID is not set');
  const programId = new PublicKey(programIdStr);
  const [configPda] = deriveSubscriptionConfigPda(programId);
  const conn = getSolanaConnection();
  const acct = await conn.getAccountInfo(configPda, 'confirmed');
  if (!acct) throw new Error('subscription program is not initialized');
  const body = acct.data.subarray(8);
  return new PublicKey(body.subarray(64, 96));
}

// ── 1. Licensing ───────────────────────────────────────────────────────────

const licensingBuyBody = z.object({
  contentHashHex: z.string().regex(HEX32_RE, 'expected 0x + 64 hex chars'),
});

solanaRoutes.post('/licensing/buy', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.license')) return denyScope(c, 'solana.license');

  const parsed = licensingBuyBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await licensingBuyContent({
      buyerUserId: auth.user.uid,
      contentHash: hexBytes(parsed.data.contentHashHex),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'license buy failed' }, 500);
  }
});

// Public read — registration is content-addressed, no auth required.
solanaRoutes.get('/licensing/registration/:hashHex', async (c) => {
  const hashHex = c.req.param('hashHex');
  if (!HEX32_RE.test(hashHex)) return c.json({ error: 'invalid contentHashHex' }, 400);
  try {
    const result = await licensingReadRegistration(hexBytes(hashHex));
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// Identity-scoped read — does the caller hold a BuyerDeal for this content?
solanaRoutes.get('/licensing/access', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  const hashHex = c.req.query('contentHashHex');
  if (!hashHex || !HEX32_RE.test(hashHex)) {
    return c.json({ error: 'contentHashHex query param required' }, 400);
  }
  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    const access = await licensingHasAccess(hexBytes(hashHex), new PublicKey(wallet.address));
    return c.json({ contentHashHex: hashHex, address: wallet.address, hasAccess: access });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 2. Canon Market (vote) ─────────────────────────────────────────────────

const canonVoteBody = z.object({
  universe: z.string().regex(SOL_ADDR_RE, 'invalid Solana address'),
  contentHashHex: z.string().regex(HEX32_RE, 'expected 0x + 64 hex chars'),
  support: z.boolean(),
  amount: z.string().regex(/^\d+$/, 'amount must be a decimal integer string (token base units)'),
});

solanaRoutes.post('/canon-market/vote', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.canon.vote')) return denyScope(c, 'solana.canon.vote');

  const parsed = canonVoteBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await canonMarketVote({
      voterUserId: auth.user.uid,
      universe: new PublicKey(parsed.data.universe),
      contentHash: hexBytes(parsed.data.contentHashHex),
      support: parsed.data.support,
      amount: BigInt(parsed.data.amount),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'vote failed' }, 500);
  }
});

solanaRoutes.get('/canon-market/submission', async (c) => {
  const universe = c.req.query('universe');
  const hashHex = c.req.query('contentHashHex');
  if (!universe || !SOL_ADDR_RE.test(universe)) {
    return c.json({ error: 'universe query param required' }, 400);
  }
  if (!hashHex || !HEX32_RE.test(hashHex)) {
    return c.json({ error: 'contentHashHex query param required' }, 400);
  }
  try {
    const result = await canonMarketReadSubmission(new PublicKey(universe), hexBytes(hashHex));
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 3. Staking ─────────────────────────────────────────────────────────────

const stakeBody = z.object({
  amount: z.string().regex(/^\d+$/, 'amount must be a decimal integer string (base units)'),
});

solanaRoutes.post('/staking/stake', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.stake')) return denyScope(c, 'solana.stake');

  const parsed = stakeBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await stakingStake({
      userUserId: auth.user.uid,
      amount: BigInt(parsed.data.amount),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'stake failed' }, 500);
  }
});

const unstakeBody = z.object({
  amount: z.string().regex(/^\d+$/, 'amount must be a decimal integer string (base units)'),
  penaltyDestinationAta: z.string().regex(SOL_ADDR_RE, 'invalid Solana address'),
});

solanaRoutes.post('/staking/unstake', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.stake')) return denyScope(c, 'solana.stake');

  const parsed = unstakeBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await stakingUnstake({
      userUserId: auth.user.uid,
      amount: BigInt(parsed.data.amount),
      penaltyDestinationAta: new PublicKey(parsed.data.penaltyDestinationAta),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'unstake failed' }, 500);
  }
});

solanaRoutes.get('/staking/info', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    const result = await stakingReadInfo(new PublicKey(wallet.address));
    return c.json({ address: wallet.address, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 4. Credit Manager ──────────────────────────────────────────────────────

const creditsPurchaseBody = z.object({
  packageId: z.string().regex(/^\d+$/, 'packageId must be a decimal integer string'),
});

solanaRoutes.post('/credits/purchase-sol', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.credits')) return denyScope(c, 'solana.credits');

  const parsed = creditsPurchaseBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await creditsPurchaseSol({
      buyerUserId: auth.user.uid,
      packageId: BigInt(parsed.data.packageId),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'purchase failed' }, 500);
  }
});

solanaRoutes.post('/credits/purchase-loar', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.credits')) return denyScope(c, 'solana.credits');

  const parsed = creditsPurchaseBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await creditsPurchaseLoar({
      buyerUserId: auth.user.uid,
      packageId: BigInt(parsed.data.packageId),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'purchase failed' }, 500);
  }
});

solanaRoutes.get('/credits/balance', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    const result = await creditsReadBalance(new PublicKey(wallet.address));
    return c.json({ address: wallet.address, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 5. Subscription ────────────────────────────────────────────────────────

const subscribeBody = z.object({
  universe: z.string().regex(SOL_ADDR_RE, 'invalid Solana address'),
  tierId: z.number().int().min(0).max(3),
  months: z.number().int().min(1).max(60),
});

solanaRoutes.post('/subscription/subscribe', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.subscribe')) return denyScope(c, 'solana.subscribe');

  const parsed = subscribeBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const universe = new PublicKey(parsed.data.universe);
    const creator = await resolveUniverseCreator(parsed.data.universe);
    if (!creator) {
      return c.json({ error: 'universe not found in Solana mirror', code: 'NOT_FOUND' }, 404);
    }
    const platformTreasury = await resolveSubscriptionPlatform();
    const result = await subscriptionSubscribe({
      subscriberUserId: auth.user.uid,
      universe,
      creator,
      platformTreasury,
      tierId: parsed.data.tierId,
      months: parsed.data.months,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'subscribe failed' }, 500);
  }
});

solanaRoutes.get('/subscription/status', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  const universe = c.req.query('universe');
  if (!universe || !SOL_ADDR_RE.test(universe)) {
    return c.json({ error: 'universe query param required' }, 400);
  }
  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    const result = await subscriptionRead(new PublicKey(wallet.address), new PublicKey(universe));
    return c.json({ address: wallet.address, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 6. Bonding Curve ───────────────────────────────────────────────────────

const curveBuyBody = z.object({
  universe: z.string().regex(SOL_ADDR_RE, 'invalid Solana address'),
  solInMaxLamports: z.string().regex(/^\d+$/, 'lamports must be a decimal integer string'),
  minTokensOut: z.string().regex(/^\d+$/, 'must be a decimal integer string'),
  deadlineSecs: z.string().regex(/^\d+$/).optional(),
});

solanaRoutes.post('/bonding-curve/buy', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.curve')) return denyScope(c, 'solana.curve');

  const parsed = curveBuyBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await curveBuy({
      buyerUserId: auth.user.uid,
      universe: new PublicKey(parsed.data.universe),
      solInMaxLamports: BigInt(parsed.data.solInMaxLamports),
      minTokensOut: BigInt(parsed.data.minTokensOut),
      deadlineSecs: parsed.data.deadlineSecs ? BigInt(parsed.data.deadlineSecs) : undefined,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'buy failed' }, 500);
  }
});

const curveSellBody = z.object({
  universe: z.string().regex(SOL_ADDR_RE, 'invalid Solana address'),
  tokenAmount: z.string().regex(/^\d+$/, 'must be a decimal integer string'),
  minSolOutLamports: z.string().regex(/^\d+$/, 'must be a decimal integer string'),
  deadlineSecs: z.string().regex(/^\d+$/).optional(),
});

solanaRoutes.post('/bonding-curve/sell', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.curve')) return denyScope(c, 'solana.curve');

  const parsed = curveSellBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await curveSell({
      sellerUserId: auth.user.uid,
      universe: new PublicKey(parsed.data.universe),
      tokenAmount: BigInt(parsed.data.tokenAmount),
      minSolOutLamports: BigInt(parsed.data.minSolOutLamports),
      deadlineSecs: parsed.data.deadlineSecs ? BigInt(parsed.data.deadlineSecs) : undefined,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'sell failed' }, 500);
  }
});

solanaRoutes.get('/bonding-curve/state', async (c) => {
  const universe = c.req.query('universe');
  if (!universe || !SOL_ADDR_RE.test(universe)) {
    return c.json({ error: 'universe query param required' }, 400);
  }
  try {
    const result = await curveReadState(new PublicKey(universe));
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 7. Fee Locker ──────────────────────────────────────────────────────────

const feeClaimBody = z.object({
  mint: z.string().regex(SOL_ADDR_RE, 'invalid Solana mint address'),
});

solanaRoutes.post('/fee-locker/claim', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.fees')) return denyScope(c, 'solana.fees');

  const parsed = feeClaimBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await feeLockerClaim({
      feeOwnerUserId: auth.user.uid,
      mint: new PublicKey(parsed.data.mint),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'claim failed' }, 500);
  }
});

solanaRoutes.get('/fee-locker/balance', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  const mint = c.req.query('mint');
  if (!mint || !SOL_ADDR_RE.test(mint)) {
    return c.json({ error: 'mint query param required' }, 400);
  }
  try {
    const wallet = await getOrCreateSolanaWallet(auth.user.uid);
    const result = await feeLockerReadBalance(new PublicKey(wallet.address), new PublicKey(mint));
    return c.json({ address: wallet.address, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 8. Premium Actions ─────────────────────────────────────────────────────

const premiumActionBody = z
  .object({
    // Accept either a human label (sha256'd server-side) OR a pre-hashed 32-byte
    // action name as 0x-hex. Mirrors the EVM convention where labels resolve to
    // bytes32 keys.
    //
    // H-6: labels are restricted to the canonical PREMIUM_ACTION_LABELS allowlist
    // (matches the EVM `PremiumActions.BurnAction` enum). Rejecting arbitrary
    // strings prevents callers from "executing" actions that don't exist on-chain
    // or that were never meant to be user-callable.
    label: z.enum(PREMIUM_ACTION_LABELS as unknown as [string, ...string[]]).optional(),
    actionHex: z.string().regex(HEX32_RE).optional(),
  })
  .refine((v) => Boolean(v.label) !== Boolean(v.actionHex), {
    message: 'provide exactly one of { label, actionHex }',
  });

solanaRoutes.post('/premium-actions/execute', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.premium')) return denyScope(c, 'solana.premium');

  const parsed = premiumActionBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const action = parsed.data.actionHex
      ? hexBytes(parsed.data.actionHex)
      : (parsed.data.label as string);
    const result = await premiumExecuteAction({
      userUserId: auth.user.uid,
      action,
    });
    return c.json({
      ...result,
      costLamports: result.costLamports.toString(),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'execute failed' }, 500);
  }
});

// Public read uses a /read/ sub-path so the Circle-config middleware bypass
// prefix can't accidentally match POST /premium-actions/execute (which still
// needs Circle to sign).
solanaRoutes.get('/premium-actions/read/:label', async (c) => {
  const label = c.req.param('label');
  if (!label) return c.json({ error: 'label path param required' }, 400);
  try {
    const result = await premiumReadAction(label);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});

// ── 9. Remix Fees ──────────────────────────────────────────────────────────

const remixFeeBody = z.object({
  universe: z.string().regex(SOL_ADDR_RE, 'invalid Solana address'),
  contentHashHex: z.string().regex(HEX32_RE, 'expected 0x + 64 hex chars'),
});

solanaRoutes.post('/remix-fees/charge', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.remix')) return denyScope(c, 'solana.remix');

  const parsed = remixFeeBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const creator = await resolveUniverseCreator(parsed.data.universe);
    if (!creator) {
      return c.json({ error: 'universe not found in Solana mirror', code: 'NOT_FOUND' }, 404);
    }
    const result = await chargeRemixFee({
      remixerUserId: auth.user.uid,
      universe: new PublicKey(parsed.data.universe),
      originalCreator: creator,
      contentHash: hexBytes(parsed.data.contentHashHex),
    });
    return c.json({ ...result, feeLamports: result.feeLamports.toString() });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'charge failed' }, 500);
  }
});

// ── 10. Split Router ───────────────────────────────────────────────────────

// H-3: platformFeeBps removed from the request body — clients can no longer
// set it. The handler hardcodes SPLIT_ROUTER_PLATFORM_FEE_BPS instead.
const splitRouteBody = z.object({
  entityHashHex: z.string().regex(HEX32_RE, 'expected 0x + 64 hex chars'),
  amountLamports: z.string().regex(/^\d+$/, 'must be a decimal integer string'),
});

solanaRoutes.post('/split-router/route', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;
  if (!requireScope(auth.user, 'solana.splits')) return denyScope(c, 'solana.splits');

  const parsed = splitRouteBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  try {
    await getOrCreateSolanaWallet(auth.user.uid);
    const result = await splitRouterRoute({
      payerUserId: auth.user.uid,
      entityHash: hexBytes(parsed.data.entityHashHex),
      amountLamports: BigInt(parsed.data.amountLamports),
      platformFeeBps: SPLIT_ROUTER_PLATFORM_FEE_BPS,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'route failed' }, 500);
  }
});

solanaRoutes.get('/split-router/splits/:hashHex', async (c) => {
  const hashHex = c.req.param('hashHex');
  if (!HEX32_RE.test(hashHex)) return c.json({ error: 'invalid entityHashHex' }, 400);
  try {
    const result = await splitRouterReadSplits(hexBytes(hashHex));
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'read failed' }, 500);
  }
});
