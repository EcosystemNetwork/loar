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
import { canonizeEpisode } from '../services/solana/canon-promote';

export const solanaRoutes = new Hono();

solanaRoutes.use('*', async (c, next) => {
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

// ── Episode mint (Bubblegum cNFT) ──────────────────────────────────────────

const mintBody = z.object({
  universeAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid Solana address'),
  /** 32-byte content hash as 0x-prefixed hex (matches EVM bytes32 shape). */
  contentHashHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x + 64 hex chars'),
  metadataUri: z.string().url().max(200),
  title: z.string().min(1).max(64),
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
solanaRoutes.post('/episode/canonize', async (c) => {
  const auth = await requireAuth(c);
  if (!auth.user) return auth.res;

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
    return c.json({ error: err instanceof Error ? err.message : 'Canonize failed' }, 500);
  }
});
