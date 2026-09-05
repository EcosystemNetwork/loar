/**
 * UI Utility Functions
 *
 * Shared helpers used across the web app's component layer.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts via tailwind-merge.
 * Accepts the same argument types as clsx (strings, arrays, objects, conditionals).
 * @param inputs - Class values to merge
 * @returns Deduplicated, conflict-resolved class string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** True for a canonical EVM address (`0x` + 40 hex). */
export function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** True for a Solana base58 PDA/pubkey (32-44 chars, base58 alphabet). */
export function isSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/**
 * True when an id is shaped like an on-chain universe address — an EVM
 * contract address or a Solana base58 PDA — as opposed to a human-readable
 * slug or a script-seeded off-chain id. Used to gate on-chain-only lookups
 * (Firestore-by-address, indexer reads) so they aren't skipped for Solana
 * universes just because they don't start with `0x`.
 */
export function isAddressLikeUniverseId(id: string): boolean {
  return isEvmAddress(id) || isSolanaAddress(id);
}

/**
 * Canonicalises a universe id for lookups, query keys, and router params.
 *
 * EVM universes are stored under a lowercased `0x…` address, so those are
 * lowercased here. Solana universes are keyed by a base58 PDA, which is
 * case-sensitive — lowercasing it produces an id that 404s. Anything that
 * isn't a `0x` + 40-hex address is passed through untouched.
 */
export function normalizeUniverseId(id: string): string {
  return isEvmAddress(id) ? id.toLowerCase() : id;
}
