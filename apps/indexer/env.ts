/**
 * Indexer environment validation.
 * Loaded before ponder.config.ts — exits immediately on missing required vars.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In production each service gets its own env file; fall back to root for local dev.
const localEnv = path.resolve(__dirname, '.env');
const rootEnv = path.resolve(__dirname, '../../.env');

dotenv.config({ path: localEnv }); // prefer apps/indexer/.env if present
dotenv.config({ path: rootEnv }); // fall back to root .env (local dev)

const REQUIRED = ['PONDER_RPC_URL_2'] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ Indexer environment validation failed:`);
  missing.forEach((key) => console.error(`  - ${key} is required`));
  console.error('\nCheck apps/indexer/.env.example for required variables.\n');
  process.exit(1);
}

/** Which chain to index: "sepolia" (live) or "mainnet" (drop-in, needs deployments/mainnet.json). */
const PONDER_CHAIN = (process.env.PONDER_CHAIN ?? 'sepolia').toLowerCase();
const VALID_CHAINS = ['sepolia', 'mainnet'] as const;
if (!VALID_CHAINS.includes(PONDER_CHAIN as any)) {
  console.error(
    `\n❌ Invalid PONDER_CHAIN="${PONDER_CHAIN}". Must be one of: ${VALID_CHAINS.join(', ')}\n`
  );
  process.exit(1);
}

const userFallbacks = (process.env.PONDER_RPC_FALLBACKS ?? '').split(',').filter(Boolean);

/**
 * Default public RPC fallbacks per chain. Indexer downtime cascades into
 * stale event data the frontend trusts, so we always keep at least one
 * baked-in fallback if the operator hasn't supplied any via PONDER_RPC_FALLBACKS.
 * Override via PONDER_RPC_FALLBACKS CSV when better/private endpoints are available.
 */
const DEFAULT_FALLBACKS: Record<(typeof VALID_CHAINS)[number], string[]> = {
  // Sepolia fallbacks must serve ARCHIVE eth_getLogs — the backfill starts at the
  // deployment block, not chain head. The previous defaults were dead weight:
  // publicnode 403s archive queries ("Archive requests require a personal token")
  // and rpc.sepolia.org now 404s. Ponder load-balances across every entry with
  // per-host RPS tracking, so more healthy hosts = proportionally faster backfill.
  // Measured (500 sequential-wave archive eth_getLogs, 2026-07-30):
  //   drpc          64 req/s, 10k-block ranges
  //   ethpandaops   63 req/s, 10k-block ranges
  //   tenderly      14 req/s, 100k-block ranges
  //   tatum        221 req/s, but caps eth_getLogs at 100 blocks
  sepolia: [
    'https://rpc.sepolia.ethpandaops.io',
    'https://sepolia.gateway.tenderly.co',
    'https://ethereum-sepolia.gateway.tatum.io',
  ],
  mainnet: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
};

const fallbacks =
  userFallbacks.length > 0
    ? userFallbacks
    : DEFAULT_FALLBACKS[PONDER_CHAIN as (typeof VALID_CHAINS)[number]];

export const env = {
  PONDER_RPC_URL: process.env.PONDER_RPC_URL_2 as string,
  PONDER_RPC_FALLBACKS: fallbacks,
  PONDER_CHAIN: PONDER_CHAIN as (typeof VALID_CHAINS)[number],
} as const;
