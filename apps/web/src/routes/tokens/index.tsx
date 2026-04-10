/**
 * Token Launchpad — Discover & browse all launched universe tokens.
 *
 * pump.fun-style listing page with search, sort, and live activity feed.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import {
  useAllTokens,
  useSwapHistory,
  formatTokenAmount,
  formatEth,
  timeAgo,
  priceFromTick,
} from '@/hooks/useTokens';
import { useTokenPool } from '@/hooks/useTokenSwap';
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
} from 'lucide-react';
import { ponderGql, ponderQueryDefaults } from '@/utils/ponder-api';
import { useQuery } from '@tanstack/react-query';
import { useChainId } from 'wagmi';
import { getExplorerAddressUrl } from '@/configs/chains';

export const Route = createFileRoute('/tokens/')({
  component: TokenLaunchpad,
});

type SortMode = 'newest' | 'oldest' | 'name';

function TokenLaunchpad() {
  const chainId = useChainId();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const { data: tokens, isLoading } = useAllTokens();

  // Fetch recent swaps across all pools for the activity feed
  const { data: recentSwaps } = useQuery({
    queryKey: ['recent-swaps-global'],
    queryFn: async () => {
      const data = await ponderGql<{
        swaps: {
          items: Array<{
            id: string;
            poolId: string;
            sender: string;
            amount0: string;
            amount1: string;
            tick: number;
            timestamp: number;
          }>;
        };
      }>(
        `query {
          swaps(orderBy: "timestamp", orderDirection: "desc", limit: 20) {
            items {
              id poolId sender amount0 amount1 tick timestamp
            }
          }
        }`
      );
      return data.swaps.items;
    },
    ...ponderQueryDefaults,
    refetchInterval: 10_000,
  });

  const filteredTokens = useMemo(() => {
    if (!tokens) return [];
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
      case 'newest':
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'oldest':
        result.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return result;
  }, [tokens, search, sortMode]);

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
          <Link to="/cinematicUniverseCreate">
            <Button size="lg" className="font-bold gap-2">
              <Plus className="h-5 w-5" />
              Launch Token
            </Button>
          </Link>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Rocket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{tokens?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Tokens Launched</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{recentSwaps?.length ?? 0}</p>
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
              <div className="flex gap-2">
                {(['newest', 'oldest', 'name'] as SortMode[]).map((mode) => (
                  <Button
                    key={mode}
                    variant={sortMode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSortMode(mode)}
                    className="capitalize"
                  >
                    {mode === 'newest' ? (
                      <Clock className="h-3 w-3 mr-1" />
                    ) : mode === 'name' ? (
                      <ArrowUpDown className="h-3 w-3 mr-1" />
                    ) : null}
                    {mode}
                  </Button>
                ))}
              </div>
            </div>

            {/* Token Cards */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTokens.length === 0 ? (
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
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredTokens.map((token) => (
                  <TokenCard key={token.id} token={token} chainId={chainId} />
                ))}
              </div>
            )}
          </div>

          {/* Activity Feed Sidebar */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Live Activity</h3>
                  <div className="ml-auto h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                </div>

                {!recentSwaps || recentSwaps.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No swaps yet</p>
                ) : (
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {recentSwaps.map((swap) => (
                      <div
                        key={swap.id}
                        className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs"
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${BigInt(swap.amount0) > 0n ? 'bg-green-500' : 'bg-red-500'}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono truncate text-[10px]">
                            {swap.sender.slice(0, 6)}...{swap.sender.slice(-4)}
                          </p>
                          <p className="text-muted-foreground text-[10px]">
                            {timeAgo(swap.timestamp)}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px] px-1">
                          {BigInt(swap.amount0) > 0n ? 'BUY' : 'SELL'}
                        </Badge>
                      </div>
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

// ─── Token Card Component ──────────────────────────────────────────────

function TokenCard({ token, chainId }: { token: any; chainId: number }) {
  return (
    <Link to="/tokens/$address" params={{ address: token.id }}>
      <Card className="group hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5 cursor-pointer overflow-hidden">
        <CardContent className="p-0">
          {/* Token Image */}
          <div className="relative h-32 bg-gradient-to-br from-primary/20 via-purple-500/20 to-pink-500/20 overflow-hidden">
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
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
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
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Pair</span>
              <span className="font-medium">${token.symbol} / ETH</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Supply</span>
              <span className="font-medium">100B</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Contract</span>
              <span className="font-mono text-[10px]">
                {token.id.slice(0, 8)}...{token.id.slice(-6)}
              </span>
            </div>

            {/* LP Locked Badge */}
            <div className="flex items-center gap-1.5 pt-1">
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Zap className="h-2.5 w-2.5" />
                LP Locked Forever
              </Badge>
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Users className="h-2.5 w-2.5" />
                Governance
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
