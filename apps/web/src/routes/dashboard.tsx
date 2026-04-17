/**
 * Dashboard — Creator command center.
 *
 * Real data from: portfolio.summary, credits.getBalance, revenue.getDashboard,
 * staking.getProfile, useTokenListData, useMyNFTs.
 * Replaces the old static layout with a data-driven, responsive dashboard.
 */

import { createFileRoute, redirect, Link as RouterLink } from '@tanstack/react-router';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Users,
  Plus,
  Wand2,
  Film,
  Rocket,
  TrendingUp,
  Upload,
  Search,
  Grid3x3,
  List,
  Trash2,
  Eye,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  ChevronUp,
  Coins,
  Wallet,
  BarChart3,
  Zap,
  Crown,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  ShoppingBag,
  Activity,
  Star,
  Bell,
  BookOpen,
  Paintbrush,
  Video,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GenerativeMedia } from '@/components/GenerativeMedia';
import { QuestsPanel } from '@/components/QuestsPanel';
import { DailyCheckin } from '@/components/DailyCheckin';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { UploadForm } from '@/components/UploadForm';
import { useCreditBalance, useMyNFTs } from '@/hooks/useRevenue';
import { useTokenListData, type EnrichedToken } from '@/hooks/useTokens';
import { LPYieldManager } from '@/components/LPYieldManager';
import { toast } from 'sonner';

import { useWalletAuth } from '@/lib/wallet-auth';
import { useEffect, useState, useMemo } from 'react';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/dashboard' } });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { address, isConnected, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = Route.useNavigate();

  // ── Real data hooks ─────────────────────────────────────────────────
  const { data: creditData } = useCreditBalance();
  const { data: myNfts } = useMyNFTs();
  const { data: tokenList } = useTokenListData();

  const { data: portfolioData } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: () => trpcClient.portfolio.summary.query(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: revenueData } = useQuery({
    queryKey: ['revenue-dashboard'],
    queryFn: () => trpcClient.revenue.getDashboard.query(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: stakingProfile } = useQuery({
    queryKey: ['staking-profile'],
    queryFn: () => trpcClient.staking.getProfile.query(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: myUniverses, isLoading: isLoadingMine } = useQuery({
    queryKey: ['my-universes', address],
    queryFn: () => trpcClient.universes.getByCreator.query({ creator: address! }),
    enabled: !!address,
  });

  const { data: allUniverses, isLoading: isLoadingAll } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
  });

  const isLoading = isLoadingMine || isLoadingAll;

  const selectUniverse = (universeId: string) => {
    navigate({ to: '/universe/$id', params: { id: universeId } });
  };

  if (isAuthenticating || !isConnected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const myUniverseList: any[] = (myUniverses as any)?.data ?? [];
  const allUniverseList: any[] = (allUniverses as any)?.data ?? [];
  const otherUniverses = allUniverseList.filter(
    (u: any) => !myUniverseList.some((m: any) => m.id === u.id)
  );

  // Derived stats
  const creditBalance = creditData?.balance ?? 0;
  const totalSpent = creditData?.totalSpent ?? 0;
  const revenue30d = (revenueData as any)?.totalEarned30d ?? 0;
  const revenueBySource = (revenueData as any)?.bySource ?? {};
  const revenueTxCount = (revenueData as any)?.transactionCount30d ?? 0;
  const stakingTier = (stakingProfile as any)?.tier ?? 'NONE';
  const stakedAmount = (stakingProfile as any)?.stakedAmount ?? 0;
  const universesOwned = (portfolioData as any)?.universesOwned ?? myUniverseList.length;
  const activeSubscriptions = (portfolioData as any)?.activeSubscriptions ?? 0;
  const totalCollectibles = (portfolioData as any)?.totalCollectibles ?? 0;
  const episodesListed = myNfts?.createdEpisodes?.length ?? 0;
  const nftsCollected = myNfts?.mintedEpisodes?.length ?? 0;

  // Token portfolio — user's deployed tokens
  const myTokens = useMemo(() => {
    if (!tokenList?.length || !address) return [];
    return tokenList.filter(
      (t: EnrichedToken) => t.deployer?.toLowerCase() === address.toLowerCase()
    );
  }, [tokenList, address]);

  const totalTokenMarketCap = myTokens.reduce(
    (sum: number, t: EnrichedToken) => sum + (t.marketCap ?? 0),
    0
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">
                Welcome back
                {address && (
                  <span className="text-muted-foreground font-mono text-base sm:text-lg ml-2">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground">Your creator command center</p>
            </div>
            <div className="flex items-center gap-2">
              <RouterLink to="/tokens">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Rocket className="h-3.5 w-3.5" />
                  Launchpad
                </Button>
              </RouterLink>
              <RouterLink to="/create">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Create Universe
                </Button>
              </RouterLink>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex gap-6">
        {/* ── Main Content ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-8">
          {/* ── Stats Row ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              icon={<Coins className="h-4 w-4 text-amber-500" />}
              label="Credits"
              value={creditBalance.toLocaleString()}
              sub={totalSpent > 0 ? `${totalSpent.toLocaleString()} spent` : undefined}
              accent="amber"
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4 text-green-500" />}
              label="Revenue (30d)"
              value={revenue30d > 0 ? `${revenue30d.toFixed(4)} ETH` : '--'}
              sub={revenueTxCount > 0 ? `${revenueTxCount} txns` : undefined}
              accent="green"
            />
            <StatCard
              icon={<Globe className="h-4 w-4 text-blue-500" />}
              label="Universes"
              value={String(universesOwned)}
              sub={myTokens.length > 0 ? `${myTokens.length} tokenized` : undefined}
              accent="blue"
            />
            <StatCard
              icon={<Film className="h-4 w-4 text-purple-500" />}
              label="Episodes"
              value={String(episodesListed + nftsCollected)}
              sub={
                episodesListed > 0 ? `${episodesListed} listed · ${nftsCollected} owned` : undefined
              }
              accent="purple"
            />
            <StatCard
              icon={<Crown className="h-4 w-4 text-orange-500" />}
              label="Staking"
              value={stakingTier !== 'NONE' ? stakingTier : '--'}
              sub={stakedAmount > 0 ? `${stakedAmount.toLocaleString()} $LOAR` : 'Not staked'}
              accent="orange"
            />
            <StatCard
              icon={<ShoppingBag className="h-4 w-4 text-pink-500" />}
              label="Collectibles"
              value={String(totalCollectibles)}
              sub={activeSubscriptions > 0 ? `${activeSubscriptions} subs` : undefined}
              accent="pink"
            />
          </div>

          {/* ── Quick Actions ────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <RouterLink to="/create">
                <QuickAction icon={<Plus className="h-4 w-4" />} label="New Universe" />
              </RouterLink>
              <RouterLink to="/create/$kind" params={{ kind: 'person' }}>
                <QuickAction icon={<Paintbrush className="h-4 w-4" />} label="New Character" />
              </RouterLink>
              <RouterLink to="/videos">
                <QuickAction icon={<Video className="h-4 w-4" />} label="Generate Video" />
              </RouterLink>
              <RouterLink to="/wiki">
                <QuickAction icon={<BookOpen className="h-4 w-4" />} label="Browse Wiki" />
              </RouterLink>
            </div>
          </section>

          {/* ── Revenue Breakdown (only if has revenue) ─────────────────── */}
          {revenue30d > 0 && Object.keys(revenueBySource).length > 0 && (
            <RevenueBreakdown bySource={revenueBySource} total={revenue30d} />
          )}

          {/* ── Token Portfolio (only if has deployed tokens) ───────────── */}
          {myTokens.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  <h2 className="text-lg font-semibold">Your Tokens</h2>
                  {totalTokenMarketCap > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {totalTokenMarketCap >= 1000
                        ? `${(totalTokenMarketCap / 1000).toFixed(1)}K ETH MCap`
                        : `${totalTokenMarketCap.toFixed(2)} ETH MCap`}
                    </Badge>
                  )}
                </div>
                <RouterLink to="/tokens/portfolio">
                  <Button variant="ghost" size="sm" className="text-xs gap-1">
                    Full Portfolio <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </RouterLink>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {myTokens.slice(0, 6).map((token: EnrichedToken) => (
                  <TokenMiniCard key={token.id} token={token} />
                ))}
              </div>
            </section>
          )}

          {/* ── Your Universes ─────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Your Universes</h2>
              {myUniverseList.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {myUniverseList.length}
                </Badge>
              )}
            </div>
            {myUniverseList.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="text-center py-12">
                  <Globe className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <h3 className="font-medium mb-1">No universes yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first narrative universe to start building
                  </p>
                  <RouterLink to="/create">
                    <Button className="gap-2">
                      <Plus className="h-4 w-4" />
                      Create Universe
                    </Button>
                  </RouterLink>
                </CardContent>
              </Card>
            ) : (
              <UniverseGrid universes={myUniverseList} onSelect={selectUniverse} />
            )}
          </section>

          {/* ── LP Yield Management ────────────────────────────────────── */}
          {myUniverseList.filter(
            (u: any) =>
              u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000'
          ).length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5" />
                <h2 className="text-lg font-semibold">LP Yield & Fees</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myUniverseList
                  .filter(
                    (u: any) =>
                      u.tokenAddress &&
                      u.tokenAddress !== '0x0000000000000000000000000000000000000000'
                  )
                  .map((u: any) => (
                    <LPYieldManager
                      key={u.id}
                      tokenAddress={u.tokenAddress as `0x${string}`}
                      universeName={u.name || 'Unnamed Universe'}
                      onChainUniverseId={
                        u.onChainUniverseId != null ? Number(u.onChainUniverseId) : undefined
                      }
                    />
                  ))}
              </div>
            </section>
          )}

          {/* ── Upload ─────────────────────────────────────────────────── */}
          <UploadSection />

          {/* ── My Works ───────────────────────────────────────────────── */}
          <MyWorksSection />

          {/* ── AI Media Generation ────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Wand2 className="h-5 w-5" />
              <h2 className="text-lg font-semibold">AI Media Generation</h2>
              {creditBalance > 0 && (
                <Badge variant="outline" className="text-xs ml-auto">
                  {creditBalance.toLocaleString()} credits available
                </Badge>
              )}
            </div>
            <GenerativeMedia />
          </section>

          {/* ── Recent Activity Feed ──────────────────────────────────── */}
          <ActivityFeedWidget />

          {/* ── Explore Other Universes ─────────────────────────────────── */}
          {otherUniverses.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">Explore Universes</h2>
              <UniverseGrid universes={otherUniverses.slice(0, 8)} onSelect={selectUniverse} />
              {otherUniverses.length > 8 && (
                <div className="text-center mt-4">
                  <RouterLink to="/">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      View All <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  </RouterLink>
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 space-y-4">
            <NotificationsWidget />
            <DailyCheckin />
            <QuestsPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Stats Card ──────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`p-1.5 rounded-md bg-${accent}-500/10`}>{icon}</div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            {label}
          </span>
        </div>
        <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Revenue Breakdown ───────────────────────────────────────────────

const SOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  nft_sales: { label: 'NFT Sales', icon: '🎬' },
  subscriptions: { label: 'Subscriptions', icon: '👥' },
  credits: { label: 'Credits', icon: '⚡' },
  licensing: { label: 'IP Licensing', icon: '📜' },
  canon_royalties: { label: 'Canon Royalties', icon: '🗳️' },
  ads: { label: 'Ad Revenue', icon: '📢' },
  appearance_fees: { label: 'Appearance Fees', icon: '🧬' },
  merch: { label: 'Merch', icon: '🛍️' },
  collabs: { label: 'Collabs', icon: '🤝' },
};

function RevenueBreakdown({
  bySource,
  total,
}: {
  bySource: Record<string, number>;
  total: number;
}) {
  const sorted = Object.entries(bySource).sort(([, a], [, b]) => b - a);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Revenue (30d)</h2>
        </div>
        <span className="text-sm font-bold text-green-500 tabular-nums">
          {total.toFixed(4)} ETH
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {sorted.map(([source, amount]) => {
          const meta = SOURCE_LABELS[source] ?? { label: source, icon: '💰' };
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <div
              key={source}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
            >
              <span className="text-lg">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{meta.label}</span>
                  <span className="text-xs font-mono tabular-nums font-semibold">
                    {amount.toFixed(4)}
                  </span>
                </div>
                <div className="h-1 bg-secondary rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Token Mini Card ─────────────────────────────────────────────────

function TokenMiniCard({ token }: { token: EnrichedToken }) {
  return (
    <RouterLink to="/tokens/$address" params={{ address: token.id }}>
      <Card className="hover:border-primary/40 transition-all cursor-pointer group">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            {token.imageURL ? (
              <img
                src={token.imageURL}
                alt={token.name}
                className="w-10 h-10 rounded-lg object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                <span className="text-xs font-bold text-primary/60">${token.symbol}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold truncate">{token.name}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  ${token.symbol}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                <span className="tabular-nums">{token.holderCount} holders</span>
                <span className="tabular-nums">{token.totalSwaps} swaps</span>
              </div>
            </div>
            <div className="text-right">
              {token.priceChange24h !== null && (
                <div
                  className={`flex items-center gap-0.5 text-xs font-semibold ${
                    token.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {token.priceChange24h >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(token.priceChange24h).toFixed(1)}%
                </div>
              )}
              {token.marketCap != null && token.marketCap > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {token.marketCap >= 1000
                    ? `${(token.marketCap / 1000).toFixed(1)}K`
                    : token.marketCap.toFixed(2)}{' '}
                  ETH
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </RouterLink>
  );
}

// ─── Upload Section ──────────────────────────────────────────────────

function UploadSection() {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Upload Content</h2>
        </div>
        <Button
          variant={open ? 'secondary' : 'default'}
          size="sm"
          className="gap-2"
          onClick={() => setOpen((v) => !v)}
        >
          <Upload className="h-4 w-4" />
          {open ? 'Close' : 'Upload New'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {open && <UploadForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />}
    </section>
  );
}

// ─── My Works Section ────────────────────────────────────────────────

type Classification = 'all' | 'fan' | 'original' | 'licensed';

const VISIBILITY_ICONS: Record<string, React.ReactNode> = {
  public: <Globe className="h-3 w-3" />,
  unlisted: <Eye className="h-3 w-3" />,
  private: <EyeOff className="h-3 w-3" />,
};

const MEDIA_ICONS: Record<string, React.ReactNode> = {
  video: <Film className="h-3 w-3" />,
  'ai-video': <Film className="h-3 w-3" />,
  image: <ImageIcon className="h-3 w-3" />,
  'ai-image': <ImageIcon className="h-3 w-3" />,
};

function MyWorksSection() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<Classification>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['my-content-dashboard', classFilter],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.myContent.query({
        classification: classFilter === 'all' ? undefined : classFilter,
        limit: 24,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: any) => lastPage.nextCursor ?? undefined,
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trpcClient.content.delete.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-content-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['my-content'] });
      toast.success('Content deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Delete failed'),
  });

  const allItems = useMemo(() => data?.pages.flatMap((p: any) => p.items) ?? [], [data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (item: any) =>
        item.title?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        (Array.isArray(item.tags) && item.tags.some((t: string) => t.toLowerCase().includes(q)))
    );
  }, [allItems, search]);

  if (!isAuthenticated) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">My Works</h2>
          {allItems.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {allItems.length} item{allItems.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search your works..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          {(['all', 'fan', 'original', 'licensed'] as Classification[]).map((c) => (
            <button
              key={c}
              onClick={() => setClassFilter(c)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${
                classFilter === c
                  ? 'bg-background shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 p-0"
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className="h-8 w-8 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg border-dashed">
          <Film className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">
            {allItems.length === 0 ? 'No works yet' : 'No results'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {allItems.length === 0
              ? 'Upload your first video or image to get started'
              : 'Try a different search or filter'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((item: any) => (
            <DashboardContentCard
              key={item.id}
              item={item}
              onDelete={() => deleteMutation.mutate(item.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item: any) => (
            <DashboardContentRow
              key={item.id}
              item={item}
              onDelete={() => deleteMutation.mutate(item.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
            />
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center mt-6">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="gap-2"
          >
            {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
            Load More
          </Button>
        </div>
      )}
    </section>
  );
}

// ─── Content Cards ───────────────────────────────────────────────────

function DashboardContentCard({
  item,
  onDelete,
  deleting,
}: {
  item: any;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
  return (
    <Card className="group overflow-hidden">
      <div className="aspect-video bg-muted relative">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : isVideo && item.mediaUrl ? (
          <video
            src={item.mediaUrl}
            className="w-full h-full object-cover"
            muted
            loop
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : item.mediaUrl ? (
          <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No preview
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="absolute bottom-2 left-2">
          <ContentLaneBadge classification={item.classification} size="sm" />
        </div>
        <div className="absolute top-2 right-2">
          <span className="text-xs bg-black/60 text-white px-1.5 py-0.5 rounded capitalize">
            {item.visibility}
          </span>
        </div>
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium line-clamp-1">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
        </p>
      </div>
    </Card>
  );
}

function DashboardContentRow({
  item,
  onDelete,
  deleting,
}: {
  item: any;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
  return (
    <Card className="p-4">
      <div className="flex gap-4 items-center">
        <div className="w-28 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : isVideo && item.mediaUrl ? (
            <video src={item.mediaUrl} className="w-full h-full object-cover" muted />
          ) : item.mediaUrl ? (
            <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm truncate">{item.title}</h3>
            <ContentLaneBadge classification={item.classification} size="sm" />
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
            {item.description || 'No description'}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 capitalize">
              {VISIBILITY_ICONS[item.visibility]}
              {item.visibility}
            </span>
            <span className="flex items-center gap-1">
              {MEDIA_ICONS[item.mediaType]}
              {item.mediaType}
            </span>
            <span>{item.views ?? 0} views</span>
            <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span>
          </div>
          {Array.isArray(item.tags) && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.slice(0, 5).map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-2 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 flex-shrink-0"
          title="Delete"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </Card>
  );
}

// ─── Universe Grid ───────────────────────────────────────────────────

function UniverseGrid({
  universes,
  onSelect,
}: {
  universes: any[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {universes.map((universe: any) => (
        <Card
          key={universe.id}
          className="cursor-pointer hover:border-primary/40 transition-all group overflow-hidden"
          onClick={() => onSelect(universe.id)}
        >
          <CardContent className="p-0">
            <div className="h-32 bg-gradient-to-br from-indigo-500/80 to-purple-600/80 relative">
              {(universe.image_url || universe.imageUrl) && (
                <img
                  src={universe.image_url || universe.imageUrl}
                  alt={universe.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-2 left-2 right-2">
                <h3 className="text-white font-semibold text-sm truncate drop-shadow">
                  {universe.name}
                </h3>
              </div>
              <div className="absolute top-2 right-2 flex gap-1">
                {universe.tokenAddress &&
                universe.tokenAddress !== '0x0000000000000000000000000000000000000000' ? (
                  <Badge className="bg-green-600/80 text-white border-0 text-[9px] px-1.5 py-0">
                    Token Live
                  </Badge>
                ) : (
                  <Badge className="bg-zinc-600/80 text-white border-0 text-[9px] px-1.5 py-0">
                    No Token
                  </Badge>
                )}
              </div>
            </div>
            <div className="p-3">
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                {universe.description || 'Explore this narrative universe'}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {universe.createdAt ? new Date(universe.createdAt).toLocaleDateString() : ''}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(!universe.tokenAddress ||
                    universe.tokenAddress === '0x0000000000000000000000000000000000000000') && (
                    <RouterLink
                      to="/universe/$id/deploy-token"
                      params={{ id: (universe.address || universe.id).toLowerCase() }}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <Button size="sm" variant="outline" className="text-[10px] h-6 px-2 gap-1">
                        <Rocket className="h-2.5 w-2.5" />
                        Launch Token
                      </Button>
                    </RouterLink>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(universe.id);
                    }}
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Quick Action Button ────────────────────────────────────────────

function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/50 hover:border-primary/30 transition-all cursor-pointer group">
      <div className="p-1.5 rounded-md bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
        {icon}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

// ─── Activity Feed Widget ───────────────────────────────────────────

const ACTIVITY_LABELS: Record<string, string> = {
  created_universe: 'Created a universe',
  created_content: 'Published content',
  created_character: 'Created a character',
  created_entity: 'Created an entity',
  minted_nft: 'Minted an NFT',
  voted_proposal: 'Voted on a proposal',
  created_proposal: 'Created a proposal',
  followed_user: 'Followed',
  purchased_credits: 'Purchased credits',
  subscribed_universe: 'Subscribed',
  submitted_canon: 'Submitted to canon',
  canon_accepted: 'Canon accepted',
  collab_started: 'Started a collab',
  listed_item: 'Listed an item',
  sold_item: 'Sold an item',
};

function parseEventTime(createdAt: any): Date {
  if (!createdAt) return new Date(0);
  if (createdAt.toDate) return new Date(createdAt.toDate());
  if (createdAt._seconds) return new Date(createdAt._seconds * 1000);
  return new Date(createdAt);
}

function relativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ActivityFeedWidget() {
  const { isAuthenticated } = useWalletAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-activity-feed'],
    queryFn: () => trpcClient.social.getGlobalFeed.query({ limit: 8 }),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const events: any[] = (data as any)?.events ?? [];

  if (!isAuthenticated) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Recent Activity</h2>
        </div>
        <RouterLink to="/activity">
          <Button variant="ghost" size="sm" className="text-xs gap-1">
            View All <ArrowUpRight className="h-3 w-3" />
          </Button>
        </RouterLink>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2.5 p-2.5 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-2.5 bg-muted rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-center py-8">
            <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No activity yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-0.5">
          {events.map((event: any) => {
            const time = parseEventTime(event.createdAt);
            return (
              <div
                key={event.id}
                className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0">
                  {event.actorDisplayName?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-tight">
                    <span className="font-medium">
                      {event.actorDisplayName || event.actorUid?.slice(0, 8)}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      {ACTIVITY_LABELS[event.eventType] || event.eventType}
                    </span>
                    {event.targetTitle && (
                      <span className="text-primary"> {event.targetTitle}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {time.getTime() > 0 ? relativeTime(time) : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Notifications Widget ───────────────────────────────────────────

function NotificationsWidget() {
  const { isAuthenticated } = useWalletAuth();

  const { data: unreadData } = useQuery({
    queryKey: ['dashboard-unread-count'],
    queryFn: () => trpcClient.social.getUnreadCount.query(),
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  const { data: notifData, isLoading } = useQuery({
    queryKey: ['dashboard-notifications'],
    queryFn: () => trpcClient.social.getNotifications.query({ limit: 5, unreadOnly: false }),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const unreadCount = (unreadData as any)?.count ?? 0;
  const notifications: any[] = (notifData as any)?.notifications ?? [];

  if (!isAuthenticated) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 min-w-[18px] justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </div>
          <RouterLink to="/notifications">
            <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2">
              View All
            </Button>
          </RouterLink>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-2 animate-pulse">
                <div className="w-6 h-6 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-2 bg-muted rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No notifications yet</p>
        ) : (
          <div className="space-y-1">
            {notifications.map((notif: any) => {
              const time = parseEventTime(notif.createdAt);
              return (
                <div
                  key={notif.id}
                  className={`flex items-start gap-2 p-2 rounded-md text-xs transition-colors ${
                    !notif.read ? 'bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                      {notif.actorDisplayName?.[0]?.toUpperCase() || '?'}
                    </div>
                    {!notif.read && (
                      <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="leading-tight line-clamp-2">{notif.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {time.getTime() > 0 ? relativeTime(time) : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
