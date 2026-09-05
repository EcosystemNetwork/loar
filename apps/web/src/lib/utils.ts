/**
 * UI Utility Functions
 *
 * Shared helpers used across the web app's component layer.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getAddress } from 'viem';

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

/**
 * Narrows an arbitrary address-shaped string (as stored on a universe's
 * Firestore doc) to a `0x${string}` usable with wagmi/viem, or `undefined`
 * if it isn't actually EVM-shaped.
 *
 * A Solana universe's `tokenAddress`/`address`/`governanceAddress` fields
 * hold base58 (SPL mint / PDA) values, not hex. Passing one of those
 * straight into `useReadContract({ address })` reaches viem's checksum
 * validation — which throws `InvalidAddressError` synchronously during
 * render even when the query itself is `enabled: false` — and crashes the
 * whole page with a blank screen (see useUniverseAddresses/useTokenGate).
 * Route every such field through this guard instead of casting.
 */
export function asEvmAddressOrUndefined(
  value: string | null | undefined
): `0x${string}` | undefined {
  return value && isEvmAddress(value) ? (value as `0x${string}`) : undefined;
}

/** The all-zero EVM address, as commonly stored to mean "not set". */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Checksums an address-shaped string via viem's `getAddress`, or returns
 * `undefined` for anything that isn't hex-shaped (including the zero
 * address and a Solana base58 value) instead of throwing.
 *
 * This is exactly what used to crash the universe editor on mount for
 * Solana universes: GovernanceSidebar read `finalUniverse.tokenAddress`/
 * `governanceAddress`/`address` — base58 SPL mint/PDA values on a Solana
 * universe's Firestore doc — straight into `getAddress()` with only a "not
 * the zero address" guard, and the sidebar is mounted unconditionally by
 * the parent route regardless of whether it's open. `getAddress()` throws
 * `InvalidAddressError` for anything that isn't 20 valid hex bytes; note it
 * does *not* throw for a mere EIP-55 checksum mismatch on an
 * otherwise-valid hex address — it just re-checksums it. `isEvmAddress`
 * pre-filters the shape; the try/catch is defense-in-depth in case that
 * ever changes, not a currently-reachable path. Route every such field
 * through this instead of calling `getAddress()` directly.
 */
export function toChecksummedAddressOrUndefined(
  value: string | null | undefined
): `0x${string}` | undefined {
  if (!value || value === ZERO_ADDRESS || !isEvmAddress(value)) return undefined;
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}
