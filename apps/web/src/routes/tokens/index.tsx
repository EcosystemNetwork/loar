/**
 * Token Launchpad — Discover & browse all launched universe tokens.
 *
 * pump.fun-style discovery with two views (card grid + dense screener table),
 * URL-persisted sort/stage/search/preset/tab state, an advanced filter panel,
 * one-click screener presets, a watchlist tab, a "new pairs" stream, a
 * recently-viewed rail, and a live cross-token activity feed.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, memo } from 'react';
import {
  useTokenListData,
  type EnrichedToken,
  type TokenStage,
  formatEth,
  formatCompactEth,
  timeAgo,
  weiToNumber,
} from '@/hooks/useTokens';
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
} from '@/lib/token-screener';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkline } from '@/components/tokens/Sparkline';
import { TokenTable } from '@/components/tokens/TokenTable';
import { TokenScreenerControls } from '@/components/tokens/TokenScreenerControls';
import { QuickBuyButton } from '@/components/tokens/QuickBuyButton';
import {
  Rocket,
  Search,
  TrendingUp,
  ArrowUpDown,
  Flame,
  Clock,
  Users,
  Zap,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  DollarSign,
  Target,
  Star,
  Share2,
  LayoutGrid,
  Table2,
  Sparkles,
} from 'lucide-react';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { QueryState } from '@/components/QueryState';

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

interface LiveActivityItem {
  kind: 'swap' | 'bondingTrade';
  id: string;
  timestamp: number;
  sender: string;
  token: EnrichedToken;
  isBuy: boolean;
  ethAmountWei: string;
}

const SORT_META: { mode: SortMode; icon: typeof Flame; label: string }[] = [
  { mode: 'trending', icon: Flame, label: 'Trending' },
  { mode: 'newest', icon: Clock, label: 'New' },
  { mode: 'gainers', icon: TrendingUp, label: 'Gainers' },
  { mode: 'volume', icon: Activity, label: 'Volume' },
  { mode: 'liquidity', icon: DollarSign, label: 'Liquidity' },
  { mode: 'mcap', icon: Target, label: 'MCap' },
  { mode: 'holders', icon: Users, label: 'Holders' },
  { mode: 'name', icon: ArrowUpDown, label: 'A-Z' },
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Rocket className="h-8 w-8 text-primary" />
              <h1 className="text-3xl md:text-4xl font-bold">Token Launchpad</h1>
            </div>
            <p className="text-muted-foreground">
              Discover universe tokens. Every token = governance over a narrative universe.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/tokens/swap">
              <Button variant="outline" size="lg" className="gap-2">
                <ArrowUpDown className="h-5 w-5" />
                Swap
              </Button>
            </Link>
            <Link to="/tokens/portfolio">
              <Button variant="outline" size="lg" className="gap-2">
                <Star className="h-5 w-5" />
                Portfolio
              </Button>
            </Link>
            <Link to="/tokens/launch">
              <Button size="lg" className="font-bold gap-2">
                <Plus className="h-5 w-5" />
                Launch Token
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
          <StatCard
            icon={Rocket}
            tint="primary"
            value={String(tokens.length)}
            label="Tokens Launched"
          />
          <StatCard
            icon={DollarSign}
            tint="green"
            value={totalMarketCap > 0 ? formatCompactEth(totalMarketCap) : '--'}
            label="Total MCap (ETH)"
          />
          <StatCard
            icon={TrendingUp}
            tint="purple"
            value={String(gainers24h)}
            label="Gainers (24h)"
          />
          <StatCard
            icon={Activity}
            tint="amber"
            value={String(liveActivity.length)}
            label="Recent Trades"
          />
          <StatCard icon={Zap} tint="blue" value="LP Locked" label="Forever. No Rugs." />
        </div>

        {/* Recently viewed */}
        {recentTokens.length > 0 && search.tab === 'all' && (
          <div className="mb-5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
              <Clock className="h-3 w-3" />
              Recently viewed
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentTokens.map((t) => (
                <Link
                  key={t.id}
                  to="/tokens/$address"
                  params={{ address: t.id }}
                  className="flex flex-shrink-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 hover:border-primary/50"
                >
                  {t.imageURL ? (
                    <img
                      src={t.imageURL}
                      alt={t.symbol}
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
                      {t.symbol.slice(0, 3)}
                    </span>
                  )}
                  <span className="text-xs font-semibold">${t.symbol}</span>
                  {t.priceChange24h != null && (
                    <span
                      className={`text-[10px] font-mono ${
                        t.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      {t.priceChange24h >= 0 ? '+' : ''}
                      {t.priceChange24h.toFixed(1)}%
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Token Grid */}
          <div className="lg:col-span-3">
            {/* Tabs + view toggle */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {(
                  [
                    { tab: 'all' as ScreenerTab, label: 'All', icon: Rocket },
                    { tab: 'new' as ScreenerTab, label: 'New pairs', icon: Sparkles },
                    { tab: 'watchlist' as ScreenerTab, label: `Watchlist`, icon: Star },
                  ] as const
                ).map(({ tab, label, icon: Icon }) => (
                  <Button
                    key={tab}
                    variant={search.tab === tab ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSearch({ tab })}
                    className="h-8 gap-1.5 px-3 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {tab === 'watchlist' && watchCount > 0 && (
                      <span className="ml-0.5 text-[10px] opacity-70 tabular-nums">
                        {watchCount}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
              <div className="flex gap-1 rounded-lg border p-0.5">
                <button
                  onClick={() => setSearch({ view: 'grid' })}
                  className={`rounded-md p-1.5 ${
                    search.view === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground'
                  }`}
                  title="Card grid"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setSearch({ view: 'table' })}
                  className={`rounded-md p-1.5 ${
                    search.view === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground'
                  }`}
                  title="Screener table"
                >
                  <Table2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Stage filter tabs */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(
                [
                  { stage: 'all' as StageFilter, label: 'All' },
                  { stage: 'bonding' as StageFilter, label: 'Bonding' },
                  { stage: 'graduating' as StageFilter, label: 'Graduating' },
                  { stage: 'graduated' as StageFilter, label: 'Graduated' },
                  { stage: 'halted' as StageFilter, label: 'Halted' },
                ] as const
              ).map(({ stage, label }) => (
                <Button
                  key={stage}
                  variant={search.stage === stage ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSearch({ stage })}
                  className="h-8 px-3 text-xs"
                >
                  {label}
                  <span className="ml-1.5 text-[10px] opacity-60 tabular-nums">
                    {stageCounts[stage]}
                  </span>
                </Button>
              ))}
            </div>

            {/* Search & Sort */}
            <div className="mb-3 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, symbol, or address..."
                  value={search.q}
                  onChange={(e) => setSearch({ q: e.target.value })}
                  className="h-10 pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SORT_META.map(({ mode, icon: Icon, label }) => (
                  <Button
                    key={mode}
                    variant={search.sort === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSearch({ sort: mode })}
                    className="h-8 px-2.5 text-xs"
                    disabled={search.tab === 'new'}
                  >
                    <Icon className="mr-1 h-3 w-3" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Presets + advanced filters */}
            <div className="mb-4">
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
              errorMessage="Failed to load tokens. The indexer may be temporarily unavailable."
              skeletonCount={6}
              skeletonAspect="aspect-[3/4]"
              skeletonGrid="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
              emptyState={
                <Card>
                  <CardContent className="py-16 text-center">
                    <Rocket className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="mb-2 text-lg font-semibold">
                      {search.tab === 'watchlist'
                        ? 'Your watchlist is empty'
                        : search.q
                          ? 'No tokens match your search'
                          : 'No tokens match these filters'}
                    </h3>
                    <p className="mb-4 text-muted-foreground">
                      {search.tab === 'watchlist'
                        ? 'Tap the star on any token to add it here.'
                        : 'Try loosening the filters or clearing the preset.'}
                    </p>
                    <Link to="/tokens/launch">
                      <Button>
                        <Rocket className="mr-2 h-4 w-4" />
                        Launch a Token
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              }
            >
              {search.view === 'table' ? (
                <TokenTable
                  tokens={screened}
                  sortMode={search.tab === 'new' ? 'newest' : search.sort}
                  onSort={(mode) => setSearch({ sort: mode })}
                  isWatched={isWatched}
                  onToggleWatch={toggleWatch}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {screened.map((token) => (
                    <TokenCard
                      key={token.id}
                      token={token}
                      isWatched={isWatched(token.id)}
                      onToggleWatch={() => toggleWatch(token.id, token.symbol)}
                    />
                  ))}
                </div>
              )}
            </QueryState>
          </div>

          {/* Activity Feed Sidebar */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <CardContent className="p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Live Activity</h3>
                  <div className="ml-auto h-2 w-2 animate-pulse rounded-full bg-green-500" />
                </div>

                {liveActivity.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">No trades yet</p>
                ) : (
                  <div className="max-h-[600px] space-y-1.5 overflow-y-auto">
                    {liveActivity.map((item) => (
                      <Link
                        key={item.id}
                        to="/tokens/$address"
                        params={{ address: item.token.id }}
                        className="flex items-center gap-2 rounded-lg bg-muted/50 p-2 text-xs transition-colors hover:bg-muted/80"
                      >
                        <div
                          className={`h-8 w-1.5 flex-shrink-0 rounded-full ${
                            item.isBuy ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={item.isBuy ? 'default' : 'destructive'}
                              className="h-4 px-1 py-0 text-[9px]"
                            >
                              {item.isBuy ? 'BUY' : 'SELL'}
                            </Badge>
                            <span className="truncate text-[11px] font-semibold">
                              ${item.token.symbol}
                            </span>
                            {item.kind === 'bondingTrade' && (
                              <Badge
                                variant="outline"
                                className="h-3.5 border-amber-500/40 px-1 py-0 text-[8px] text-amber-500"
                              >
                                curve
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center justify-between">
                            <AddressDisplay
                              address={item.sender}
                              className="text-[10px] text-muted-foreground"
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {timeAgo(item.timestamp)}
                            </span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="font-mono text-[11px] font-semibold">
                            {formatEth(item.ethAmountWei)}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────

const TINTS: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  green: 'bg-green-500/10 text-green-500',
  purple: 'bg-purple-500/10 text-purple-500',
  amber: 'bg-amber-500/10 text-amber-500',
  blue: 'bg-blue-500/10 text-blue-500',
};

function StatCard({
  icon: Icon,
  tint,
  value,
  label,
}: {
  icon: typeof Rocket;
  tint: keyof typeof TINTS | string;
  value: string;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2 ${TINTS[tint] ?? TINTS.primary}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Stage Badge ─────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: TokenStage }) {
  const config = {
    bonding: { label: 'Bonding', className: 'bg-primary/80 text-white' },
    graduating: { label: 'Graduating', className: 'bg-amber-500/80 text-white' },
    graduated: { label: 'Graduated', className: 'bg-green-500/80 text-white' },
    halted: { label: 'Halted', className: 'bg-red-500/80 text-white' },
  }[stage];
  return (
    <Badge className={`border-0 px-1.5 py-0 text-[10px] backdrop-blur-sm ${config.className}`}>
      {config.label}
    </Badge>
  );
}

// ─── Graduation / Maturity progress ─────────────────────────────────

function GraduationProgress({ token }: { token: EnrichedToken }) {
  const curve = token.bondingCurve;
  if (!curve) return null;
  const raised = weiToNumber(curve.ethRaised, 18);
  const target = weiToNumber(curve.graduationEth, 18);
  const pct = target > 0 ? Math.min((raised / target) * 100, 100) : 0;
  const isGraduating = token.stage === 'graduating';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Zap className="h-2.5 w-2.5" />
          {token.stage === 'halted' ? 'Halted' : 'Graduation'}
        </span>
        <span className="font-mono font-medium tabular-nums">
          {raised.toFixed(3)} / {target.toFixed(1)} ETH
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${
            token.stage === 'halted'
              ? 'bg-red-500'
              : isGraduating
                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                : 'bg-gradient-to-r from-primary to-purple-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MaturityProgress({ token }: { token: EnrichedToken }) {
  const milestones = [
    { label: 'First trade', met: token.totalSwaps >= 1 },
    { label: '10 holders', met: token.holderCount >= 10 },
    { label: '50 swaps', met: token.totalSwaps >= 50 },
    { label: '100 holders', met: token.holderCount >= 100 },
    { label: '500 swaps', met: token.totalSwaps >= 500 },
  ];
  const completed = milestones.filter((m) => m.met).length;
  const pct = (completed / milestones.length) * 100;
  const next = milestones.find((m) => !m.met);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Target className="h-2.5 w-2.5" />
          Maturity
        </span>
        <span className="font-medium">
          {completed}/{milestones.length}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 via-green-500 to-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {next && <p className="text-[9px] text-muted-foreground">Next: {next.label}</p>}
    </div>
  );
}

// ─── Token Card ──────────────────────────────────────────────────────

const TokenCard = memo(function TokenCard({
  token,
  isWatched,
  onToggleWatch,
}: {
  token: EnrichedToken;
  isWatched: boolean;
  onToggleWatch: () => void;
}) {
  const isBrandNew = Math.floor(Date.now() / 1000) - token.createdAt < 1800;
  return (
    <Link to="/tokens/$address" params={{ address: token.id }}>
      <Card className="group cursor-pointer overflow-hidden transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
        <CardContent className="p-0">
          {/* Token Image */}
          <div className="relative h-28 overflow-hidden bg-gradient-to-br from-primary/20 via-purple-500/20 to-pink-500/20">
            {token.imageURL ? (
              <img
                src={token.imageURL}
                alt={token.name}
                className="h-full w-full object-cover opacity-80 transition-all group-hover:scale-105 group-hover:opacity-100"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl font-bold text-primary/30">${token.symbol}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            <div className="absolute left-2 top-2 flex items-center gap-1">
              <StageBadge stage={token.stage} />
              {isBrandNew && (
                <Badge className="border-0 bg-sky-500/90 px-1.5 py-0 text-[9px] text-white">
                  NEW
                </Badge>
              )}
            </div>

            <div className="absolute right-2 top-2 flex items-center gap-1">
              {token.priceChange24h !== null && (
                <Badge
                  className={`border-0 px-1.5 py-0 text-[10px] backdrop-blur-sm ${
                    token.priceChange24h >= 0
                      ? 'bg-green-500/80 text-white'
                      : 'bg-red-500/80 text-white'
                  }`}
                >
                  {token.priceChange24h >= 0 ? (
                    <ArrowUpRight className="mr-0.5 h-2.5 w-2.5" />
                  ) : (
                    <ArrowDownRight className="mr-0.5 h-2.5 w-2.5" />
                  )}
                  {Math.abs(token.priceChange24h).toFixed(1)}%
                </Badge>
              )}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleWatch();
                }}
                className="rounded-full bg-black/40 p-1 text-white/80 backdrop-blur-sm hover:text-yellow-400"
                title={isWatched ? 'Unwatch' : 'Watch'}
              >
                <Star className={`h-3 w-3 ${isWatched ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              </button>
            </div>

            <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between">
              <div>
                <p className="text-sm font-bold text-white drop-shadow">{token.name}</p>
                <Badge className="border-0 bg-white/20 text-[10px] text-white backdrop-blur-sm">
                  ${token.symbol}
                </Badge>
              </div>
              <Badge
                variant="outline"
                className="border-white/20 bg-black/40 text-[10px] text-white backdrop-blur-sm"
              >
                {timeAgo(token.createdAt)}
              </Badge>
            </div>
          </div>

          {/* Token Info */}
          <div className="space-y-2.5 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Price</p>
                <p className="font-mono text-sm font-bold tabular-nums">
                  {token.price != null
                    ? token.price < 0.001
                      ? token.price.toExponential(2)
                      : token.price.toFixed(6)
                    : '--'}
                  <span className="ml-1 text-[10px] text-muted-foreground">ETH</span>
                </p>
                {token.priceChange1h != null && (
                  <p
                    className={`text-[10px] font-mono ${
                      token.priceChange1h >= 0 ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {token.priceChange1h >= 0 ? '+' : ''}
                    {token.priceChange1h.toFixed(1)}% · 1h
                  </p>
                )}
              </div>
              <Sparkline data={token.sparkline} width={72} height={28} />
            </div>

            <div className="grid grid-cols-4 gap-1.5 text-center">
              <MiniStat value={String(token.holderCount)} label="Holders" />
              <MiniStat value={String(token.totalSwaps)} label="Swaps" />
              <MiniStat
                value={token.volume24h >= 0.001 ? formatCompactEth(token.volume24h) : '--'}
                label="Vol 24h"
              />
              <MiniStat
                value={token.liquidityEth >= 0.001 ? formatCompactEth(token.liquidityEth) : '--'}
                label="Liq"
              />
            </div>

            {token.marketCap != null && token.marketCap > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">MCap</span>
                <span className="font-mono font-medium tabular-nums">
                  {formatCompactEth(token.marketCap)} ETH
                  {token.fdv != null &&
                    token.fdv !== token.marketCap &&
                    token.bondingCurve &&
                    !token.bondingCurve.graduated && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        / {formatCompactEth(token.fdv)} FDV
                      </span>
                    )}
                </span>
              </div>
            )}

            {token.stage === 'graduated' ? (
              <MaturityProgress token={token} />
            ) : (
              <GraduationProgress token={token} />
            )}

            <div className="flex items-center justify-between pt-0.5">
              <QuickBuyButton tokenId={token.id} />
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Users className="h-2.5 w-2.5" />
                  Governance
                </Badge>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.writeText(`${window.location.origin}/tokens/${token.id}`);
                  }}
                  className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                  title="Copy link"
                >
                  <Share2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
});

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-1 py-1.5">
      <p className="text-xs font-bold tabular-nums">{value}</p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}
