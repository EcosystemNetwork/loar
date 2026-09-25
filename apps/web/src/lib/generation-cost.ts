/** Spend above this asks for confirmation before a generation is fired. */
export const SPEND_CONFIRM_THRESHOLD_USD = 5;

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return 'Free';
  return usd < 0.1 ? `~$${usd.toFixed(3)}` : `~$${usd.toFixed(2)}`;
}

/** True when a run (unit price × count) is expensive enough to confirm first. */
export function needsSpendConfirm(
  unitUsd: number,
  count = 1,
  thresholdUsd = SPEND_CONFIRM_THRESHOLD_USD
): boolean {
  const total = unitUsd * count;
  return Number.isFinite(total) && total >= thresholdUsd;
}

/** "~$0.04 each · 4× = ~$0.16" — shows the batch arithmetic, or just the price for one. */
export function batchCostLabel(unitUsd: number, count: number): string {
  if (count <= 1) return formatUsd(unitUsd);
  if (!(unitUsd > 0)) return 'Free';
  return `${formatUsd(unitUsd)} each · ${count}× = ${formatUsd(unitUsd * count)}`;
}
