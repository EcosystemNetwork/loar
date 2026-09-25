/** Assets an LP fee balance can be held in for a creator's tokens (pure; see CreatorEarnings). */
import type { Address } from 'viem';

export interface FeeAssetRow {
  asset: Address;
  label: string;
  kind: 'quote' | 'token';
}

/** Unique assets fees can be held in: each paired (quote) token once, plus each launched token. */
export function feeAssets(
  tokens: { id: string; symbol: string; pairedToken?: string | null }[]
): FeeAssetRow[] {
  const rows: FeeAssetRow[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const q = t.pairedToken?.toLowerCase();
    if (q && !seen.has(q)) {
      seen.add(q);
      rows.push({ asset: t.pairedToken as Address, label: 'ETH (paired)', kind: 'quote' });
    }
  }
  for (const t of tokens) {
    const a = t.id.toLowerCase();
    if (!seen.has(a)) {
      seen.add(a);
      rows.push({ asset: t.id as Address, label: `$${t.symbol}`, kind: 'token' });
    }
  }
  return rows;
}
