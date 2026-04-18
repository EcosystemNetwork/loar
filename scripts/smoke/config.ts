/**
 * Smoke harness configuration.
 * All values read from environment at startup; safe defaults enable local runs.
 */

export interface SmokeConfig {
  serverUrl: string;
  indexerUrl: string;
  chainId: number;
  rpcUrl: string;
  // Origin header to send with CORS-protected requests (must match CORS_ORIGIN on server)
  origin: string;
  // Optional: enables chain-write and on-chain node tests
  privateKey: `0x${string}` | undefined;
  // Optional: Universe contract address to write a test node into
  universeAddress: `0x${string}` | undefined;
  // Request timeout for HTTP calls (ms)
  timeout: number;
  // How long to poll the indexer for a written node (ms)
  indexerSyncTimeout: number;
  // If true, only print failures and the final summary
  quiet: boolean;
  // If set, only run this specific layer
  layer: string | undefined;
  // If true, emit JSON to stdout (for CI parsing)
  json: boolean;
}

export function loadConfig(): SmokeConfig {
  const privateKey = process.env.SMOKE_PRIVATE_KEY as `0x${string}` | undefined;
  const universeAddress = process.env.SMOKE_UNIVERSE_ADDRESS as `0x${string}` | undefined;

  return {
    serverUrl: (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    indexerUrl: (
      process.env.INDEXER_URL ??
      process.env.VITE_PONDER_URL ??
      'http://localhost:42069'
    ).replace(/\/$/, ''),
    chainId: Number(process.env.SMOKE_CHAIN_ID ?? 84532),
    // Pick the RPC that matches the chain. Base Sepolia (84532) → BASE_SEPOLIA;
    // Ethereum Sepolia (11155111) → PONDER_RPC_URL_2. Mismatch causes ERC721
    // reverts because the same address on a different chain holds different code.
    rpcUrl:
      process.env.SMOKE_RPC_URL ??
      (Number(process.env.SMOKE_CHAIN_ID ?? 84532) === 84532
        ? (process.env.RPC_URL_BASE_SEPOLIA ?? 'https://sepolia.base.org')
        : (process.env.PONDER_RPC_URL_2 ?? 'https://ethereum-sepolia-rpc.publicnode.com')),
    // Vite in this repo runs on port 3001 (see apps/web/vite.config.ts). Match the
    // first allowed origin from CORS_ORIGIN; override via SMOKE_ORIGIN env var.
    origin: (
      process.env.SMOKE_ORIGIN ??
      process.env.CORS_ORIGIN?.split(',')[0]?.trim() ??
      'http://localhost:3001'
    ).replace(/\/$/, ''),
    privateKey,
    universeAddress,
    timeout: Number(process.env.SMOKE_TIMEOUT ?? 15_000),
    indexerSyncTimeout: Number(process.env.SMOKE_INDEXER_SYNC_TIMEOUT ?? 60_000),
    quiet: process.env.SMOKE_QUIET === '1' || process.env.SMOKE_QUIET === 'true',
    layer: process.env.SMOKE_LAYER ?? getArgFlag('--layer'),
    json: process.argv.includes('--json'),
  };
}

function getArgFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}
