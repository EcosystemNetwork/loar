/**
 * Token Launchpad — Discover & browse all launched universe tokens.
 *
 * pump.fun-style discovery with two views (card grid + dense screener table),
 * URL-persisted sort/stage/search/preset/tab state, an advanced filter panel,
 * one-click screener presets, a watchlist tab, a "new pairs" stream, a
 * recently-viewed rail, and a live cross-token activity feed.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/utils/trpc';
import { useTokenListData, type EnrichedToken, formatCompactEth } from '@/hooks/useTokens';
import { useTokenWatchlist } from '@/hooks/useTokenWatchlist';
import { useRecentTokens } from '@/hooks/useRecentTokens';
import {
  type AdvancedFilters,
  type SortMode,
  type StageFilter,
  type ScreenerTab,
  type ScreenerView,
  EMPTY_FILTERS,
  SCREENER_PRESETS,
  runScreener,
  pickKingOfTheHill,
} from '@/lib/token-screener';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TokenTable } from '@/components/tokens/TokenTable';
import { KingOfTheHill } from '@/components/tokens/KingOfTheHill';
import { TokenScreenerControls } from '@/components/tokens/TokenScreenerControls';
import { LaunchpadNav } from '@/components/tokens/launchpad/LaunchpadNav';
import { TokenCard } from '@/components/tokens/launchpad/TokenCard';
import {
  LiveTradesFeed,
  type LiveActivityItem,
} from '@/components/tokens/launchpad/LiveTradesFeed';
import { Change, TokenAvatar } from '@/components/tokens/launchpad/primitives';
import { QueryState } from '@/components/QueryState';
import { cn } from '@/lib/utils';
import { LayoutGrid, Lock, Rocket, Search, Table2, X } from 'lucide-react';

const SORT_MODES: SortMode[] = [
  'trending',
  'newest',
  'holders',
  'volume',
  'liquidity',
  'mcap',
  'gainers',
  'name',
];
const STAGE_FILTERS: StageFilter[] = ['all', 'bonding', 'graduating', 'graduated', 'halted'];

/**
 * All keys optional so `<Link to="/tokens">` elsewhere doesn't have to supply a
 * search object. `validateSearch` still normalises every value, so at runtime
 * the fields are always populated — `useNormalizedSearch` re-applies the same
 * defaults for a non-optional read.
 */
interface TokenSearch {
  view?: ScreenerView;
  sort?: SortMode;
  stage?: StageFilter;
  q?: string;
  preset?: string;
  tab?: ScreenerTab;
}

type NormalizedSearch = {
  view: ScreenerView;
  sort: SortMode;
  stage: StageFilter;
  q: string;
  preset?: string;
  tab: ScreenerTab;
};

function normalizeSearch(search: Record<string, unknown>): NormalizedSearch {
  const sort = search.sort as SortMode;
  const stage = search.stage as StageFilter;
  const preset = typeof search.preset === 'string' ? search.preset : undefined;
  return {
    view: search.view === 'table' ? 'table' : 'grid',
    sort: SORT_MODES.includes(sort) ? sort : 'trending',
    stage: STAGE_FILTERS.includes(stage) ? stage : 'all',
    q: typeof search.q === 'string' ? search.q : '',
    preset: preset && SCREENER_PRESETS.some((p) => p.id === preset) ? preset : undefined,
    tab: search.tab === 'watchlist' || search.tab === 'new' ? (search.tab as ScreenerTab) : 'all',
  };
}

export const Route = createFileRoute('/tokens/')({
  validateSearch: (search: Record<string, unknown>): TokenSearch => normalizeSearch(search),
  component: TokenLaunchpad,
});

const SORT_LABELS: Record<SortMode, string> = {
  trending: 'Trending',
  newest: 'Newest',
  gainers: 'Top gainers',
  volume: 'Volume 24h',
  liquidity: 'Liquidity',
  mcap: 'Market cap',
  holders: 'Holders',
  name: 'Name A–Z',
};

const TABS: { tab: ScreenerTab; label: string }[] = [
  { tab: 'all', label: 'All tokens' },
  { tab: 'new', label: 'New pairs' },
  { tab: 'watchlist', label: 'Watchlist' },
];

const STAGES: { stage: StageFilter; label: string }[] = [
  { stage: 'all', label: 'Any stage' },
  { stage: 'bonding', label: 'Bonding' },
  { stage: 'graduating', label: 'Graduating' },
  { stage: 'graduated', label: 'Graduated' },
  { stage: 'halted', label: 'Halted' },
];

function TokenLaunchpad() {
  const rawSearch = Route.useSearch();
  const search = normalizeSearch(rawSearch as Record<string, unknown>);
  const navigate = Route.useNavigate();
  const setSearch = (patch: Partial<TokenSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const { watched, isWatched, toggle: toggleWatch, count: watchCount } = useTokenWatchlist();
  const recentAddrs = useRecentTokens();

  const {
    data: tokens,
    isLoading,
    isError,
    refetch,
    recentSwaps,
    recentBondingTrades,
    totalMarketCap,
  } = useTokenListData();

  const king = useMemo(() => pickKingOfTheHill(tokens), [tokens]);

  const applyPreset = (id: string | null) => {
    if (!id) {
      setSearch({ preset: undefined });
      setFilters(EMPTY_FILTERS);
      return;
    }
    const preset = SCREENER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSearch({ preset: id, stage: preset.stage, sort: preset.sort });
    setFilters({ ...EMPTY_FILTERS, ...preset.filters });
  };

  // ── Screener pipeline ──────────────────────────────────────────────
  const tabFiltered = useMemo(() => {
    if (!tokens.length) return [];
    if (search.tab === 'watchlist') return tokens.filter((t) => watched.has(t.id.toLowerCase()));
    if (search.tab === 'new') {
      const dayAgo = Math.floor(Date.now() / 1000) - 86400;
      return tokens.filter((t) => t.createdAt >= dayAgo);
    }
    return tokens;
  }, [tokens, search.tab, watched]);

  const screened = useMemo(
    () =>
      runScreener(tabFiltered, {
        search: search.q,
        stage: search.stage,
        filters,
        sort: search.tab === 'new' ? 'newest' : search.sort,
      }),
    [tabFiltered, search.q, search.stage, search.sort, search.tab, filters]
  );

  const stageCounts = useMemo(() => {
    const base = tabFiltered.filter(
      (t) =>
        !search.q ||
        t.name.toLowerCase().includes(search.q.toLowerCase()) ||
        t.symbol.toLowerCase().includes(search.q.toLowerCase()) ||
        t.id.toLowerCase().includes(search.q.toLowerCase())
    );
    const counts = { all: base.length, bonding: 0, graduating: 0, graduated: 0, halted: 0 };
    for (const t of base) counts[t.stage]++;
    return counts;
  }, [tabFiltered, search.q]);

  const recentTokens = useMemo(() => {
    if (!tokens.length || !recentAddrs.length) return [];
    const byId = new Map(tokens.map((t) => [t.id.toLowerCase(), t]));
    return recentAddrs.map((a) => byId.get(a.toLowerCase())).filter(Boolean) as EnrichedToken[];
  }, [tokens, recentAddrs]);

  // Community-activity badge — one batch call for every token in view.
  const commentTargetAddrs = useMemo(
    () =>
      screened
        .slice(0, 60)
        .map((t) => t.id)
        .sort()
        .join(','),
    [screened]
  );
  const { data: commentCounts } = useQuery({
    ...trpc.tokenSocial.getCommentCounts.queryOptions({
      tokenAddresses: commentTargetAddrs ? commentTargetAddrs.split(',') : [],
    }),
    enabled: commentTargetAddrs.length > 0,
    staleTime: 60_000,
  });
  const commentCountFor = (addr: string) => commentCounts?.[addr.toLowerCase()] ?? 0;

  // ── Live activity feed ────────────────────────────────────────────
  const liveActivity = useMemo((): LiveActivityItem[] => {
    if (!tokens.length) return [];
    const poolToToken = new Map<string, EnrichedToken>();
    const curveToToken = new Map<string, EnrichedToken>();
    for (const t of tokens) {
      poolToToken.set(t.poolId, t);
      if (t.bondingCurve) curveToToken.set(t.bondingCurve.id.toLowerCase(), t);
    }

    const items: LiveActivityItem[] = [];
    for (const swap of recentSwaps) {
      const token = poolToToken.get(swap.poolId);
      if (!token) continue;
      const ethAmountSigned = BigInt(token.tokenIsCurrency0 ? swap.amount1 : swap.amount0);
      const isBuy = ethAmountSigned > 0n;
      const ethAbs = ethAmountSigned < 0n ? -ethAmountSigned : ethAmountSigned;
      items.push({
        kind: 'swap',
        id: swap.id,
        timestamp: swap.timestamp,
        sender: swap.sender,
        token,
        isBuy,
        ethAmountWei: ethAbs.toString(),
      });
    }
    for (const trade of recentBondingTrades) {
      const token = curveToToken.get(trade.bondingCurve.toLowerCase());
      if (!token) continue;
      items.push({
        kind: 'bondingTrade',
        id: trade.id,
        timestamp: trade.timestamp,
        sender: trade.trader,
        token,
        isBuy: trade.isBuy,
        ethAmountWei: trade.ethAmount,
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);
    return items.slice(0, 25);
  }, [recentSwaps, recentBondingTrades, tokens]);

  const gainers24h = useMemo(
    () => tokens.filter((t) => (t.priceChange24h ?? 0) > 0).length,
    [tokens]
  );

  const effectiveSort: SortMode = search.tab === 'new' ? 'newest' : search.sort;
  const hasNarrowing =
    !!search.q || search.stage !== 'all' || !!search.preset || filters !== EMPTY_FILTERS;

  return (
    <div className="min-h-screen bg-background pb-bottom-nav md:pb-12">
      <LaunchpadNav />

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {/* Header + market summary */}
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Launchpad</h1>
            <p className="mt-1.5 text-muted-foreground">
              Every token is governance over a story universe. Buy early on the curve, then it
              graduates to Uniswap with liquidity locked forever.
            </p>
          </div>
          <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-x">
            <SummaryStat label="Tokens" value={isLoading ? null : String(tokens.length)} />
            <SummaryStat
              label="Total mcap"
              value={
                isLoading
                  ? null
                  : totalMarketCap > 0
                    ? `${formatCompactEth(totalMarketCap)} ETH`
                    : '--'
              }
            />
            <SummaryStat label="Up 24h" value={isLoading ? null : String(gainers24h)} />
            <SummaryStat
              label="Liquidity"
              value={
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />
                  Locked
                </span>
              }
            />
          </dl>
        </header>

        {/* King of the Hill — top market cap still on the curve */}
        {king && search.tab === 'all' && <KingOfTheHill token={king} />}

        {/* Recently viewed */}
        {recentTokens.length > 0 && search.tab === 'all' && (
          <section aria-label="Recently viewed">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recently viewed
            </h2>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {recentTokens.map((t) => (
                <Link
                  key={t.id}
                  to="/tokens/$address"
                  params={{ address: t.id }}
                  className="flex flex-shrink-0 items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TokenAvatar
                    imageURL={t.imageURL}
                    symbol={t.symbol}
                    size="sm"
                    className="rounded-full"
                  />
                  <span className="text-sm font-semibold">${t.symbol}</span>
                  <Change value={t.priceChange24h} className="text-xs" />
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0 space-y-4">
            {/* Toolbar */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="tablist"
                  aria-label="Token lists"
                  className="inline-flex rounded-lg border border-border bg-card p-1"
                >
                  {TABS.map(({ tab, label }) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={search.tab === tab}
                      onClick={() => setSearch({ tab })}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        search.tab === tab
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {label}
                      {tab === 'watchlist' && watchCount > 0 && (
                        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                          {watchCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[200px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    aria-label="Search tokens"
                    placeholder="Search name, ticker, or address"
                    value={search.q}
                    onChange={(e) => setSearch({ q: e.target.value })}
                    className="h-10 bg-card pl-9 pr-9"
                  />
                  {search.q && (
                    <button
                      type="button"
                      onClick={() => setSearch({ q: '' })}
                      aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>

                <Select
                  value={effectiveSort}
                  onValueChange={(v) => setSearch({ sort: v as SortMode })}
                  disabled={search.tab === 'new'}
                >
                  <SelectTrigger className="h-10 w-[150px] bg-card" aria-label="Sort tokens">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {SORT_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div
                  className="inline-flex rounded-lg border border-border bg-card p-1"
                  role="group"
                  aria-label="Layout"
                >
                  {(
                    [
                      { view: 'grid', icon: LayoutGrid, label: 'Card grid' },
                      { view: 'table', icon: Table2, label: 'Screener table' },
                    ] as const
                  ).map(({ view, icon: Icon, label }) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setSearch({ view })}
                      aria-pressed={search.view === view}
                      aria-label={label}
                      title={label}
                      className={cn(
                        'rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        search.view === view
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>

              {/* Stage filter */}
              <div
                className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]"
                role="group"
                aria-label="Filter by stage"
              >
                {STAGES.map(({ stage, label }) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setSearch({ stage })}
                    aria-pressed={search.stage === stage}
                    className={cn(
                      'inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      search.stage === stage
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {label}
                    <span className="text-xs tabular-nums opacity-60">{stageCounts[stage]}</span>
                  </button>
                ))}
              </div>

              <TokenScreenerControls
                filters={filters}
                onFiltersChange={setFilters}
                activePreset={search.preset ?? null}
                onPreset={applyPreset}
              />
            </div>

            {/* Results */}
            <QueryState
              isLoading={isLoading}
              isError={isError}
              isEmpty={screened.length === 0}
              onRetry={() => refetch()}
              errorMessage="Couldn't load tokens. The indexer may be temporarily unavailable."
              loadingState={<GridSkeleton />}
              emptyState={
                <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
                  <Rocket className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
                  <h3 className="text-lg font-semibold">
                    {search.tab === 'watchlist'
                      ? 'Your watchlist is empty'
                      : search.q
                        ? `No tokens match “${search.q}”`
                        : tokens.length === 0
                          ? 'No tokens launched yet'
                          : 'No tokens match these filters'}
                  </h3>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    {search.tab === 'watchlist'
                      ? 'Star any token to keep an eye on it here.'
                      : tokens.length === 0
                        ? 'Be the first — launching takes one transaction.'
                        : 'Loosen the filters or clear the preset.'}
                  </p>
                  <div className="mt-5 flex justify-center gap-2">
                    {hasNarrowing && search.tab !== 'watchlist' && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFilters(EMPTY_FILTERS);
                          setSearch({ q: '', stage: 'all', preset: undefined });
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                    <Button asChild>
                      <Link to="/tokens/launch">
                        <Rocket className="mr-2 h-4 w-4" aria-hidden />
                        Launch a token
                      </Link>
                    </Button>
                  </div>
                </div>
              }
            >
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {screened.length} {screened.length === 1 ? 'token' : 'tokens'}
                {search.tab === 'new' && ' launched in the last 24h'}
              </p>
              {search.view === 'table' ? (
                <TokenTable
                  tokens={screened}
                  sortMode={effectiveSort}
                  onSort={(mode) => setSearch({ sort: mode })}
                  isWatched={isWatched}
                  onToggleWatch={toggleWatch}
                  commentCountFor={commentCountFor}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {screened.map((token) => (
                    <TokenCard
                      key={token.id}
                      token={token}
                      isWatched={isWatched(token.id)}
                      onToggleWatch={() => toggleWatch(token.id, token.symbol)}
                      commentCount={commentCountFor(token.id)}
                    />
                  ))}
                </div>
              )}
            </QueryState>
          </main>

          <aside className="lg:sticky lg:top-[7.5rem] lg:self-start">
            <LiveTradesFeed items={liveActivity} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <div className="min-w-[110px] px-4 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">
        {value == null ? <Skeleton className="mt-1 h-5 w-14" /> : value}
      </dd>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="flex gap-3">
            <Skeleton className="h-16 w-16 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-4 w-20 rounded-full" />
            </div>
          </div>
          <Skeleton className="mt-5 h-6 w-24" />
          <Skeleton className="mt-4 h-1.5 w-full" />
          <Skeleton className="mt-4 h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
