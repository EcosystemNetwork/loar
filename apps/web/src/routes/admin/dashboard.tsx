/**
 * Admin Dashboard — platform statistics: users, growth, monetization funnel,
 * subscription mix, and revenue/spend (reused from admin.cost so margin
 * logic has one source of truth instead of being re-derived here).
 *
 * Wallet-gated twice: route guard + adminProcedure on the server. See
 * apps/server/src/routers/admin/analytics.routes.ts for the data source.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import {
  Shield,
  Loader2,
  Users,
  UserPlus,
  Activity,
  Globe,
  Film,
  RefreshCw,
  DollarSign,
  Gauge,
} from 'lucide-react';
import { TrendBarChart } from '@/components/admin/TrendBarChart';
import { CostTrendChart } from '@/components/admin/CostTrendChart';
import { ConversionFunnel } from '@/components/admin/ConversionFunnel';
import { TierDistributionPie } from '@/components/admin/TierDistributionPie';

export const Route = createFileRoute('/admin/dashboard')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/dashboard' } });
    }
  },
  component: AdminDashboard,
});

function fmtNum(n: number | undefined | null) {
  return new Intl.NumberFormat('en-US').format(Number(n ?? 0));
}
function fmtUsd(v: number | undefined | null) {
  const n = Number(v ?? 0);
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
function fmtPct(r: number | undefined | null) {
  const n = Number(r ?? 0);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function AdminDashboard() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());
  const gated = isAuthenticated && isAdmin;

  const {
    data: overview,
    isLoading: loadingOverview,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ['admin-analytics-overview'],
    queryFn: () => trpcClient.admin.analytics.overview.query(),
    enabled: gated,
    refetchInterval: 30_000,
  });

  const { data: signupTrend, refetch: refetchSignups } = useQuery({
    queryKey: ['admin-analytics-signup-trend'],
    queryFn: () => trpcClient.admin.analytics.signupTrend.query({ days: 30 }),
    enabled: gated,
    refetchInterval: 60_000,
  });

  const { data: dauTrend, refetch: refetchDau } = useQuery({
    queryKey: ['admin-analytics-dau-trend'],
    queryFn: () => trpcClient.admin.analytics.dailyActiveTrend.query({ days: 30 }),
    enabled: gated,
    refetchInterval: 60_000,
  });

  const { data: funnel, refetch: refetchFunnel } = useQuery({
    queryKey: ['admin-analytics-funnel'],
    queryFn: () => trpcClient.admin.analytics.funnel.query(),
    enabled: gated,
    refetchInterval: 60_000,
  });

  const { data: tiers, refetch: refetchTiers } = useQuery({
    queryKey: ['admin-analytics-tiers'],
    queryFn: () => trpcClient.admin.analytics.subscriptionTiers.query(),
    enabled: gated,
    refetchInterval: 60_000,
  });

  // Financial data reused as-is from admin.cost — see file header.
  const { data: costOverview, refetch: refetchCost } = useQuery({
    queryKey: ['admin-dashboard-cost-overview'],
    queryFn: () => trpcClient.admin.cost.overview.query({ window: 'month' }),
    enabled: gated,
    refetchInterval: 30_000,
  });

  const { data: costTrend, refetch: refetchCostTrend } = useQuery({
    queryKey: ['admin-dashboard-cost-trend'],
    queryFn: () => trpcClient.admin.cost.trend.query({ days: 30 }),
    enabled: gated,
    refetchInterval: 60_000,
  });

  function refetchAll() {
    refetchOverview();
    refetchSignups();
    refetchDau();
    refetchFunnel();
    refetchTiers();
    refetchCost();
    refetchCostTrend();
  }

  const signupSeries = useMemo(
    () => (signupTrend?.series ?? []).map((p) => ({ day: p.day, value: p.newUsers })),
    [signupTrend]
  );
  const dauSeries = useMemo(
    () => (dauTrend?.series ?? []).map((p) => ({ day: p.day, value: p.activeUsers })),
    [dauTrend]
  );

  const tierSlices = useMemo(() => {
    if (!tiers) return [];
    const named = tiers.tiers.map((t) => ({
      key: t.tier,
      label: t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
      count: t.count,
    }));
    return [{ key: 'free', label: 'Free', count: tiers.free }, ...named];
  }, [tiers]);

  const margin = (costOverview as any)?.margin as
    | { marginRatio?: number; revenueUsd?: number; costUsd?: number; target?: number }
    | undefined;

  if (isAuthenticating) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) return null;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-2 text-center">
          <Shield className="mx-auto h-12 w-12 text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-sm text-muted-foreground">
            Your wallet address does not have admin access.
          </p>
        </div>
      </div>
    );
  }

  const o = overview as
    | {
        totalUsers: number;
        registeredAccounts: number;
        newUsers: { today: number; last7d: number; last30d: number };
        dailyActiveWallets: number;
        loginsLast24h: number;
        totalUniverses: number;
        totalEpisodes: number;
      }
    | undefined;

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-background p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Gauge className="h-6 w-6" /> Platform Statistics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every metric the site produces about its users, in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={refetchAll}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {/* ── Headline KPIs ─────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3 w-3" /> Total users
            </div>
            <p className={`text-2xl font-bold ${loadingOverview ? 'text-muted-foreground' : ''}`}>
              {fmtNum(o?.totalUsers)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {fmtNum(o?.registeredAccounts)} registered accounts
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="h-3 w-3" /> Active wallets (24h)
            </div>
            <p className="text-2xl font-bold">{fmtNum(o?.dailyActiveWallets)}</p>
            <p className="text-[10px] text-muted-foreground">{fmtNum(o?.loginsLast24h)} logins</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <UserPlus className="h-3 w-3" /> New users
            </div>
            <p className="text-2xl font-bold">{fmtNum(o?.newUsers.today)}</p>
            <p className="text-[10px] text-muted-foreground">
              {fmtNum(o?.newUsers.last7d)} in 7d · {fmtNum(o?.newUsers.last30d)} in 30d
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" /> Universes
            </div>
            <p className="text-2xl font-bold">{fmtNum(o?.totalUniverses)}</p>
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Film className="h-2.5 w-2.5" /> {fmtNum(o?.totalEpisodes)} episodes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Financial (reused from admin.cost) ───────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3" /> Revenue (30d)
            </div>
            <p className="text-2xl font-bold">{fmtUsd(margin?.revenueUsd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              Provider cost (30d)
            </div>
            <p className="text-2xl font-bold">{fmtUsd(margin?.costUsd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Gauge className="h-3 w-3" /> Gross margin
            </div>
            <p className="text-2xl font-bold">{fmtPct(margin?.marginRatio)}</p>
            <p className="text-[10px] text-muted-foreground">
              target {fmtPct(margin?.target ?? 0.3)} · full detail on{' '}
              <a href="/admin/cost" className="text-primary hover:underline">
                /admin/cost
              </a>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              Subscribers
            </div>
            <p className="text-2xl font-bold">
              {fmtNum(tiers?.tiers.reduce((s, t) => s + t.count, 0))}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {fmtNum(tiers?.free)} on the free tier
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Growth charts ─────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Daily active users — 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendBarChart
              series={dauSeries}
              formatValue={(n) => `${n} active user${n === 1 ? '' : 's'}`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">New signups — 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendBarChart
              series={signupSeries}
              formatValue={(n) => `${n} new user${n === 1 ? '' : 's'}`}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Revenue trend (reused CostTrendChart) ───────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Revenue &amp; margin — 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {costTrend ? (
            <CostTrendChart
              series={((costTrend as any).series ?? []) as any[]}
              target={(costTrend as any).target ?? 0.3}
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> loading…
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Monetization ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conversion funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionFunnel stages={funnel?.stages ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Subscription tier distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <TierDistributionPie slices={tierSlices} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
