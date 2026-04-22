/**
 * useTokens — hooks for token discovery, analytics, swap history, and holder data.
 *
 * Fetches all token data from the Ponder indexer for the launchpad and token detail pages.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  ponderGql,
  ponderQueryDefaults,
  type Token,
  type Swap,
  type TokenHolder,
} from '@/utils/ponder-api';
import { useVisibilityAwareInterval, jitteredInterval, POLL_INTERVALS } from './useSmartPolling';

// ─── List all launched tokens ──────────────────────────────────────────

export interface TokenWithUniverse extends Token {
  universeName: string;
  universeImage: string;
  holderCount?: number;
  swapCount?: number;
  latestPrice?: string;
}

export function useAllTokens() {
  return useQuery({
    queryKey: ['all-tokens'],
    queryFn: async () => {
      const data = await ponderGql<{
        tokens: { items: Token[] };
      }>(
        `query {
          tokens(orderBy: "createdAt", orderDirection: "desc", limit: 100) {
            items {
              id
              name
              symbol
              imageURL
              universeAddress
              deployer
              tokenAdmin
              metadata
              context
              startingTick
              poolHook
              poolId
              pairedToken
              locker
              createdAt
            }
          }
        }`
      );
      return data.tokens.items;
    },
    ...ponderQueryDefaults,
  });
}

// ─── Token detail with universe info ───────────────────────────────────

export function useTokenDetail(tokenAddress: string | undefined) {
  return useQuery({
    queryKey: ['token-detail', tokenAddress],
    queryFn: async () => {
      const data = await ponderGql<{
        token: Token | null;
        tokenHolders: { items: TokenHolder[] };
      }>(
        `query ($tokenAddress: String!) {
          token(id: $tokenAddress) {
            id
            name
            symbol
            imageURL
            universeAddress
            deployer
            tokenAdmin
            metadata
            context
            startingTick
            poolHook
            poolId
            pairedToken
            locker
            createdAt
          }
          tokenHolders(where: { tokenAddress: $tokenAddress }, limit: 50, orderBy: "balance", orderDirection: "desc") {
            items {
              id
              tokenAddress
              holderAddress
              balance
            }
          }
        }`,
        { tokenAddress: tokenAddress!.toLowerCase() }
      );
      return {
        token: data.token,
        holders: data.tokenHolders.items,
      };
    },
    enabled: !!tokenAddress,
    ...ponderQueryDefaults,
  });
}

// ─── Swap history for a token's pool ───────────────────────────────────

export function useSwapHistory(poolId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ['swap-history', poolId, limit],
    queryFn: async () => {
      const data = await ponderGql<{
        swaps: { items: Swap[] };
      }>(
        `query ($poolId: String!, $limit: Int!) {
          swaps(where: { poolId: $poolId }, orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
            items {
              id
              poolId
              sender
              amount0
              amount1
              sqrtPriceX96
              liquidity
              tick
              timestamp
              blockNumber
            }
          }
        }`,
        { poolId, limit }
      );
      return data.swaps.items;
    },
    enabled: !!poolId,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

// ─── Swap history for a specific user (across all pools) ──────────────

export function useMySwapHistory(address: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ['my-swap-history', address, limit],
    queryFn: async () => {
      const data = await ponderGql<{
        swaps: { items: Swap[] };
      }>(
        `query ($sender: String!, $limit: Int!) {
          swaps(where: { sender: $sender }, orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
            items {
              id
              poolId
              sender
              amount0
              amount1
              sqrtPriceX96
              liquidity
              tick
              timestamp
              blockNumber
            }
          }
        }`,
        { sender: address!.toLowerCase(), limit }
      );
      return data.swaps.items;
    },
    enabled: !!address,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

// ─── Token holders ─────────────────────────────────────────────────────

export function useTokenHolders(tokenAddress: string | undefined) {
  return useQuery({
    queryKey: ['token-holders', tokenAddress],
    queryFn: async () => {
      const data = await ponderGql<{
        tokenHolders: { items: TokenHolder[] };
      }>(
        `query ($tokenAddress: String!) {
          tokenHolders(where: { tokenAddress: $tokenAddress }, orderBy: "balance", orderDirection: "desc", limit: 100) {
            items {
              id
              tokenAddress
              holderAddress
              balance
            }
          }
        }`,
        { tokenAddress: tokenAddress!.toLowerCase() }
      );
      return data.tokenHolders.items;
    },
    enabled: !!tokenAddress,
    ...ponderQueryDefaults,
  });
}

// ─── Pool data ─────────────────────────────────────────────────────────

export interface PoolData {
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  sqrtPriceX96: string | null;
  tick: number | null;
  creationBlock: number;
}

export function usePoolData(poolId: string | undefined) {
  return useQuery({
    queryKey: ['pool-data', poolId],
    queryFn: async () => {
      const data = await ponderGql<{
        pool: PoolData | null;
      }>(
        `query ($poolId: String!) {
          pool(poolId: $poolId) {
            poolId
            currency0
            currency1
            fee
            tickSpacing
            hooks
            sqrtPriceX96
            tick
            creationBlock
          }
        }`,
        { poolId }
      );
      return data.pool;
    },
    enabled: !!poolId,
    ...ponderQueryDefaults,
  });
}

// ─── Bonding curve data ────────────────────────────────────────────────

export interface BondingCurveData {
  id: string;
  tokenAddress: string;
  universeId: number;
  graduationEth: string;
  curveSupply: string;
  graduated: boolean;
  graduatedAt: number | null;
  createdAt: number;
  tradingStatus: 'active' | 'halted' | 'graduated';
  tokensSold: string;
  ethRaised: string;
  lastPrice: string;
  tradeCount: number;
}

export function useBondingCurveForToken(tokenAddress: string | undefined) {
  return useQuery({
    queryKey: ['bonding-curve-for-token', tokenAddress],
    queryFn: async () => {
      const data = await ponderGql<{
        bondingCurves: { items: BondingCurveData[] };
      }>(
        `query ($tokenAddress: String!) {
          bondingCurves(where: { tokenAddress: $tokenAddress }, limit: 1) {
            items {
              id tokenAddress universeId graduationEth curveSupply
              graduated graduatedAt createdAt tradingStatus
              tokensSold ethRaised lastPrice tradeCount
            }
          }
        }`,
        { tokenAddress: tokenAddress!.toLowerCase() }
      );
      return data.bondingCurves?.items?.[0] ?? null;
    },
    enabled: !!tokenAddress,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

export type TokenStage = 'bonding' | 'graduating' | 'graduated' | 'halted';

export function stageFromBondingCurve(curve: BondingCurveData | null | undefined): TokenStage {
  if (!curve) return 'graduated'; // pools without bonding curve are post-graduation
  if (curve.tradingStatus === 'halted') return 'halted';
  if (curve.graduated || curve.tradingStatus === 'graduated') return 'graduated';
  const raised = Number(BigInt(curve.ethRaised)) / 1e18;
  const target = Number(BigInt(curve.graduationEth)) / 1e18;
  if (target > 0 && raised / target >= 0.75) return 'graduating';
  return 'bonding';
}

// ─── User portfolio, derived from the indexer (not client-recorded) ────

export interface UserBondingTrade {
  id: string;
  bondingCurve: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ethAmount: string;
  tokenAmount: string;
  price: string;
  timestamp: number;
}

/**
 * Fetch all bonding-curve trades for a user, joined against the curve table to
 * resolve each curve → tokenAddress. Returns [] if the indexer doesn't expose
 * bondingCurves (older schema on some chains).
 */
export function useUserBondingCurveTrades(userAddress: string | undefined) {
  return useQuery({
    queryKey: ['user-bonding-curve-trades', userAddress?.toLowerCase()],
    queryFn: async (): Promise<UserBondingTrade[]> => {
      const trader = userAddress!.toLowerCase();
      try {
        const [tradesRes, curvesRes] = await Promise.all([
          ponderGql<{
            bondingCurveTrades: {
              items: {
                id: string;
                bondingCurve: string;
                trader: string;
                isBuy: boolean;
                ethAmount: string;
                tokenAmount: string;
                price: string;
                timestamp: number;
              }[];
            };
          }>(
            `query ($trader: String!) {
              bondingCurveTrades(
                where: { trader: $trader }
                orderBy: "timestamp"
                orderDirection: "desc"
                limit: 500
              ) {
                items { id bondingCurve trader isBuy ethAmount tokenAmount price timestamp }
              }
            }`,
            { trader }
          ),
          ponderGql<{
            bondingCurves: { items: { id: string; tokenAddress: string }[] };
          }>(`query { bondingCurves(limit: 500) { items { id tokenAddress } } }`),
        ]);

        const curveToToken = new Map<string, string>();
        for (const c of curvesRes.bondingCurves.items) {
          curveToToken.set(c.id.toLowerCase(), c.tokenAddress);
        }
        return tradesRes.bondingCurveTrades.items.map((t) => ({
          ...t,
          tokenAddress: curveToToken.get(t.bondingCurve.toLowerCase()) ?? '',
        }));
      } catch {
        // Older indexer schemas (e.g. Sepolia) don't expose bondingCurves —
        // portfolio falls back to swap-only view, no fatal error.
        return [];
      }
    },
    enabled: !!userAddress,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

export interface UserHolding {
  tokenAddress: string;
  balance: string;
}

export function useUserTokenHoldings(userAddress: string | undefined) {
  return useQuery({
    queryKey: ['user-token-holdings', userAddress?.toLowerCase()],
    queryFn: async (): Promise<UserHolding[]> => {
      const holder = userAddress!.toLowerCase();
      const data = await ponderGql<{
        tokenHolders: {
          items: { tokenAddress: string; balance: string }[];
        };
      }>(
        `query ($holder: String!) {
          tokenHolders(where: { holderAddress: $holder }, limit: 500) {
            items { tokenAddress balance }
          }
        }`,
        { holder }
      );
      return data.tokenHolders.items;
    },
    enabled: !!userAddress,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

export interface PortfolioPosition {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  imageURL: string;
  currentPrice: number | null;
  netTokens: number; // from on-chain balance — authoritative
  totalBoughtEth: number;
  totalBoughtTokens: number;
  totalSoldEth: number;
  totalSoldTokens: number;
  avgBuyPrice: number; // ETH per token
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  currentValue: number;
  tradeCount: number;
  firstTrade: number | null;
  lastTrade: number | null;
}

export interface PortfolioSummary {
  positions: PortfolioPosition[];
  totalValue: number;
  totalRealizedPnL: number;
  totalUnrealizedPnL: number;
  totalPnL: number;
  totalTrades: number;
}

/**
 * Indexer-derived portfolio. Joins the user's bonding-curve trades + their
 * Uniswap v4 swaps + their current holder balances against the token list.
 * This replaces the old client-recorded `tokenSocial.getPortfolio` which missed
 * any swap not recorded through the in-app UI.
 */
export function useIndexerPortfolio(userAddress: string | undefined): {
  data: PortfolioSummary;
  isLoading: boolean;
} {
  const tokens = useTokenListData();
  const trades = useUserBondingCurveTrades(userAddress);
  const holdings = useUserTokenHoldings(userAddress);
  const swaps = useMySwapHistory(userAddress, 500);

  const data = useMemo<PortfolioSummary>(() => {
    if (!userAddress)
      return {
        positions: [],
        totalValue: 0,
        totalRealizedPnL: 0,
        totalUnrealizedPnL: 0,
        totalPnL: 0,
        totalTrades: 0,
      };

    // Index tokens by address (lowercased) and poolId.
    const byAddr = new Map<string, EnrichedToken>();
    const byPool = new Map<string, EnrichedToken>();
    for (const t of tokens.data) {
      byAddr.set(t.id.toLowerCase(), t);
      byPool.set(t.poolId.toLowerCase(), t);
    }

    interface Agg {
      totalBoughtEth: number;
      totalBoughtTokens: number;
      totalSoldEth: number;
      totalSoldTokens: number;
      tradeCount: number;
      firstTrade: number | null;
      lastTrade: number | null;
    }
    const agg = new Map<string, Agg>();
    const bumpTrade = (addr: string, ts: number) => {
      const a = agg.get(addr)!;
      a.tradeCount++;
      a.firstTrade = a.firstTrade == null ? ts : Math.min(a.firstTrade, ts);
      a.lastTrade = a.lastTrade == null ? ts : Math.max(a.lastTrade, ts);
    };
    const ensure = (addr: string) => {
      if (!agg.has(addr)) {
        agg.set(addr, {
          totalBoughtEth: 0,
          totalBoughtTokens: 0,
          totalSoldEth: 0,
          totalSoldTokens: 0,
          tradeCount: 0,
          firstTrade: null,
          lastTrade: null,
        });
      }
    };

    // 1) Bonding-curve trades have exact ETH+token amounts already.
    for (const t of trades.data ?? []) {
      const addr = t.tokenAddress.toLowerCase();
      if (!addr) continue;
      ensure(addr);
      const ethF = Number(BigInt(t.ethAmount)) / 1e18;
      const tokF = Number(BigInt(t.tokenAmount)) / 1e18;
      const a = agg.get(addr)!;
      if (t.isBuy) {
        a.totalBoughtEth += ethF;
        a.totalBoughtTokens += tokF;
      } else {
        a.totalSoldEth += ethF;
        a.totalSoldTokens += tokF;
      }
      bumpTrade(addr, t.timestamp);
    }

    // 2) Uniswap v4 swaps — use signed amounts (amount0 = ETH for native-ETH
    //    pools). Positive amount0 = pool received ETH = user BUYS token.
    for (const s of swaps.data ?? []) {
      const token = byPool.get(s.poolId.toLowerCase());
      if (!token) continue;
      const addr = token.id.toLowerCase();
      ensure(addr);
      const a0 = BigInt(s.amount0);
      const a1 = BigInt(s.amount1);
      // For native-ETH pools, amount0 is ETH delta to the pool; amount1 is token delta.
      // Assumes currency0 = ETH. Non-ETH pools fall through but the amounts are
      // still meaningful as absolute ETH-equivalent via current pool price.
      const ethAbs = Number(a0 < 0n ? -a0 : a0) / 1e18;
      const tokAbs = Number(a1 < 0n ? -a1 : a1) / 1e18;
      const a = agg.get(addr)!;
      if (a0 > 0n) {
        a.totalBoughtEth += ethAbs;
        a.totalBoughtTokens += tokAbs;
      } else if (a0 < 0n) {
        a.totalSoldEth += ethAbs;
        a.totalSoldTokens += tokAbs;
      }
      bumpTrade(addr, s.timestamp);
    }

    // 3) Holdings — authoritative current balance per token.
    const balances = new Map<string, number>();
    for (const h of holdings.data ?? []) {
      const addr = h.tokenAddress.toLowerCase();
      const bal = Number(BigInt(h.balance)) / 1e18;
      balances.set(addr, bal);
    }

    // Build positions. Include any token the user has either traded or holds.
    const tokenAddrs = new Set<string>([...agg.keys(), ...balances.keys()]);
    const positions: PortfolioPosition[] = [];
    let totalValue = 0;
    let totalRealizedPnL = 0;
    let totalUnrealizedPnL = 0;
    let totalTrades = 0;

    for (const addr of tokenAddrs) {
      const t = byAddr.get(addr);
      if (!t) continue; // skip tokens we don't have metadata for
      const a = agg.get(addr) ?? {
        totalBoughtEth: 0,
        totalBoughtTokens: 0,
        totalSoldEth: 0,
        totalSoldTokens: 0,
        tradeCount: 0,
        firstTrade: null,
        lastTrade: null,
      };
      const netTokens = balances.get(addr) ?? 0;
      const avgBuyPrice = a.totalBoughtTokens > 0 ? a.totalBoughtEth / a.totalBoughtTokens : 0;
      const realizedPnL = a.totalSoldEth - a.totalSoldTokens * avgBuyPrice;
      const currentPrice = t.price;
      const currentValue = currentPrice != null ? netTokens * currentPrice : 0;
      const unrealizedPnL =
        currentPrice != null && netTokens > 0
          ? netTokens * currentPrice - netTokens * avgBuyPrice
          : 0;
      const totalPnL = realizedPnL + unrealizedPnL;

      totalValue += currentValue;
      totalRealizedPnL += realizedPnL;
      totalUnrealizedPnL += unrealizedPnL;
      totalTrades += a.tradeCount;

      positions.push({
        tokenAddress: t.id,
        tokenSymbol: t.symbol,
        tokenName: t.name,
        imageURL: t.imageURL,
        currentPrice,
        netTokens,
        totalBoughtEth: a.totalBoughtEth,
        totalBoughtTokens: a.totalBoughtTokens,
        totalSoldEth: a.totalSoldEth,
        totalSoldTokens: a.totalSoldTokens,
        avgBuyPrice,
        realizedPnL,
        unrealizedPnL,
        totalPnL,
        currentValue,
        tradeCount: a.tradeCount,
        firstTrade: a.firstTrade,
        lastTrade: a.lastTrade,
      });
    }

    positions.sort((a, b) => b.currentValue - a.currentValue);

    return {
      positions,
      totalValue,
      totalRealizedPnL,
      totalUnrealizedPnL,
      totalPnL: totalRealizedPnL + totalUnrealizedPnL,
      totalTrades,
    };
  }, [userAddress, tokens.data, trades.data, holdings.data, swaps.data]);

  return {
    data,
    isLoading: tokens.isLoading || trades.isLoading || holdings.isLoading || swaps.isLoading,
  };
}

// ─── Universe data for token cards ─────────────────────────────────────

export function useUniverseForToken(universeAddress: string | undefined) {
  return useQuery({
    queryKey: ['universe-for-token', universeAddress],
    queryFn: async () => {
      const data = await ponderGql<{
        universe: {
          id: string;
          universeId: number | null;
          name: string;
          description: string;
          imageURL: string;
          creator: string;
          nodeCount: number;
        } | null;
      }>(
        `query ($id: String!) {
          universe(id: $id) {
            id
            universeId
            name
            description
            imageURL
            creator
            nodeCount
          }
        }`,
        { id: universeAddress }
      );
      return data.universe;
    },
    enabled: !!universeAddress,
    ...ponderQueryDefaults,
  });
}

// ─── Price calculation helpers ─────────────────────────────────────────

/**
 * Calculate price from sqrtPriceX96 (Uniswap v4 format)
 * price = (sqrtPriceX96 / 2^96)^2
 */
export function priceFromSqrtX96(sqrtPriceX96: string): number {
  const sqrtPrice = Number(BigInt(sqrtPriceX96)) / 2 ** 96;
  return sqrtPrice * sqrtPrice;
}

/**
 * Compute price impact for a single-tick Uniswap v4 swap (constant-L approx).
 *
 * Math (token0 price measured in token1):
 *  - zeroForOne (sell token0 → token1): sqrtP' = (L · Q96 · sqrtP) / (L · Q96 + amountIn · sqrtP)
 *  - !zeroForOne (buy token0 with token1): sqrtP' = sqrtP + (amountIn · Q96) / L
 *
 * Impact = |price' − price| / price, where price = sqrtP².
 * This is accurate while the swap stays inside a single tick range. For large
 * trades that would cross ticks, it underestimates impact — good enough for a
 * UX signal, not for execution routing.
 *
 * Returns a percentage (e.g. 2.5 for 2.5%) or null when inputs are insufficient.
 */
export function computePriceImpactBps({
  sqrtPriceX96,
  liquidity,
  amountInWei,
  zeroForOne,
}: {
  sqrtPriceX96: string | null | undefined;
  liquidity: string | null | undefined;
  amountInWei: bigint;
  zeroForOne: boolean;
}): number | null {
  if (!sqrtPriceX96 || !liquidity || amountInWei <= 0n) return null;
  const sqrtP = BigInt(sqrtPriceX96);
  const L = BigInt(liquidity);
  if (sqrtP === 0n || L === 0n) return null;

  const Q96 = 1n << 96n;
  let sqrtPNext: bigint;

  if (zeroForOne) {
    // sqrtP' = (L * Q96 * sqrtP) / (L * Q96 + amountIn * sqrtP)
    const num = L * Q96 * sqrtP;
    const denom = L * Q96 + amountInWei * sqrtP;
    if (denom === 0n) return null;
    sqrtPNext = num / denom;
  } else {
    // sqrtP' = sqrtP + (amountIn * Q96) / L
    sqrtPNext = sqrtP + (amountInWei * Q96) / L;
  }

  // price ratio = (sqrtP'/sqrtP)² — work in floats for the final % (bigint ratios lose precision)
  const ratio = Number(sqrtPNext) / Number(sqrtP);
  const priceRatio = ratio * ratio;
  const impact = Math.abs(priceRatio - 1) * 100;
  return Math.min(impact, 99);
}

/**
 * Calculate price from tick
 * price = 1.0001^tick
 */
export function priceFromTick(tick: number): number {
  return Math.pow(1.0001, tick);
}

// sqrtPriceX96 at tick 0 — fresh pools that have never been traded sit at this
// exact value, which would otherwise render as a bogus "1.0 ETH" quote.
const SQRT_PRICE_X96_AT_TICK_0 = '79228162514264337593543950336';

/**
 * ETH-per-token quote for a Uniswap v4 pool paired against WETH.
 *
 * Uniswap pools are keyed by address order, so whether our token sits on
 * `currency0` or `currency1` depends on address comparison vs WETH. The raw
 * `sqrtPriceX96`/`tick` math yields `currency1/currency0`; inverting when the
 * token is `currency1` gets us back to "ETH per token" either way.
 * Returns null for untraded pools (tick 0 / initial sqrtPrice) so the UI can
 * show "--" instead of a misleading 1:1 quote.
 */
export function ethPricePerToken(
  pool:
    | {
        currency0: string;
        currency1: string;
        sqrtPriceX96: string | null;
        tick: number | null;
      }
    | null
    | undefined,
  tokenAddress: string
): number | null {
  if (!pool) return null;
  if (pool.sqrtPriceX96 === SQRT_PRICE_X96_AT_TICK_0) return null;
  if (pool.sqrtPriceX96 == null && (pool.tick == null || pool.tick === 0)) return null;

  const raw = pool.sqrtPriceX96
    ? priceFromSqrtX96(pool.sqrtPriceX96)
    : pool.tick != null
      ? priceFromTick(pool.tick)
      : null;
  if (raw == null || !Number.isFinite(raw) || raw === 0) return null;

  const tokenIsCurrency0 = pool.currency0.toLowerCase() === tokenAddress.toLowerCase();
  return tokenIsCurrency0 ? raw : 1 / raw;
}

/** ETH-per-token from a swap's tick, given which side of the pool the token sits on. */
export function ethPriceFromTick(tick: number, tokenIsCurrency0: boolean): number {
  const raw = priceFromTick(tick);
  return tokenIsCurrency0 ? raw : raw === 0 ? 0 : 1 / raw;
}

/**
 * Format token amount from raw bigint string (18 decimals)
 */
export function formatTokenAmount(raw: string, decimals = 18): string {
  const val = Number(BigInt(raw)) / 10 ** decimals;
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  if (val >= 1) return val.toFixed(2);
  if (val >= 0.001) return val.toFixed(4);
  return val.toExponential(2);
}

/**
 * Format ETH amount
 */
export function formatEth(raw: string): string {
  const val = Number(BigInt(raw)) / 1e18;
  if (Math.abs(val) >= 1000) return `${val.toFixed(1)} ETH`;
  if (Math.abs(val) >= 1) return `${val.toFixed(4)} ETH`;
  if (Math.abs(val) >= 0.001) return `${val.toFixed(6)} ETH`;
  return `${val.toExponential(2)} ETH`;
}

/**
 * Time ago helper
 */
export function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

// ─── Enriched token list for launchpad ────────────────────────────────

export interface EnrichedToken extends Token {
  price: number | null;
  priceChange24h: number | null;
  volume24h: number;
  swapCount24h: number;
  totalSwaps: number;
  holderCount: number;
  sparkline: number[];
  marketCap: number | null;
  bondingCurve: BondingCurveData | null;
  stage: TokenStage;
  graduationPct: number; // 0..100, 100 once graduated
  // Latest pool state pulled from the most recent swap (for price-impact math).
  // Null while the pool has no swaps yet or the token hasn't graduated.
  latestSqrtPriceX96: string | null;
  latestLiquidity: string | null;
  // Whether our token is currency0 in its pool. Consumers (activity feed,
  // impact math) need this to pick the right side when reading swap amounts
  // or inverting quotes.
  tokenIsCurrency0: boolean;
}

const TOTAL_SUPPLY = 1_000_000_000; // 1B tokens per universe

/**
 * Fetches tokens with enriched analytics: price, 24h change, volume,
 * holder counts, sparkline data, and market cap. Used by the launchpad listing.
 */
export function useTokenListData() {
  const tokensQuery = useAllTokens();

  // Fetch all pools to get current prices
  const poolsQuery = useQuery({
    queryKey: ['all-pools'],
    queryFn: async () => {
      const data = await ponderGql<{
        pools: { items: PoolData[] };
      }>(`query {
        pools(limit: 200) {
          items {
            poolId currency0 currency1 fee tickSpacing hooks sqrtPriceX96 tick creationBlock
          }
        }
      }`);
      return data.pools?.items ?? [];
    },
    ...ponderQueryDefaults,
  });

  // Fetch recent swaps (expanded limit for volume + sparkline + latest pool state)
  const swapsQuery = useQuery({
    queryKey: ['all-recent-swaps-enriched'],
    queryFn: async () => {
      const data = await ponderGql<{
        swaps: { items: Swap[] };
      }>(`query {
        swaps(orderBy: "timestamp", orderDirection: "desc", limit: 500) {
          items {
            id poolId sender amount0 amount1 tick timestamp sqrtPriceX96 liquidity
          }
        }
      }`);
      return data.swaps?.items ?? [];
    },
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });

  // Fetch all bonding curves to determine token stage
  const curvesQuery = useQuery({
    queryKey: ['all-bonding-curves'],
    queryFn: async () => {
      const data = await ponderGql<{
        bondingCurves: { items: BondingCurveData[] };
      }>(`query {
        bondingCurves(limit: 500) {
          items {
            id tokenAddress universeId graduationEth curveSupply
            graduated graduatedAt createdAt tradingStatus
            tokensSold ethRaised lastPrice tradeCount
          }
        }
      }`);
      return data.bondingCurves?.items ?? [];
    },
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });

  // Fetch all holder records to count per token
  const holdersQuery = useQuery({
    queryKey: ['all-holder-counts'],
    queryFn: async () => {
      const data = await ponderGql<{
        tokenHolders: { items: { tokenAddress: string }[] };
      }>(`query {
        tokenHolders(limit: 1000) {
          items { tokenAddress }
        }
      }`);
      return data.tokenHolders?.items ?? [];
    },
    ...ponderQueryDefaults,
  });

  const enrichedTokens = useMemo((): EnrichedToken[] => {
    if (!tokensQuery.data) return [];

    // Index pools by poolId
    const poolMap = new Map<string, PoolData>();
    for (const pool of poolsQuery.data ?? []) {
      poolMap.set(pool.poolId, pool);
    }

    const allSwaps = swapsQuery.data ?? [];
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    // Group swaps by poolId
    const swapsByPool = new Map<string, Swap[]>();
    for (const swap of allSwaps) {
      const list = swapsByPool.get(swap.poolId) ?? [];
      list.push(swap);
      swapsByPool.set(swap.poolId, list);
    }

    // Count holders per token address (lowercased)
    const holderCounts = new Map<string, number>();
    for (const h of holdersQuery.data ?? []) {
      const key = h.tokenAddress.toLowerCase();
      holderCounts.set(key, (holderCounts.get(key) ?? 0) + 1);
    }

    // Index bonding curves by token address (lowercased)
    const curvesByToken = new Map<string, BondingCurveData>();
    for (const curve of curvesQuery.data ?? []) {
      curvesByToken.set(curve.tokenAddress.toLowerCase(), curve);
    }

    return tokensQuery.data.map((token) => {
      const pool = poolMap.get(token.poolId);
      const tokenSwaps = swapsByPool.get(token.poolId) ?? [];
      const recentSwaps = tokenSwaps.filter((s) => s.timestamp >= oneDayAgo);
      const bondingCurve = curvesByToken.get(token.id.toLowerCase()) ?? null;

      // Which side of the pool holds our token — determines quote inversion
      // and which swap amount represents ETH. Fall back to currency0 when the
      // pool hasn't been indexed yet so downstream code stays consistent.
      const tokenIsCurrency0 = pool
        ? pool.currency0.toLowerCase() === token.id.toLowerCase()
        : true;

      // Current ETH-per-token quote. `ethPricePerToken` returns null for
      // untraded pools so the card shows "--" instead of a bogus 1.0.
      const price = pool ? ethPricePerToken(pool, token.id) : null;

      // 24h price change — compare now to the oldest swap in the window,
      // using the same side-of-pool convention as `price`.
      let priceChange24h: number | null = null;
      if (recentSwaps.length >= 2 && price != null) {
        const oldestPrice = ethPriceFromTick(
          recentSwaps[recentSwaps.length - 1].tick,
          tokenIsCurrency0
        );
        if (oldestPrice > 0) {
          priceChange24h = ((price - oldestPrice) / oldestPrice) * 100;
        }
      }

      // 24h volume: sum absolute ETH moved. ETH sits on the side opposite
      // our token — amount1 when the token is currency0, else amount0.
      let volume24h = 0;
      for (const s of recentSwaps) {
        const ethAmount = tokenIsCurrency0 ? s.amount1 : s.amount0;
        volume24h += Math.abs(Number(BigInt(ethAmount))) / 1e18;
      }

      // Sparkline: last 20 swap prices, oldest→newest, inverted to match the
      // ETH-per-token quote the card displays.
      const sparkline = tokenSwaps
        .slice(0, 20)
        .reverse()
        .map((s) => ethPriceFromTick(s.tick, tokenIsCurrency0));

      // Market cap = price * total supply
      const marketCap = price != null ? price * TOTAL_SUPPLY : null;

      const stage = stageFromBondingCurve(bondingCurve);
      let graduationPct = 0;
      if (bondingCurve) {
        if (bondingCurve.graduated) {
          graduationPct = 100;
        } else {
          const raised = Number(BigInt(bondingCurve.ethRaised)) / 1e18;
          const target = Number(BigInt(bondingCurve.graduationEth)) / 1e18;
          graduationPct = target > 0 ? Math.min((raised / target) * 100, 100) : 0;
        }
      } else {
        graduationPct = 100; // no curve = already on Uniswap
      }

      // Latest pool state (for price impact math) — pull from most recent swap
      const latestSwap = tokenSwaps[0];
      const latestSqrtPriceX96 = latestSwap?.sqrtPriceX96 ?? pool?.sqrtPriceX96 ?? null;
      const latestLiquidity = latestSwap?.liquidity ?? null;

      return {
        ...token,
        price,
        priceChange24h,
        volume24h,
        swapCount24h: recentSwaps.length,
        totalSwaps: tokenSwaps.length,
        holderCount: holderCounts.get(token.id.toLowerCase()) ?? 0,
        sparkline,
        marketCap,
        bondingCurve,
        stage,
        graduationPct,
        latestSqrtPriceX96,
        latestLiquidity,
        tokenIsCurrency0,
      };
    });
  }, [tokensQuery.data, poolsQuery.data, swapsQuery.data, holdersQuery.data, curvesQuery.data]);

  // Total market cap across all tokens
  const totalMarketCap = useMemo(() => {
    return enrichedTokens.reduce((sum, t) => sum + (t.marketCap ?? 0), 0);
  }, [enrichedTokens]);

  return {
    data: enrichedTokens,
    isLoading: tokensQuery.isLoading,
    isError: tokensQuery.isError,
    refetch: tokensQuery.refetch,
    recentSwaps: swapsQuery.data ?? [],
    totalMarketCap,
  };
}
