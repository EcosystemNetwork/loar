/**
 * useTokens — hooks for token discovery, analytics, swap history, and holder data.
 *
 * Fetches all token data from the Ponder indexer for the launchpad and token detail pages.
 */
import { useQuery } from '@tanstack/react-query';
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
