/**
 * Token Launchpad — Discover & browse all launched universe tokens.
 *
 * pump.fun-style listing with enriched token cards (price, 24h change,
 * sparkline, holder count), trending sort, live activity feed, and
 * token maturity progress indicators.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, memo } from 'react';
import {
  useTokenListData,
  type EnrichedToken,
  formatEth,
  timeAgo,
  priceFromTick,
} from '@/hooks/useTokens';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Rocket,
  Search,
  TrendingUp,
  ArrowUpDown,
  Flame,
  Clock,
  Users,
  ExternalLink,
  Loader2,
  Zap,
  BarChart3,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  DollarSign,
  Target,
  Bookmark,
  Share2,
} from 'lucide-react';
import { useChainId } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { getExplorerAddressUrl } from '@/configs/chains';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { QueryState } from '@/components/QueryState';

export const Route = createFileRoute('/tokens/')({
  component: TokenLaunchpad,
});

type SortMode = 'trending' | 'newest' | 'holders' | 'volume' | 'name';

function TokenLaunchpad() {
  const chainId = useChainId();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('trending');
  const {
    data: tokens,
    isLoading,
    isError,
    refetch,
    recentSwaps,
    totalMarketCap,
  } = useTokenListData();

  const filteredTokens = useMemo(() => {
    if (!tokens.length) return [];
    let result = [...tokens];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.symbol.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      );
    }

    switch (sortMode) {
      case 'trending':
        result.sort((a, b) => b.swapCount24h - a.swapCount24h || b.volume24h - a.volume24h);
        break;
      case 'newest':
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'holders':
        result.sort((a, b) => b.holderCount - a.holderCount);
        break;
      case 'volume':
        result.sort((a, b) => b.volume24h - a.volume24h);
        break;
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return result;
  }, [tokens, search, sortMode]);

  // Enrich swaps with token info for the activity feed
  const enrichedSwaps = useMemo(() => {
    if (!recentSwaps.length || !tokens.length) return [];
    const poolToToken = new Map<string, EnrichedToken>();
    for (const t of tokens) {
      poolToToken.set(t.poolId, t);
    }
    return recentSwaps.slice(0, 25).map((swap) => ({
      ...swap,
      token: poolToToken.get(swap.poolId),
    }));
  }, [recentSwaps, tokens]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
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
                <Bookmark className="h-5 w-5" />
                Portfolio
              </Button>
            </Link>
            <Link to="/cinematicUniverseCreate">
              <Button size="lg" className="font-bold gap-2">
                <Plus className="h-5 w-5" />
                Launch Token
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Rocket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{tokens.length}</p>
                <p className="text-xs text-muted-foreground">Tokens Launched</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <DollarSign className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">
                  {totalMarketCap > 0
                    ? totalMarketCap >= 1000
                      ? `${(totalMarketCap / 1000).toFixed(1)}K`
                      : totalMarketCap.toFixed(2)
                    : '--'}
                </p>
                <p className="text-xs text-muted-foreground">Total MCap (ETH)</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <TrendingUp className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{recentSwaps.length}</p>
                <p className="text-xs text-muted-foreground">Recent Swaps</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Flame className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">100B</p>
                <p className="text-xs text-muted-foreground">Supply / Token</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Zap className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">LP Locked</p>
                <p className="text-xs text-muted-foreground">Forever. No Rugs.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Token Grid */}
          <div className="lg:col-span-3">
            {/* Search & Sort */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, symbol, or address..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(
                  [
                    { mode: 'trending' as SortMode, icon: Flame, label: 'Trending' },
                    { mode: 'newest' as SortMode, icon: Clock, label: 'New' },
                    { mode: 'holders' as SortMode, icon: Users, label: 'Holders' },
                    { mode: 'volume' as SortMode, icon: TrendingUp, label: 'Volume' },
                    { mode: 'name' as SortMode, icon: ArrowUpDown, label: 'A-Z' },
                  ] as const
                ).map(({ mode, icon: Icon, label }) => (
                  <Button
                    key={mode}
                    variant={sortMode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSortMode(mode)}
                    className="text-xs h-8 px-2.5"
                  >
                    <Icon className="h-3 w-3 mr-1" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Token Cards */}
            <QueryState
              isLoading={isLoading}
              isError={isError}
              isEmpty={filteredTokens.length === 0}
              onRetry={() => refetch()}
              errorMessage="Failed to load tokens. The indexer may be temporarily unavailable."
              skeletonCount={6}
              skeletonAspect="aspect-[3/4]"
              skeletonGrid="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
              emptyState={
                <Card>
                  <CardContent className="text-center py-16">
                    <Rocket className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">
                      {search ? 'No tokens match your search' : 'No tokens launched yet'}
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      {search
                        ? 'Try a different search term'
                        : 'Be the first to launch a universe token!'}
                    </p>
                    {!search && (
                      <Link to="/cinematicUniverseCreate">
                        <Button>
                          <Rocket className="h-4 w-4 mr-2" />
                          Launch First Token
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredTokens.map((token) => (
                  <TokenCard key={token.id} token={token} chainId={chainId} />
                ))}
              </div>
            </QueryState>
          </div>

          {/* Activity Feed Sidebar */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Live Activity</h3>
                  <div className="ml-auto h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                </div>

                {enrichedSwaps.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No swaps yet</p>
                ) : (
                  <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
                    {enrichedSwaps.map((swap) => {
                      const isBuy = BigInt(swap.amount0) > 0n;
                      return (
                        <Link
                          key={swap.id}
                          to={swap.token ? '/tokens/$address' : '/tokens'}
                          params={swap.token ? { address: swap.token.id } : undefined}
                          className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs hover:bg-muted/80 transition-colors"
                        >
                          <div
                            className={`w-1.5 h-8 rounded-full flex-shrink-0 ${isBuy ? 'bg-green-500' : 'bg-red-500'}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant={isBuy ? 'default' : 'destructive'}
                                className="text-[9px] px-1 py-0 h-4"
                              >
                                {isBuy ? 'BUY' : 'SELL'}
                              </Badge>
                              {swap.token && (
                                <span className="font-semibold truncate text-[11px]">
                                  ${swap.token.symbol}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <AddressDisplay
                                address={swap.sender}
                                className="text-[10px] text-muted-foreground"
                              />
                              <span className="text-[10px] text-muted-foreground">
                                {timeAgo(swap.timestamp)}
                              </span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-mono text-[11px] font-semibold">
                              {formatEth(swap.amount1)}
                            </p>
                          </div>
                        </Link>
                      );
                    })}
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

// ─── Sparkline SVG ────────────────────────────────────────────────────

let sparklineIdCounter = 0;

const Sparkline = memo(function Sparkline({
  data,
  width = 80,
  height = 32,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  const [gradientId] = useState(() => `spark-${++sparklineIdCounter}`);

  if (data.length < 2) return <div style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const isPositive = data[data.length - 1] >= data[0];
  const color = isPositive ? '#22c55e' : '#ef4444';

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  // Gradient fill area
  const firstX = 0;
  const lastX = width;
  const areaPoints = `${firstX},${height} ${points} ${lastX},${height}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradientId})`} points={areaPoints} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
});

// ─── Token Maturity Progress ──────────────────────────────────────────

function MaturityProgress({ token }: { token: EnrichedToken }) {
  // Milestones: first trade, 10 holders, 50 swaps, 100 holders, 500 swaps
  const milestones = [
    { label: 'First trade', met: token.totalSwaps >= 1 },
    { label: '10 holders', met: token.holderCount >= 10 },
    { label: '50 swaps', met: token.totalSwaps >= 50 },
    { label: '100 holders', met: token.holderCount >= 100 },
    { label: '500 swaps', met: token.totalSwaps >= 500 },
  ];

  const completed = milestones.filter((m) => m.met).length;
  const pct = (completed / milestones.length) * 100;

  // Find next milestone
  const next = milestones.find((m) => !m.met);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground flex items-center gap-1">
          <Target className="h-2.5 w-2.5" />
          Maturity
        </span>
        <span className="font-medium">
          {completed}/{milestones.length}
        </span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all bg-gradient-to-r from-amber-500 via-green-500 to-emerald-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {next && <p className="text-[9px] text-muted-foreground">Next: {next.label}</p>}
    </div>
  );
}

// ─── Token Card Component ─────────────────────────────────────────────

const TokenCard = memo(function TokenCard({
  token,
  chainId,
}: {
  token: EnrichedToken;
  chainId: number;
}) {
  return (
    <Link to="/tokens/$address" params={{ address: token.id }}>
      <Card className="group hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5 cursor-pointer overflow-hidden">
        <CardContent className="p-0">
          {/* Token Image */}
          <div className="relative h-28 bg-gradient-to-br from-primary/20 via-purple-500/20 to-pink-500/20 overflow-hidden">
            {token.imageURL ? (
              <img
                src={token.imageURL}
                alt={token.name}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl font-bold text-primary/30">${token.symbol}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            {/* Price change badge - top right */}
            {token.priceChange24h !== null && (
              <div className="absolute top-2 right-2">
                <Badge
                  className={`text-[10px] px-1.5 py-0 border-0 backdrop-blur-sm ${
                    token.priceChange24h >= 0
                      ? 'bg-green-500/80 text-white'
                      : 'bg-red-500/80 text-white'
                  }`}
                >
                  {token.priceChange24h >= 0 ? (
                    <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                  ) : (
                    <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />
                  )}
                  {Math.abs(token.priceChange24h).toFixed(1)}%
                </Badge>
              </div>
            )}

            {/* Name + symbol overlay */}
            <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between">
              <div>
                <p className="text-white font-bold text-sm drop-shadow">{token.name}</p>
                <Badge className="bg-white/20 backdrop-blur-sm text-white border-0 text-[10px]">
                  ${token.symbol}
                </Badge>
              </div>
              <Badge
                variant="outline"
                className="bg-black/40 backdrop-blur-sm text-white border-white/20 text-[10px]"
              >
                {timeAgo(token.createdAt)}
              </Badge>
            </div>
          </div>

          {/* Token Info */}
          <div className="p-3 space-y-2.5">
            {/* Price + Sparkline row */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Price</p>
                <p className="text-sm font-bold font-mono tabular-nums">
                  {token.price != null
                    ? token.price < 0.001
                      ? token.price.toExponential(2)
                      : token.price.toFixed(6)
                    : '--'}
                  <span className="text-[10px] text-muted-foreground ml-1">ETH</span>
                </p>
              </div>
              <Sparkline data={token.sparkline} width={72} height={28} />
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/50 rounded-md py-1.5 px-1">
                <p className="text-xs font-bold tabular-nums">{token.holderCount}</p>
                <p className="text-[9px] text-muted-foreground">Holders</p>
              </div>
              <div className="bg-muted/50 rounded-md py-1.5 px-1">
                <p className="text-xs font-bold tabular-nums">{token.totalSwaps}</p>
                <p className="text-[9px] text-muted-foreground">Swaps</p>
              </div>
              <div className="bg-muted/50 rounded-md py-1.5 px-1">
                <p className="text-xs font-bold tabular-nums">
                  {token.volume24h >= 0.001 ? token.volume24h.toFixed(3) : '--'}
                </p>
                <p className="text-[9px] text-muted-foreground">Vol 24h</p>
              </div>
            </div>

            {/* Market Cap */}
            {token.marketCap != null && token.marketCap > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">MCap</span>
                <span className="font-mono font-medium tabular-nums">
                  {token.marketCap >= 1000
                    ? `${(token.marketCap / 1000).toFixed(1)}K ETH`
                    : `${token.marketCap.toFixed(2)} ETH`}
                </span>
              </div>
            )}

            {/* Maturity Progress */}
            <MaturityProgress token={token} />

            {/* Badges + Share */}
            <div className="flex items-center justify-between pt-0.5">
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Zap className="h-2.5 w-2.5" />
                  LP Locked
                </Badge>
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Users className="h-2.5 w-2.5" />
                  Governance
                </Badge>
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const url = `${window.location.origin}/tokens/${token.id}`;
                  navigator.clipboard.writeText(url);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title="Copy link"
              >
                <Share2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
});
