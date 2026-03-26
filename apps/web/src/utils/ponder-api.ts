const PONDER_URL =
  import.meta.env.VITE_PONDER_URL || "http://localhost:42069";

export async function ponderGql<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${PONDER_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Ponder query failed: ${res.statusText}`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

// Types matching the ponder.schema.ts tables

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

export interface Node {
  id: string;
  universeAddress: string;
  nodeId: number;
  previousNodeId: number;
  creator: string;
  createdAt: number;
}

export interface NodeContent {
  id: string;
  videoLink: string;
  plot: string;
}

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

export interface TokenHolder {
  id: string;
  tokenAddress: string;
  holderAddress: string;
  balance: string;
}
