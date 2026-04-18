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

/** Which chain to index: "sepolia" (default), "base-sepolia", or "base" */
const PONDER_CHAIN = (process.env.PONDER_CHAIN ?? 'sepolia').toLowerCase();
const VALID_CHAINS = ['sepolia', 'base-sepolia', 'base'] as const;
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
  sepolia: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
  'base-sepolia': ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
  base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
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
