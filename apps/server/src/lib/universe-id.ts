/**
 * Universe id / address canonicalisation.
 *
 * EVM universes are keyed by a lowercased `0x…` address (addresses are
 * case-insensitive). Solana universes are keyed by a case-sensitive base58
 * PDA, and Solana wallet addresses are likewise case-sensitive — lowercasing
 * either yields a value that matches no Firestore document and never equals
 * its stored form. Keep this dependency-free so it is safe to import anywhere.
 */

/** True for a canonical EVM address (`0x` + 40 hex). */
export function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/**
 * Canonicalise a universe id / address for a Firestore lookup or an identity
 * compare: lowercase EVM addresses, leave everything else (Solana base58)
 * verbatim.
 */
export function normalizeUniverseId(id: string): string {
  return isEvmAddress(id) ? id.toLowerCase() : id;
}
