/**
 * Centralized Chain Client Factory
 *
 * Single source of truth for RPC clients across all server routers.
 * Replaces duplicated client creation in credits, staking, treasury, etc.
 */
import { createPublicClient, http, type PublicClient } from 'viem';
import { sepolia, baseSepolia, base } from 'viem/chains';

const SUPPORTED_CHAINS = {
  [sepolia.id]: {
    chain: sepolia,
    rpcUrl:
      process.env.RPC_URL ||
      process.env.PONDER_RPC_URL_2 ||
      'https://ethereum-sepolia-rpc.publicnode.com',
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    rpcUrl: process.env.RPC_URL_BASE_SEPOLIA || 'https://base-sepolia-rpc.publicnode.com',
  },
  [base.id]: {
    chain: base,
    rpcUrl: process.env.RPC_URL_BASE || 'https://mainnet.base.org',
  },
} as const;

export const ALLOWED_CHAIN_IDS = new Set(Object.keys(SUPPORTED_CHAINS).map(Number));

const clientCache = new Map<number, PublicClient>();

/**
 * Get a public client for the specified chain.
 * Defaults to Sepolia if chainId is not provided.
 * Throws if chain is not supported.
 */
export function getChainClient(chainId?: number): PublicClient {
  const id = chainId ?? sepolia.id;

  if (!ALLOWED_CHAIN_IDS.has(id)) {
    throw new Error(
      `Chain ID ${id} is not supported. Supported: ${[...ALLOWED_CHAIN_IDS].join(', ')}`
    );
  }

  let client = clientCache.get(id);
  if (!client) {
    const config = SUPPORTED_CHAINS[id as keyof typeof SUPPORTED_CHAINS];
    client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });
    clientCache.set(id, client);
  }

  return client;
}

/**
 * Get the chain name for display purposes.
 */
export function getChainName(chainId?: number): string {
  const names: Record<number, string> = {
    [sepolia.id]: 'Sepolia',
    [baseSepolia.id]: 'Base Sepolia',
    [base.id]: 'Base',
  };
  return names[chainId ?? sepolia.id] ?? `Chain ${chainId}`;
}
