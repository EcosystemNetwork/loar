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
import { verifyAuth } from '../lib/auth';
import {
  getOrCreateSolanaWallet,
  getSolanaTransactionStatus,
  getSolanaWalletBalances,
  isCircleSolanaConfigured,
  activeCluster,
} from '../lib/circle-solana';

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
