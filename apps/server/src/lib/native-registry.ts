/**
 * Native-protocol program ID registry. Single source of truth for the
 * Solana program IDs the adapters target. Env var overrides per cluster.
 *
 * Jupiter is API-only (no on-chain program ID we route through directly)
 * so it's absent here.
 */
import { PublicKey } from '@solana/web3.js';
import type { SolanaCluster } from '@loar/abis/chain';
import { activeCluster } from './circle-solana';

// ── SPL Governance (Realms) ────────────────────────────────────────────────
// Same program ID on both clusters. Override via REALMS_PROGRAM_ID env.
export const SPL_GOVERNANCE_PROGRAM_ID_DEFAULT = new PublicKey(
  'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw'
);

export function getRealmsProgramId(): PublicKey {
  const override = process.env.REALMS_PROGRAM_ID;
  return override ? new PublicKey(override) : SPL_GOVERNANCE_PROGRAM_ID_DEFAULT;
}

// ── Streamflow ─────────────────────────────────────────────────────────────
// Cluster-specific program IDs per Streamflow docs (as of 2026-05).
const STREAMFLOW_PROGRAM_ID_DEVNET = new PublicKey('HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ');
const STREAMFLOW_PROGRAM_ID_MAINNET = new PublicKey('strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m');

export function getStreamflowProgramId(cluster?: SolanaCluster): PublicKey {
  const override = process.env.STREAMFLOW_PROGRAM_ID;
  if (override) return new PublicKey(override);
  const c = cluster ?? activeCluster();
  return c === 'mainnet-beta' ? STREAMFLOW_PROGRAM_ID_MAINNET : STREAMFLOW_PROGRAM_ID_DEVNET;
}

// ── Tensor ─────────────────────────────────────────────────────────────────
// Tensor mainnet program ID — devnet is a stub; for real volume the
// adapter should be wired against mainnet via Helius RPC.
const TENSOR_MARKETPLACE_PROGRAM_ID_DEFAULT = new PublicKey(
  'TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp'
);

export function getTensorProgramId(): PublicKey {
  const override = process.env.TENSOR_PROGRAM_ID;
  return override ? new PublicKey(override) : TENSOR_MARKETPLACE_PROGRAM_ID_DEFAULT;
}

// ── Magic Eden ─────────────────────────────────────────────────────────────
const MAGIC_EDEN_PROGRAM_ID_DEFAULT = new PublicKey('M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K');

export function getMagicEdenProgramId(): PublicKey {
  const override = process.env.MAGIC_EDEN_PROGRAM_ID;
  return override ? new PublicKey(override) : MAGIC_EDEN_PROGRAM_ID_DEFAULT;
}

// ── Metaplex Core ──────────────────────────────────────────────────────────
// Same program ID on all clusters per Metaplex docs.
export const METAPLEX_CORE_PROGRAM_ID = new PublicKey(
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
);

export function getMetaplexCoreProgramId(): PublicKey {
  const override = process.env.METAPLEX_CORE_PROGRAM_ID;
  return override ? new PublicKey(override) : METAPLEX_CORE_PROGRAM_ID;
}

// ── Jupiter (API URL, not a program ID) ────────────────────────────────────
export function getJupiterApiBase(): string {
  return process.env.JUPITER_API_BASE ?? 'https://quote-api.jup.ag/v6';
}
