/**
 * viem PublicClient with RPC failover. When a request throws (including 429
 * "Too Many Requests" from the provider, which viem surfaces as HttpRequestError
 * with status 429), we rotate to the next configured URL and cool down the
 * previous one. No silent swallowing — if every URL is cooling down, throw so
 * the caller (backfill/live loop) can back off instead of writing stale data.
 */
import {
  createPublicClient,
  http,
  fallback,
  type PublicClient,
  type Chain,
  type HttpTransport,
} from 'viem';
import { sepolia, baseSepolia, base } from 'viem/chains';
import { env } from './env.js';
import { logger } from './logger.js';

const CHAIN_BY_NAME: Record<typeof env.LISTENER_CHAIN, Chain> = {
  sepolia,
  'base-sepolia': baseSepolia,
  base,
};

const chain = CHAIN_BY_NAME[env.LISTENER_CHAIN];

const urls = [env.LISTENER_RPC_URL, ...env.LISTENER_RPC_FALLBACKS];

const transports: HttpTransport[] = urls.map((url) =>
  http(url, {
    // viem retries on 429/5xx up to `retryCount` with exponential backoff.
    retryCount: 2,
    retryDelay: 500,
    timeout: 20_000,
  })
);

export const client: PublicClient = createPublicClient({
  chain,
  // fallback() rotates on failure across every transport in order.
  transport: fallback(transports, { rank: false, retryCount: 0 }),
  batch: { multicall: true },
});

export const chainId = chain.id;

logger.info({ chain: chain.name, chainId, rpcCount: urls.length }, 'RPC client ready');
