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

/**
 * Wei (decimal string, 18 decimals) → human amount with at most `maxDecimals`
 * fraction digits and thousands separators. String math, so balances above
 * 2^53 wei stay exact.
 */
export function formatWei(wei: string | null | undefined, maxDecimals = 4): string {
  if (!wei || !/^\d+$/.test(wei)) return '—';
  const padded = wei.padStart(19, '0');
  const whole = padded.slice(0, -18).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(-18).slice(0, maxDecimals).replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Wei string → plain decimal string (no grouping) suitable for an amount input. */
export function weiToInput(wei: string): string {
  return formatWei(wei, 18).replace(/,/g, '');
}
