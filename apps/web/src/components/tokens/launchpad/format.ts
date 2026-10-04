/** Number / time formatting shared by the launchpad surfaces. */

/** ETH-per-token price — exponent form for dust so the digits stay readable. */
export function formatPrice(p: number | null | undefined, digits = 6): string {
  if (p == null || !Number.isFinite(p) || p <= 0) return '--';
  return p < 0.001 ? p.toExponential(2) : p.toFixed(digits);
}

export function compactAge(createdAt: number): string {
  const s = Math.floor(Date.now() / 1000) - createdAt;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 2592000)}mo`;
}
