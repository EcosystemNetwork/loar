/**
 * Ponder Indexer API Client
 *
 * Provides a typed GraphQL helper for querying the Ponder blockchain indexer,
 * along with TypeScript interfaces that mirror the ponder.schema.ts tables.
 * Used instead of @ponder/client for direct GraphQL access with React Query.
 */

const PONDER_URL = import.meta.env.VITE_PONDER_URL || 'http://localhost:42069';

/**
 * Executes a GraphQL query against the Ponder indexer.
 * @param query - GraphQL query string
 * @param variables - Optional query variables
 * @returns The `data` field from the GraphQL response, typed as `T`
 * @throws On HTTP errors or GraphQL-level errors
 */
export async function ponderGql<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PONDER_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    // Indexer not running — return empty data silently
    return {} as T;
  }

  if (!res.ok) throw new Error(`Ponder query failed: ${res.statusText}`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

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
