/** Display helpers for the launchpad screens (ETH-denominated). */

export function formatPrice(p: number | null | undefined): string {
  if (p == null) return '—';
  return p < 0.001 ? p.toExponential(2) : p.toFixed(6);
}

export function formatCompactEth(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K ETH`;
  return `${n >= 10 ? n.toFixed(1) : n.toFixed(3)} ETH`;
}

export const STAGE_LABEL = {
  bonding: 'Bonding',
  graduating: 'Graduating',
  graduated: 'Graduated',
  halted: 'Halted',
} as const;

export const STAGE_VARIANT = {
  bonding: 'primary',
  graduating: 'warning',
  graduated: 'success',
  halted: 'error',
} as const;

/** Web link for a token — where trading happens (mobile has no EVM stack of its own). */
export const webTokenUrl = (address: string) => `https://loar.fun/tokens/${address}`;
