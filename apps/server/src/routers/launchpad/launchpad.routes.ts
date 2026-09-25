/**
 * Launchpad — public, read-only token discovery for clients without their own
 * indexer access (mobile). Backed by the Ponder indexer; short in-memory cache
 * because every miss fans out to several indexer queries.
 */
import { z } from 'zod';
import { getAddress } from 'viem';
import { TRPCError } from '@trpc/server';
import { publicProcedure, router } from '../../lib/trpc';
import { ponderQuery } from '../../lib/ponder';
import {
  buildLaunchpadRows,
  type LaunchpadRow,
  type RawCurve,
  type RawHolder,
  type RawPool,
  type RawToken,
} from '../../services/launchpad';

const TTL_MS = 15_000;
let cache: { at: number; rows: LaunchpadRow[] } | null = null;

async function loadRows(): Promise<LaunchpadRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const data = await ponderQuery<{
    tokens: { items: RawToken[] };
    bondingCurves: { items: RawCurve[] };
    tokenHolders: { items: RawHolder[] };
  }>(`query {
    tokens(orderBy: "createdAt", orderDirection: "desc", limit: 100) {
      items { id name symbol imageURL metadata deployer poolId createdAt }
    }
    bondingCurves(limit: 500) { items { id tokenAddress graduationEth graduated tradingStatus tokensSold ethRaised } }
    tokenHolders(limit: 1000) { items { tokenAddress holderAddress balance } }
  }`);
  if (!data?.tokens?.items) {
    if (cache) return cache.rows; // serve stale rather than fail the screen
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Indexer unavailable' });
  }

  // Pools only matter for graduated tokens (post-graduation price).
  const graduatedPoolIds = data.tokens.items
    .filter((t) => {
      const c = data.bondingCurves.items.find(
        (x) => x.tokenAddress.toLowerCase() === t.id.toLowerCase()
      );
      return !c || c.graduated || c.tradingStatus === 'graduated';
    })
    .map((t) => t.poolId)
    .filter((id) => /^0x[0-9a-fA-F]{64}$/.test(id) && !/^0x0+$/.test(id))
    .slice(0, 25);
  let pools: RawPool[] = [];
  if (graduatedPoolIds.length) {
    const aliases = graduatedPoolIds
      .map((id, i) => `p${i}: pool(poolId: "${id}") { poolId currency0 sqrtPriceX96 }`)
      .join('\n');
    const pd = await ponderQuery<Record<string, RawPool | null>>(`query { ${aliases} }`);
    pools = Object.values(pd ?? {}).filter((p): p is RawPool => !!p);
  }

  const rows = buildLaunchpadRows({
    tokens: data.tokens.items,
    curves: data.bondingCurves?.items ?? [],
    holders: data.tokenHolders?.items ?? [],
    pools,
  });
  cache = { at: Date.now(), rows };
  return rows;
}

export const launchpadRouter = router({
  /** Tokens, biggest market cap first (untraded last, newest first among those). */
  list: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).default({ limit: 30 }))
    .query(async ({ input }) => {
      const rows = await loadRows();
      const sorted = [...rows].sort(
        (a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || b.createdAt - a.createdAt
      );
      return { tokens: sorted.slice(0, input.limit), king: rows.find((r) => r.isKing) ?? null };
    }),

  get: publicProcedure
    .input(z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }))
    .query(async ({ input }) => {
      const id = getAddress(input.address).toLowerCase();
      const row = (await loadRows()).find((r) => r.id.toLowerCase() === id);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' });
      return row;
    }),
});
