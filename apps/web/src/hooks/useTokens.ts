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
    refetchInterval: 15_000, // Poll every 15s for live activity
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
          pool(id: $poolId) {
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
 * Calculate price from tick
 * price = 1.0001^tick
 */
export function priceFromTick(tick: number): number {
  return Math.pow(1.0001, tick);
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
}

const TOTAL_SUPPLY = 100_000_000_000; // 100B tokens per universe

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

  // Fetch recent swaps (expanded limit for volume + sparkline)
  const swapsQuery = useQuery({
    queryKey: ['all-recent-swaps-enriched'],
    queryFn: async () => {
      const data = await ponderGql<{
        swaps: { items: Swap[] };
      }>(`query {
        swaps(orderBy: "timestamp", orderDirection: "desc", limit: 500) {
          items {
            id poolId sender amount0 amount1 tick timestamp
          }
        }
      }`);
      return data.swaps?.items ?? [];
    },
    ...ponderQueryDefaults,
    refetchInterval: 10_000,
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

    return tokensQuery.data.map((token) => {
      const pool = poolMap.get(token.poolId);
      const tokenSwaps = swapsByPool.get(token.poolId) ?? [];
      const recentSwaps = tokenSwaps.filter((s) => s.timestamp >= oneDayAgo);

      // Current price from pool
      let price: number | null = null;
      if (pool?.sqrtPriceX96) price = priceFromSqrtX96(pool.sqrtPriceX96);
      else if (pool?.tick != null) price = priceFromTick(pool.tick);

      // 24h price change
      let priceChange24h: number | null = null;
      if (recentSwaps.length >= 2 && price) {
        const oldestPrice = priceFromTick(recentSwaps[recentSwaps.length - 1].tick);
        if (oldestPrice > 0) {
          priceChange24h = ((price - oldestPrice) / oldestPrice) * 100;
        }
      }

      // 24h volume (sum of absolute ETH moved)
      let volume24h = 0;
      for (const s of recentSwaps) {
        volume24h += Math.abs(Number(BigInt(s.amount1))) / 1e18;
      }

      // Sparkline: last 20 swap prices, oldest→newest
      const sparkline = tokenSwaps
        .slice(0, 20)
        .reverse()
        .map((s) => priceFromTick(s.tick));

      // Market cap = price * total supply
      const marketCap = price != null ? price * TOTAL_SUPPLY : null;

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
      };
    });
  }, [tokensQuery.data, poolsQuery.data, swapsQuery.data, holdersQuery.data]);

  // Total market cap across all tokens
  const totalMarketCap = useMemo(() => {
    return enrichedTokens.reduce((sum, t) => sum + (t.marketCap ?? 0), 0);
  }, [enrichedTokens]);

  return {
    data: enrichedTokens,
    isLoading: tokensQuery.isLoading,
    recentSwaps: swapsQuery.data ?? [],
    totalMarketCap,
  };
}
