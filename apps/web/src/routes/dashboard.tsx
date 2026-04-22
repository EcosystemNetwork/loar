/**
 * Dashboard — Creator command center.
 *
 * Focused layout: stats → actions → your stuff.
 * Heavy features (upload, AI gen, full works manager, LP yield) live on dedicated pages.
 */

import { createFileRoute, redirect, Link as RouterLink } from '@tanstack/react-router';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Play,
  Plus,
  Wand2,
  Film,
  Rocket,
  TrendingUp,
  Globe,
  Coins,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingBag,
  Activity,
  Bell,
  Paintbrush,
  Sparkles,
  FolderOpen,
  Eye,
  Users,
  Vote,
} from 'lucide-react';
import { formatEther } from 'viem';
import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';
import { QuestsPanel } from '@/components/QuestsPanel';
import { DailyCheckin } from '@/components/DailyCheckin';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { useCreditBalance, useMyNFTs, useUniversesMetricsBatch } from '@/hooks/useRevenue';
import { useTokenListData, type EnrichedToken } from '@/hooks/useTokens';

import { useWalletAuth } from '@/lib/wallet-auth';
import { useMemo } from 'react';

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

  // ── Data hooks ──────────────────────────────────────────────────────
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

  const { data: myUniverses } = useQuery({
    queryKey: ['my-universes', address],
    queryFn: () => trpcClient.universes.getByCreator.query({ creator: address! }),
    enabled: !!address,
  });

  // Recent works — just the latest 6 for a preview
  const { data: recentWorksData } = useQuery({
    queryKey: ['dashboard-recent-works'],
    queryFn: () => trpcClient.content.myContent.query({ limit: 6 }),
    enabled: isAuthenticated,
  });

  const selectUniverse = (universeId: string) => {
    navigate({ to: '/universe/$id', params: { id: universeId } });
  };

  const myUniverseList: any[] = (myUniverses as any)?.data ?? [];
  const recentWorks: any[] = (recentWorksData as any)?.items ?? [];

  // Token portfolio (must be declared before any early return)
  const myTokens = useMemo(() => {
    if (!tokenList?.length || !address) return [];
    return tokenList.filter(
      (t: EnrichedToken) => t.deployer?.toLowerCase() === address.toLowerCase()
    );
  }, [tokenList, address]);

  // Batch metrics — single round-trip for all universe cards (vs N+1 per card).
  const universeIds = useMemo(
    () => myUniverseList.map((u: any) => u.id).filter(Boolean),
    [myUniverseList]
  );
  const { data: metricsByUniverseId } = useUniversesMetricsBatch(universeIds);

  if (isAuthenticating || !isConnected) {
    return <DashboardSkeleton />;
  }

  // Derived stats
  const creditBalance = creditData?.balance ?? 0;
  const totalSpent = creditData?.totalSpent ?? 0;
  const revenue30d = (revenueData as any)?.totalEarned30d ?? 0;
  const revenueTxCount = (revenueData as any)?.transactionCount30d ?? 0;
  const universesOwned = (portfolioData as any)?.universesOwned ?? myUniverseList.length;
  const activeSubscriptions = (portfolioData as any)?.activeSubscriptions ?? 0;
  const totalCollectibles = (portfolioData as any)?.totalCollectibles ?? 0;
  const episodesListed = myNfts?.createdEpisodes?.length ?? 0;
  const nftsCollected = myNfts?.mintedEpisodes?.length ?? 0;

  const totalTokenMarketCap = myTokens.reduce(
    (sum: number, t: EnrichedToken) => sum + (t.marketCap ?? 0),
    0
  );

  // Is this a brand-new user with nothing yet?
  const isNewUser =
    myUniverseList.length === 0 && recentWorks.length === 0 && myTokens.length === 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
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
              <RouterLink to="/sandbox">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Sandbox
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
        {/* ── Main Content ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-8">
          {/* ── New User Onboarding ───────────────────────────────── */}
          {isNewUser && (
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-purple-500/5">
              <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
                <div className="p-3 rounded-full bg-primary/10">
                  <Wand2 className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-1">Start creating</h2>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Generate images and videos in the Sandbox, or create a Universe to build a full
                    narrative world with characters, episodes, and governance.
                  </p>
                </div>
                <div className="flex gap-3">
                  <RouterLink to="/sandbox">
                    <Button variant="outline" className="gap-2">
                      <Sparkles className="h-4 w-4" />
                      Open Sandbox
                    </Button>
                  </RouterLink>
                  <RouterLink to="/create">
                    <Button className="gap-2">
                      <Plus className="h-4 w-4" />
                      Create Universe
                    </Button>
                  </RouterLink>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Stats ─────────────────────────────────────────────── */}
          {!isNewUser && (
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
                  episodesListed > 0
                    ? `${episodesListed} listed · ${nftsCollected} owned`
                    : undefined
                }
                accent="purple"
              />
              <StatCard
                icon={<ShoppingBag className="h-4 w-4 text-pink-500" />}
                label="Collectibles"
                value={String(totalCollectibles)}
                sub={activeSubscriptions > 0 ? `${activeSubscriptions} subs` : undefined}
                accent="pink"
              />
            </div>
          )}

          {/* ── Quick Actions ─────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <RouterLink to="/sandbox">
                <QuickAction icon={<Sparkles className="h-4 w-4" />} label="Sandbox" />
              </RouterLink>
              <RouterLink to="/create">
                <QuickAction icon={<Plus className="h-4 w-4" />} label="New Universe" />
              </RouterLink>
              <RouterLink to="/create/$kind" params={{ kind: 'person' }}>
                <QuickAction icon={<Paintbrush className="h-4 w-4" />} label="New Character" />
              </RouterLink>
              <RouterLink to="/my-works">
                <QuickAction icon={<FolderOpen className="h-4 w-4" />} label="My Works" />
              </RouterLink>
            </div>
          </section>

          {/* ── Your Universes ────────────────────────────────────── */}
          {myUniverseList.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Your Universes</h2>
                  <Badge variant="outline" className="text-xs">
                    {myUniverseList.length}
                  </Badge>
                </div>
              </div>
              <UniverseGrid
                universes={myUniverseList}
                onSelect={selectUniverse}
                metricsByUniverseId={(metricsByUniverseId as Record<string, any>) ?? {}}
              />
            </section>
          )}

          {/* ── Your Tokens (only if has deployed tokens) ─────────── */}
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

          {/* ── Recent Works (compact preview) ────────────────────── */}
          {recentWorks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Recent Works</h2>
                <RouterLink to="/my-works">
                  <Button variant="ghost" size="sm" className="text-xs gap-1">
                    View All <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </RouterLink>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {recentWorks.slice(0, 6).map((item: any) => (
                  <RecentWorkCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* ── Recent Activity ───────────────────────────────────── */}
          <ActivityFeedWidget />
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 space-y-4">
            {/* Credits quick-glance for new users */}
            {isNewUser && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-semibold">Credits</span>
                    </div>
                    <span className="text-lg font-bold tabular-nums">
                      {creditBalance.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Credits are used for AI generation. Free models cost 0 credits.
                  </p>
                  <RouterLink to="/pricing">
                    <Button variant="outline" size="sm" className="w-full mt-3 text-xs">
                      Get More Credits
                    </Button>
                  </RouterLink>
                </CardContent>
              </Card>
            )}
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

// Static map — Tailwind JIT purges dynamic class strings, so background tints
// for StatCard icons must be statically discoverable.
const STAT_ACCENT_BG: Record<string, string> = {
  amber: 'bg-amber-500/10',
  green: 'bg-green-500/10',
  blue: 'bg-blue-500/10',
  purple: 'bg-purple-500/10',
  orange: 'bg-orange-500/10',
  pink: 'bg-pink-500/10',
};

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
  accent: keyof typeof STAT_ACCENT_BG;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`p-1.5 rounded-md ${STAT_ACCENT_BG[accent] ?? 'bg-muted'}`}>{icon}</div>
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

// ─── Recent Work Card (compact, view-only) ──────────────────────────

function RecentWorkCard({ item }: { item: any }) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
  return (
    <Card className="group overflow-hidden">
      <div className="aspect-video bg-muted relative">
        {item.thumbnailUrl ? (
          <img
            src={resolveIpfsUrl(item.thumbnailUrl)}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : isVideo && item.mediaUrl ? (
          <video
            src={resolveIpfsUrl(item.mediaUrl)}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            onMouseEnter={(e) => {
              void e.currentTarget.play().catch(() => {});
            }}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : item.mediaUrl ? (
          <img
            src={resolveIpfsUrl(item.mediaUrl)}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No preview
          </div>
        )}
        <div className="absolute bottom-1.5 left-1.5">
          <ContentLaneBadge classification={item.classification} size="sm" />
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium line-clamp-1">{item.title}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
        </p>
      </div>
    </Card>
  );
}

// ─── Universe Grid ──────────────────────────────────────────────────

function UniverseGrid({
  universes,
  onSelect,
  metricsByUniverseId,
}: {
  universes: any[];
  onSelect: (id: string) => void;
  metricsByUniverseId: Record<string, any>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {universes.map((universe: any) => (
        <UniverseCard
          key={universe.id}
          universe={universe}
          onSelect={onSelect}
          metrics={metricsByUniverseId[universe.id]}
        />
      ))}
    </div>
  );
}

function UniverseCard({
  universe,
  onSelect,
  metrics,
}: {
  universe: any;
  onSelect: (id: string) => void;
  metrics: any;
}) {
  const m = metrics ?? null;
  const views = m?.totalViews ?? 0;
  const mints = m?.totalMints ?? 0;
  const subscribers = m?.totalSubscribers ?? 0;
  const votes = m?.totalVotes ?? 0;
  let revenueEth = '0';
  try {
    revenueEth = m?.totalRevenue ? Number(formatEther(BigInt(m.totalRevenue))).toFixed(3) : '0';
  } catch {
    revenueEth = '0';
  }
  const hasAnyActivity = views > 0 || mints > 0 || subscribers > 0 || votes > 0;

  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-all group overflow-hidden"
      onClick={() => onSelect(universe.id)}
    >
      <CardContent className="p-0">
        <div className="h-32 bg-gradient-to-br from-indigo-500/80 to-purple-600/80 relative">
          {(universe.image_url || universe.imageUrl) && (
            <img
              src={resolveIpfsUrl(universe.image_url || universe.imageUrl)}
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
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {universe.description || 'Explore this narrative universe'}
          </p>

          {/* Per-universe analytics breakdown */}
          <div className="grid grid-cols-4 gap-1 mb-3">
            <MetricChip
              icon={<Eye className="h-2.5 w-2.5" />}
              label="views"
              value={formatCount(views)}
            />
            <MetricChip
              icon={<Film className="h-2.5 w-2.5" />}
              label="mints"
              value={formatCount(mints)}
            />
            <MetricChip
              icon={<Users className="h-2.5 w-2.5" />}
              label="subs"
              value={formatCount(subscribers)}
            />
            <MetricChip
              icon={<Vote className="h-2.5 w-2.5" />}
              label="votes"
              value={formatCount(votes)}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-3">
            <span className="flex items-center gap-1">
              <Coins className="h-2.5 w-2.5" />
              {hasAnyActivity ? `${revenueEth} ETH` : 'No activity yet'}
            </span>
            <RouterLink
              to="/analytics/$universeId"
              params={{ universeId: universe.id }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="text-primary hover:underline flex items-center gap-0.5"
            >
              Details
              <ArrowUpRight className="h-2.5 w-2.5" />
            </RouterLink>
          </div>

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
  );
}

function MetricChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-md bg-muted/40 px-1 py-1"
      title={`${value} ${label}`}
    >
      <div className="flex items-center gap-0.5 text-muted-foreground">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <span className="font-mono text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
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

// ─── Dashboard Skeleton (shown while auth/data loads) ─────────────────

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header skeleton */}
      <div className="border-b bg-card/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-md" />
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex gap-6">
        <div className="flex-1 min-w-0 space-y-8">
          {/* Stats skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-7 w-7 rounded-md" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-2.5 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Quick actions skeleton */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          </div>
          {/* Universe grid skeleton */}
          <div className="space-y-4">
            <Skeleton className="h-6 w-36" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="h-32 rounded-none" />
                  <CardContent className="p-3 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
        {/* Sidebar skeleton */}
        <aside className="hidden lg:block w-80 flex-shrink-0">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
