/**
 * Ponder Indexer API Client
 *
 * Provides a typed GraphQL helper for querying the Ponder blockchain indexer,
 * along with TypeScript interfaces that mirror the ponder.schema.ts tables.
 * Used instead of @ponder/client for direct GraphQL access with React Query.
 */

const PONDER_URL = import.meta.env.VITE_PONDER_URL || '';
// Comma-separated failover URLs — tried in order on primary failure. A single
// Ponder host is a single point of failure, so ops should run at least one
// secondary replica pointing at the same chain + schema.
const PONDER_FALLBACK_URLS = ((import.meta.env.VITE_PONDER_URL_FALLBACK as string) || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

// Per-URL circuit breaker state. When a host errors we mark it offline for
// OFFLINE_COOLDOWN_MS and rotate to the next. If every host is offline, we
// fall back to the safe empty result.
const OFFLINE_COOLDOWN_MS = 60_000;
const _offlineUntil = new Map<string, number>();

function candidateUrls(): string[] {
  const urls: string[] = [];
  if (PONDER_URL) urls.push(PONDER_URL);
  for (const u of PONDER_FALLBACK_URLS) urls.push(u);
  return urls;
}

function firstHealthyUrl(): string | null {
  const now = Date.now();
  for (const u of candidateUrls()) {
    const cooldown = _offlineUntil.get(u) ?? 0;
    if (now >= cooldown) return u;
  }
  return null;
}

function markOffline(url: string) {
  _offlineUntil.set(url, Date.now() + OFFLINE_COOLDOWN_MS);
}

function markHealthy(url: string) {
  _offlineUntil.delete(url);
}

/** True when no indexer URL is configured or it points to localhost in production build */
const _disabled = candidateUrls().length === 0;

/**
 * Deep proxy that returns safe defaults for any property access chain.
 * Prevents "Cannot read properties of undefined (reading 'items')" when
 * the indexer is offline and callers do e.g. `d.nodes.items`.
 */
const EMPTY_RESULT: any = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'items') return [];
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then' || prop === Symbol.iterator) return undefined;
      return EMPTY_RESULT;
    },
  }
);

/**
 * Executes a GraphQL query against the Ponder indexer.
 * Includes a circuit breaker — if the indexer is unreachable, further
 * requests are short-circuited silently to avoid console spam.
 * Returns empty data when the indexer is unavailable.
 */
export async function ponderGql<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  // No indexer configured — return empty silently
  if (_disabled) {
    return EMPTY_RESULT as T;
  }

  // Walk candidates in priority order, skipping any in cooldown. If every
  // host is unreachable we return EMPTY_RESULT instead of throwing so UI
  // queries degrade gracefully.
  const urls = candidateUrls();
  for (const url of urls) {
    const cooldown = _offlineUntil.get(url) ?? 0;
    if (Date.now() < cooldown) continue;

    let res: Response;
    try {
      res = await fetch(`${url}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      markOffline(url);
      continue;
    }

    if (!res.ok) {
      // Retry-able status codes (5xx, 429) → mark offline and rotate.
      // 4xx is a client bug, not an ops issue — surface it.
      if (res.status >= 500 || res.status === 429) {
        markOffline(url);
        continue;
      }
      throw new Error(`Ponder query failed: ${res.statusText}`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }
    markHealthy(url);
    return json.data;
  }

  // No healthy host on this attempt — short-circuit subsequent callers for
  // the cooldown duration.
  return EMPTY_RESULT as T;
}

/** Exposed for `/status` and health checks. Primary URL and any fallbacks with state. */
export function getIndexerHealth(): Array<{
  url: string;
  healthy: boolean;
  cooldownMsRemaining: number;
}> {
  const now = Date.now();
  return candidateUrls().map((url) => {
    const cooldown = _offlineUntil.get(url) ?? 0;
    return {
      url,
      healthy: now >= cooldown,
      cooldownMsRemaining: Math.max(0, cooldown - now),
    };
  });
}

/** Default React Query options for all ponder queries. */
export const ponderQueryDefaults = {
  retry: false,
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} as const;

// ---- Types matching the ponder.schema.ts tables ----

/** On-chain universe entity indexed by Ponder. */
export interface Universe {
  id: string;
  universeId: number | null;
  creator: string;
  createdAt: number;
  name: string;
  description: string;
  imageURL: string;
  tokenAddress: string | null;
  governorAddress: string | null;
  nodeCount: number;
}

/** ERC-20 governance token deployed for a universe. */
export interface Token {
  id: string;
  universeAddress: string;
  deployer: string;
  tokenAdmin: string;
  name: string;
  symbol: string;
  imageURL: string;
  metadata: string;
  context: string;
  startingTick: string;
  poolHook: string;
  poolId: string;
  pairedToken: string;
  locker: string;
  createdAt: number;
}

/** Timeline node created on-chain within a universe. */
export interface Node {
  id: string;
  universeAddress: string;
  nodeId: number;
  previousNodeId: number;
  creator: string;
  createdAt: number;
}

/** Resolved content for a node (video link and plot text from events). */
export interface NodeContent {
  id: string;
  videoLink: string;
  plot: string;
}

/** Uniswap V4 swap event for a universe token pool. */
export interface Swap {
  id: string;
  poolId: string;
  sender: string;
  amount0: string;
  amount1: string;
  sqrtPriceX96: string;
  liquidity: string;
  tick: number;
  timestamp: number;
  blockNumber: number;
}

/** Token holder balance snapshot from transfer events. */
export interface TokenHolder {
  id: string;
  tokenAddress: string;
  holderAddress: string;
  balance: string;
}
