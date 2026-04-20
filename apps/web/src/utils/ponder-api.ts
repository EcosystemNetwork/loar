/**
 * Ponder Indexer API Client
 *
 * Provides a typed GraphQL helper for querying the Ponder blockchain indexer,
 * along with TypeScript interfaces that mirror the ponder.schema.ts tables.
 * Used instead of @ponder/client for direct GraphQL access with React Query.
 */

// Feature flag — when true, ponderGql dispatches known query shapes to the
// Firestore-backed tRPC indexer (trpc.indexer.*) instead of hitting the Ponder
// GraphQL endpoint. Query shapes we don't recognize fall back to GraphQL so
// the cutover can be staged. See docs/prd-indexer-firestore-migration.md.
const USE_TRPC_INDEXER = import.meta.env.VITE_USE_TRPC_INDEXER === 'true';

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
  // Feature-flagged route through the Firestore-backed tRPC indexer. Only
  // handles query shapes we've explicitly mapped; anything else falls through
  // to the GraphQL path so adoption can be incremental.
  if (USE_TRPC_INDEXER) {
    const trpcResult = await tryTrpcIndexer<T>(query, variables);
    if (trpcResult !== undefined) return trpcResult;
    // else fall through to GraphQL as legacy fallback
  }

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

// ──────────────────────────────────────────────────────────────────────
// tRPC indexer fallback (feature-flagged via VITE_USE_TRPC_INDEXER)
//
// Pattern-matches the GraphQL query text to a known tRPC procedure call and
// reshapes the response to match the GraphQL envelope (`{ items: [...] }` or
// single-object shape). Returns undefined when the query doesn't match any
// handled shape — caller falls through to GraphQL.
// ──────────────────────────────────────────────────────────────────────

async function tryTrpcIndexer<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T | undefined> {
  const { trpcClient } = await import('./trpc');
  const q = query.replace(/\s+/g, ' ').trim();

  // universes(limit: $l)  →  trpc.indexer.universes
  if (/query.*\buniverses\s*\(/i.test(q) && !/universe\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const res = await trpcClient.indexer.universes.query({ limit, includeUnconfirmed: false });
    return { universes: { items: res.items } } as unknown as T;
  }

  // universe(id: $id)  →  trpc.indexer.universe
  if (/query.*\buniverse\s*\(\s*id:/i.test(q)) {
    const id = variables?.id as string;
    const item = await trpcClient.indexer.universe.query({ id });
    return { universe: item } as unknown as T;
  }

  // tokens(..., where: { universeAddress: ... })  →  trpc.indexer.tokens
  if (/query.*\btokens\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const universeAddress = variables?.universeAddress as string | undefined;
    const res = await trpcClient.indexer.tokens.query({
      limit,
      universeAddress,
      includeUnconfirmed: false,
    });
    return { tokens: { items: res.items } } as unknown as T;
  }

  // token(id: $id)
  if (/query.*\btoken\s*\(\s*id:/i.test(q)) {
    const id = variables?.id as string;
    const item = await trpcClient.indexer.token.query({ id });
    return { token: item } as unknown as T;
  }

  // nodes(...) or nodes(orderBy, limit)
  if (/query.*\bnodes\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const universeAddress = variables?.universeAddress as string | undefined;
    const res = await trpcClient.indexer.nodes.query({
      limit,
      universeAddress,
      includeUnconfirmed: false,
    });
    return { nodes: { items: res.items } } as unknown as T;
  }

  // nodeContents (paginated prefix by universe address)
  if (/query.*\bnodeContents\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const universeAddress = variables?.universeAddress as string | undefined;
    const cursor = variables?.cursor as string | undefined;
    const res = await trpcClient.indexer.nodeContents.query({ limit, universeAddress, cursor });
    return {
      nodeContents: { items: res.items, pageInfo: { endCursor: res.nextCursor } },
    } as unknown as T;
  }

  // tokenHolders(tokenAddress)
  if (/query.*\btokenHolders\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const tokenAddress = variables?.tokenAddress as string | undefined;
    const res = await trpcClient.indexer.tokenHolders.query({
      limit,
      tokenAddress,
      includeUnconfirmed: false,
    });
    return { tokenHolders: { items: res.items } } as unknown as T;
  }

  // swaps(poolId | sender)
  if (/query.*\bswaps\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const poolId = variables?.poolId as string | undefined;
    const sender = variables?.sender as string | undefined;
    const res = await trpcClient.indexer.swaps.query({
      limit,
      poolId,
      sender,
      includeUnconfirmed: false,
    });
    return { swaps: { items: res.items } } as unknown as T;
  }

  // pool(poolId)
  if (/query.*\bpool\s*\(\s*poolId:/i.test(q)) {
    const poolId = variables?.poolId as string;
    const item = await trpcClient.indexer.pool.query({ poolId });
    return { pool: item } as unknown as T;
  }

  // pools(limit)
  if (/query.*\bpools\s*\(/i.test(q)) {
    const limit = (variables?.limit as number) ?? 40;
    const res = await trpcClient.indexer.pools.query({ limit });
    return { pools: { items: res.items } } as unknown as T;
  }

  return undefined;
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
