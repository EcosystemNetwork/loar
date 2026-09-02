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

/**
 * Canonicalises a universe id for lookups, query keys, and router params.
 *
 * EVM universes are stored under a lowercased `0x…` address, so those are
 * lowercased here. Solana universes are keyed by a base58 PDA, which is
 * case-sensitive — lowercasing it produces an id that 404s. Anything that
 * isn't a `0x` + 40-hex address is passed through untouched.
 */
export function normalizeUniverseId(id: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(id) ? id.toLowerCase() : id;
}
