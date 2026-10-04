/**
 * Launchpad — public, read-only token discovery for clients without their own
 * indexer access (mobile). Backed by the Ponder indexer; short in-memory cache
 * because every miss fans out to several indexer queries.
 */
import { z } from 'zod';
import { formatEther, getAddress, parseEther, type Address } from 'viem';
import { TRPCError } from '@trpc/server';
import { publicProcedure, router } from '../../lib/trpc';
import { ponderQuery } from '../../lib/ponder';
import { getChainClient } from '../../lib/chain-client';
import {
  buildLaunchpadRows,
  type LaunchpadRow,
  type RawCurve,
  type RawHolder,
  type RawPool,
  type RawToken,
} from '../../services/launchpad';

const TTL_MS = 15_000;

/** Launchpad curves live on the indexer's chain (Sepolia). */
const CURVE_CHAIN_ID = Number(process.env.PONDER_CHAIN_ID ?? 11155111);
const DEFAULT_SLIPPAGE_BPS = 500;
const TRADE_DEADLINE_SECS = 300;

const CURVE_READ_ABI = [
  {
    name: 'getTokensForEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'ethAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEthForTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ERC20_READ_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const applySlippage = (amount: bigint, bps: number) => (amount * BigInt(10_000 - bps)) / 10_000n;
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

  /**
   * Bonding-curve trade quote for clients with no chain access (mobile).
   * Returns every amount as a wei string, ready to pass straight to
   * POST /api/tx/write as `buy(minTokensOut, deadline)` with `value`, or
   * `sell(tokenAmount, minEthOut, deadline)` after an `approve` when
   * `needsApproval`. Balances/allowance are included when signed in.
   */
  quote: publicProcedure
    .input(
      z.object({
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        side: z.enum(['buy', 'sell']),
        /** ETH for a buy, whole tokens for a sell (18 decimals either way). */
        amount: z.string().regex(/^\d{1,18}(\.\d{1,18})?$/),
        slippageBps: z.number().int().min(0).max(5000).default(DEFAULT_SLIPPAGE_BPS),
      })
    )
    .query(async ({ input, ctx }) => {
      const token = getAddress(input.address);
      const cd = await ponderQuery<{
        bondingCurves: {
          items: { id: string; graduated: boolean; tradingStatus: string | null }[];
        };
      }>(
        `query ($a: String!) { bondingCurves(where: { tokenAddress: $a }, limit: 1) { items { id graduated tradingStatus } } }`,
        { a: token.toLowerCase() }
      );
      const curveRow = cd?.bondingCurves?.items?.[0];
      if (!curveRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No bonding curve for this token' });
      }
      if (curveRow.graduated || curveRow.tradingStatus === 'graduated') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This token has graduated to Uniswap — trade it on loar.fun',
        });
      }
      if (curveRow.tradingStatus === 'halted') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Trading is halted' });
      }
      const curve = getAddress(curveRow.id);
      const amountWei = parseEther(input.amount);
      if (amountWei === 0n) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Amount must be greater than 0' });
      }

      const client = getChainClient(CURVE_CHAIN_ID);
      let expectedOut: bigint;
      try {
        expectedOut = (await client.readContract({
          address: curve,
          abi: CURVE_READ_ABI,
          functionName: input.side === 'buy' ? 'getTokensForEth' : 'getEthForTokens',
          args: [amountWei],
        })) as bigint;
      } catch {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Could not quote the curve' });
      }
      if (expectedOut === 0n) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            input.side === 'buy'
              ? 'Quote returned zero tokens — the curve may be sold out'
              : 'Quote returned zero ETH — not enough liquidity on the curve',
        });
      }

      const holder = ctx.user?.apiKeyId ? undefined : (ctx.user?.address as Address | undefined);
      let tokenBalance: bigint | null = null;
      let ethBalance: bigint | null = null;
      let allowance: bigint | null = null;
      if (holder && /^0x[0-9a-fA-F]{40}$/.test(holder)) {
        [tokenBalance, ethBalance, allowance] = await Promise.all([
          client.readContract({
            address: token,
            abi: ERC20_READ_ABI,
            functionName: 'balanceOf',
            args: [holder],
          }) as Promise<bigint>,
          client.getBalance({ address: holder }),
          client.readContract({
            address: token,
            abi: ERC20_READ_ABI,
            functionName: 'allowance',
            args: [holder, curve],
          }) as Promise<bigint>,
        ]).catch(() => [null, null, null] as const);
      }

      const minOut = applySlippage(expectedOut, input.slippageBps);
      return {
        chainId: CURVE_CHAIN_ID,
        token,
        curve,
        side: input.side,
        amountWei: amountWei.toString(),
        expectedOutWei: expectedOut.toString(),
        expectedOut: formatEther(expectedOut),
        minOutWei: minOut.toString(),
        deadline: Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECS,
        tokenBalance: tokenBalance?.toString() ?? null,
        ethBalance: ethBalance?.toString() ?? null,
        needsApproval: input.side === 'sell' && allowance !== null && allowance < amountWei,
      };
    }),
});
