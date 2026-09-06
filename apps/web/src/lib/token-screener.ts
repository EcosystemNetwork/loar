/**
 * Token screener — filter/sort model shared by the launchpad grid and table
 * views. Pure functions only; no React. The launchpad owns the state and
 * persists the primitives (view/sort/tab/query/preset) to the URL.
 */
import type { EnrichedToken, TokenStage } from '@/hooks/useTokens';

export type ScreenerView = 'grid' | 'table';
export type ScreenerTab = 'all' | 'watchlist' | 'new';
export type SortMode =
  | 'trending'
  | 'newest'
  | 'holders'
  | 'volume'
  | 'liquidity'
  | 'mcap'
  | 'gainers'
  | 'name';
export type StageFilter = 'all' | TokenStage;

/** Numeric range / threshold filters. `null` = unset. */
export interface AdvancedFilters {
  minMcap: number | null; // ETH
  maxMcap: number | null;
  minHolders: number | null;
  minVolume24h: number | null; // ETH
  minLiquidity: number | null; // ETH
  maxAgeHours: number | null;
  maxTopHolderPct: number | null; // not yet wired to list data — reserved
  onlyWithImage: boolean;
}

export const EMPTY_FILTERS: AdvancedFilters = {
  minMcap: null,
  maxMcap: null,
  minHolders: null,
  minVolume24h: null,
  minLiquidity: null,
  maxAgeHours: null,
  maxTopHolderPct: null,
  onlyWithImage: false,
};

export function activeFilterCount(f: AdvancedFilters): number {
  let n = 0;
  if (f.minMcap != null) n++;
  if (f.maxMcap != null) n++;
  if (f.minHolders != null) n++;
  if (f.minVolume24h != null) n++;
  if (f.minLiquidity != null) n++;
  if (f.maxAgeHours != null) n++;
  if (f.maxTopHolderPct != null) n++;
  if (f.onlyWithImage) n++;
  return n;
}

// ─── Presets ────────────────────────────────────────────────────────

export interface ScreenerPreset {
  id: string;
  label: string;
  description: string;
  stage: StageFilter;
  sort: SortMode;
  filters: Partial<AdvancedFilters>;
}

export const SCREENER_PRESETS: ScreenerPreset[] = [
  {
    id: 'new-safe',
    label: 'New & safe',
    description: 'Under a day old, 10+ holders, some volume',
    stage: 'all',
    sort: 'newest',
    filters: { maxAgeHours: 24, minHolders: 10, minVolume24h: 0.05 },
  },
  {
    id: 'runners',
    label: 'Runners',
    description: 'Up big in 24h with real volume',
    stage: 'all',
    sort: 'gainers',
    filters: { minVolume24h: 0.5 },
  },
  {
    id: 'near-graduation',
    label: 'Near graduation',
    description: 'Bonding curve 75%+ of the way there',
    stage: 'graduating',
    sort: 'trending',
    filters: {},
  },
  {
    id: 'blue-chips',
    label: 'Blue chips',
    description: 'Graduated, 100+ holders, deep liquidity',
    stage: 'graduated',
    sort: 'liquidity',
    filters: { minHolders: 100, minLiquidity: 1 },
  },
  {
    id: 'high-liquidity',
    label: 'Deep liquidity',
    description: '1 ETH+ of tradable depth',
    stage: 'all',
    sort: 'liquidity',
    filters: { minLiquidity: 1 },
  },
];

// ─── Filtering + sorting ────────────────────────────────────────────

const nowSec = () => Math.floor(Date.now() / 1000);

export function matchesSearch(t: EnrichedToken, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    t.name.toLowerCase().includes(s) ||
    t.symbol.toLowerCase().includes(s) ||
    t.id.toLowerCase().includes(s)
  );
}

export function matchesFilters(t: EnrichedToken, f: AdvancedFilters): boolean {
  const mcap = t.marketCap ?? 0;
  if (f.minMcap != null && mcap < f.minMcap) return false;
  if (f.maxMcap != null && mcap > f.maxMcap) return false;
  if (f.minHolders != null && t.holderCount < f.minHolders) return false;
  if (f.minVolume24h != null && t.volume24h < f.minVolume24h) return false;
  if (f.minLiquidity != null && t.liquidityEth < f.minLiquidity) return false;
  if (f.maxAgeHours != null && (nowSec() - t.createdAt) / 3600 > f.maxAgeHours) return false;
  if (f.onlyWithImage && !t.imageURL) return false;
  return true;
}

export function sortTokens(tokens: EnrichedToken[], mode: SortMode): EnrichedToken[] {
  const out = [...tokens];
  switch (mode) {
    case 'trending':
      out.sort((a, b) => b.swapCount24h - a.swapCount24h || b.volume24h - a.volume24h);
      break;
    case 'newest':
      out.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'holders':
      out.sort((a, b) => b.holderCount - a.holderCount);
      break;
    case 'volume':
      out.sort((a, b) => b.volume24h - a.volume24h);
      break;
    case 'liquidity':
      out.sort((a, b) => b.liquidityEth - a.liquidityEth);
      break;
    case 'mcap':
      out.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      break;
    case 'gainers':
      out.sort((a, b) => (b.priceChange24h ?? -Infinity) - (a.priceChange24h ?? -Infinity));
      break;
    case 'name':
      out.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return out;
}

/** Full pipeline: search → stage → advanced filters → sort. */
export function runScreener(
  tokens: EnrichedToken[],
  {
    search,
    stage,
    filters,
    sort,
  }: { search: string; stage: StageFilter; filters: AdvancedFilters; sort: SortMode }
): EnrichedToken[] {
  const filtered = tokens.filter(
    (t) =>
      matchesSearch(t, search) &&
      (stage === 'all' || t.stage === stage) &&
      matchesFilters(t, filters)
  );
  return sortTokens(filtered, sort);
}
