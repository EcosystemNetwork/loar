/**
 * Revenue Dashboard — Comprehensive creator revenue analytics.
 *
 * Shows earnings breakdown by source, universe performance,
 * revenue timeline, and export functionality.
 */
import { createFileRoute, Link as RouterLink, useNavigate } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import {
  DollarSign,
  Coins,
  Globe,
  Calendar,
  Download,
  TrendingUp,
  ShoppingBag,
  CreditCard,
  FileText,
  Megaphone,
  Heart,
  Store,
  Loader2,
  ChevronDown,
  ArrowLeft,
  Users,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────

type Period = 'day' | 'week' | 'month' | 'all';
type ChartPeriod = 'week' | 'month' | 'quarter' | 'year';
type ExportFormat = 'csv' | 'json';

interface RevenueSummary {
  totalRevenue: number;
  netCredits: number;
  creditsEarned: number;
  creditsSpent: number;
  topUniverse: { name: string; revenue: number } | null;
}

interface RevenueSource {
  source: string;
  amount: number;
  percentage: number;
}

interface TimelinePoint {
  date: string;
  amount: number;
}

interface UniverseRevenue {
  id: string;
  name: string;
  revenue: number;
  holders: number;
  subscribers: number;
}

// ── Route ────────────────────────────────────────────────────────────

export const Route = createFileRoute('/dashboard/revenue')({
  component: RevenueDashboardPage,
});

// ── Source config ────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { icon: typeof DollarSign; color: string; bg: string }> = {
  'NFT Sales': { icon: ShoppingBag, color: 'text-violet-400', bg: 'bg-violet-500' },
  Subscriptions: { icon: CreditCard, color: 'text-blue-400', bg: 'bg-blue-500' },
  Licensing: { icon: FileText, color: 'text-emerald-400', bg: 'bg-emerald-500' },
  Ads: { icon: Megaphone, color: 'text-amber-400', bg: 'bg-amber-500' },
  Tips: { icon: Heart, color: 'text-pink-400', bg: 'bg-pink-500' },
  'Canon Marketplace': { icon: Store, color: 'text-green-400', bg: 'bg-green-500' },
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return formatUSD(value);
}

// ── Main Component ───────────────────────────────────────────────────

function RevenueDashboardPage() {
  const { isAuthenticated, sessionReady, address } = useWalletAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('month');
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('month');
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['revenue-summary', period],
    queryFn: () => trpcClient.revenueDashboard.summary.query({ period }),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['revenue-timeline', chartPeriod],
    queryFn: () => trpcClient.revenueDashboard.timeline.query({ period: chartPeriod }),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: universeData, isLoading: universesLoading } = useQuery({
    queryKey: ['revenue-universes', period],
    queryFn: () => trpcClient.revenueDashboard.byUniverse.query({}),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const exportMutation = useMutation({
    mutationFn: async (params: { format: ExportFormat; period: Period }) => {
      // WEB-6: revenue export leaks the caller's earnings history; don't
      // run it until the server-side auth check has confirmed this session.
      if (!sessionReady) throw new Error('Session still validating, please retry');
      return trpcClient.revenueDashboard.export.mutate({
        format: params.format,
        period:
          params.period === 'all' || params.period === 'day' || params.period === 'week'
            ? 'month'
            : (params.period as 'month' | 'quarter' | 'year'),
      });
    },
    onSuccess: (data: any) => {
      if (data?.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
        toast.success('Revenue data exported successfully');
      }
    },
    onError: () => {
      toast.error('Failed to export revenue data');
    },
  });

  // ── Derived data ─────────────────────────────────────────────────

  const summaryData: RevenueSummary = useMemo(
    () =>
      (summary as unknown as RevenueSummary) ?? {
        totalRevenue: 0,
        netCredits: 0,
        creditsEarned: 0,
        creditsSpent: 0,
        topUniverse: null,
      },
    [summary]
  );

  const timelineData: TimelinePoint[] = useMemo(
    () => ((timeline as any)?.dataPoints ?? timeline ?? []) as TimelinePoint[],
    [timeline]
  );
  const universeList: UniverseRevenue[] = useMemo(
    () => ((universeData as any)?.universes ?? []) as UniverseRevenue[],
    [universeData]
  );

  // Derive source breakdown from summary data
  const sourcesLoading = summaryLoading;
  const sourceList: RevenueSource[] = useMemo(() => {
    const bySource = (summary as any)?.revenueBySource;
    if (!bySource) return [];
    const entries = Object.entries(bySource).map(([source, amount]) => ({
      source,
      amount: amount as number,
    }));
    const total = entries.reduce((sum, e) => sum + e.amount, 0) || 1;
    return entries
      .filter((e) => e.amount > 0)
      .map((e) => ({ source: e.source, amount: e.amount, percentage: (e.amount / total) * 100 }));
  }, [summary]);

  const maxTimelineValue = useMemo(
    () => Math.max(...timelineData.map((p) => p.amount), 1),
    [timelineData]
  );

  // ── Unauthenticated ──────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="bg-card border border-border rounded-xl p-10 text-center max-w-md">
          <DollarSign className="h-12 w-12 text-violet-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Revenue Dashboard</h2>
          <p className="text-muted-foreground mb-6">
            Sign in to view your revenue analytics and earnings breakdown.
          </p>
          <RouterLink to="/login">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Sign In
            </Button>
          </RouterLink>
        </div>
      </div>
    );
  }

  // ── Period selector ──────────────────────────────────────────────

  const periods: { value: Period; label: string }[] = [
    { value: 'day', label: '24h' },
    { value: 'week', label: '7d' },
    { value: 'month', label: '30d' },
    { value: 'all', label: 'All' },
  ];

  const chartPeriods: { value: ChartPeriod; label: string }[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'quarter', label: 'Quarter' },
    { value: 'year', label: 'Year' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <RouterLink to="/dashboard">
                <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-foreground">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Dashboard
                </Button>
              </RouterLink>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-violet-400" />
                  Revenue Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">
                  Track your earnings across all sources
                </p>
              </div>
            </div>

            {/* Export Button */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-700 text-zinc-300 hover:text-foreground gap-1.5"
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export
                <ChevronDown className="h-3 w-3" />
              </Button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-muted border border-border rounded-lg shadow-xl z-50">
                  <div className="p-1">
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-foreground/80 hover:bg-foreground/10 hover:text-foreground rounded-md transition-colors"
                      onClick={() => {
                        exportMutation.mutate({ format: 'csv', period });
                        setShowExportMenu(false);
                      }}
                    >
                      Export as CSV
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-foreground/80 hover:bg-foreground/10 hover:text-foreground rounded-md transition-colors"
                      onClick={() => {
                        exportMutation.mutate({ format: 'json', period });
                        setShowExportMenu(false);
                      }}
                    >
                      Export as JSON
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── Section 1: Summary Cards ──────────────────────────────── */}
        <div>
          {/* Period selector */}
          <div className="flex items-center gap-1 mb-4 bg-card border border-border rounded-lg p-1 w-fit">
            {periods.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  period === p.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Revenue */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Total Revenue</span>
                <DollarSign className="h-5 w-5 text-violet-400" />
              </div>
              {summaryLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-2xl font-bold text-foreground">
                  {formatCompact(summaryData.totalRevenue)}
                </p>
              )}
            </div>

            {/* Net Credits */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Net Credits</span>
                <Coins className="h-5 w-5 text-emerald-400" />
              </div>
              {summaryLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <p
                    className={`text-2xl font-bold ${summaryData.netCredits >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {summaryData.netCredits >= 0 ? '+' : ''}
                    {summaryData.netCredits.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {summaryData.creditsEarned.toLocaleString()} earned /{' '}
                    {summaryData.creditsSpent.toLocaleString()} spent
                  </p>
                </>
              )}
            </div>

            {/* Top Universe */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Top Universe</span>
                <Globe className="h-5 w-5 text-blue-400" />
              </div>
              {summaryLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : summaryData.topUniverse ? (
                <>
                  <p className="text-lg font-bold text-foreground truncate">
                    {summaryData.topUniverse.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatUSD(summaryData.topUniverse.revenue)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No universe data yet</p>
              )}
            </div>

            {/* Period Label */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Period</span>
                <Calendar className="h-5 w-5 text-amber-400" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {period === 'day'
                  ? 'Today'
                  : period === 'week'
                    ? 'This Week'
                    : period === 'month'
                      ? 'This Month'
                      : 'All Time'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* ── Section 2: Revenue by Source ──────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Revenue by Source</h2>
          {sourcesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sourceList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No revenue data for this period.</p>
          ) : (
            <div className="space-y-4">
              {/* Stacked bar */}
              <div className="h-6 rounded-full overflow-hidden flex bg-muted">
                {sourceList.map((s) => {
                  const config = SOURCE_CONFIG[s.source];
                  return (
                    <div
                      key={s.source}
                      className={`${config?.bg ?? 'bg-foreground/20'} transition-all duration-300`}
                      style={{ width: `${Math.max(s.percentage, 1)}%` }}
                      title={`${s.source}: ${formatUSD(s.amount)} (${s.percentage.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>

              {/* Legend list */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sourceList.map((s) => {
                  const config = SOURCE_CONFIG[s.source];
                  const Icon = config?.icon ?? DollarSign;
                  return (
                    <div
                      key={s.source}
                      className="flex items-center gap-3 bg-muted/50 rounded-lg px-4 py-3"
                    >
                      <div
                        className={`p-2 rounded-lg bg-muted ${config?.color ?? 'text-muted-foreground'}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{s.source}</p>
                        <p className="text-xs text-muted-foreground">{s.percentage.toFixed(1)}%</p>
                      </div>
                      <p className="text-sm font-semibold text-foreground">{formatUSD(s.amount)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Revenue Timeline ──────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Revenue Timeline</h2>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              {chartPeriods.map((cp) => (
                <button
                  key={cp.value}
                  onClick={() => setChartPeriod(cp.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    chartPeriod === cp.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/10'
                  }`}
                >
                  {cp.label}
                </button>
              ))}
            </div>
          </div>

          {timelineLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : timelineData.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              No timeline data for this period.
            </div>
          ) : (
            <div className="w-full">
              {/* Chart area */}
              <div className="flex items-end gap-[2px] h-48 w-full">
                {timelineData.map((point, i) => {
                  const heightPct = (point.amount / maxTimelineValue) * 100;
                  return (
                    <div
                      key={`${point.date}-${i}`}
                      className="group relative flex-1 min-w-[4px] flex flex-col items-center justify-end h-full"
                    >
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 pointer-events-none">
                        <div className="bg-foreground/10 text-foreground text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                          <p className="font-medium">{point.date}</p>
                          <p className="text-violet-300">{formatUSD(point.amount)}</p>
                        </div>
                      </div>
                      {/* Bar */}
                      <div
                        className="w-full rounded-t bg-violet-500 hover:bg-violet-400 transition-colors cursor-pointer"
                        style={{ height: `${Math.max(heightPct, 1)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* X-axis labels (first, middle, last) */}
              {timelineData.length >= 2 && (
                <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                  <span>{timelineData[0].date}</span>
                  {timelineData.length >= 3 && (
                    <span>{timelineData[Math.floor(timelineData.length / 2)].date}</span>
                  )}
                  <span>{timelineData[timelineData.length - 1].date}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Section 4: Revenue by Universe ───────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Revenue by Universe</h2>
          {universesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : universeList.length === 0 ? (
            <div className="text-center py-8">
              <Globe className="h-8 w-8 text-muted-foreground/70 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No universes generating revenue yet.</p>
              <RouterLink to="/create">
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 border-border text-foreground/80"
                >
                  Create a Universe
                </Button>
              </RouterLink>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full min-w-[500px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 pb-3">
                      Universe
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 pb-3">
                      Revenue
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 pb-3">
                      Holders
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 pb-3">
                      Subscribers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {universeList.map((u, idx) => (
                    <tr
                      key={u.id}
                      onClick={() => navigate({ to: '/universe/$id', params: { id: u.id } })}
                      className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10 text-violet-400 text-sm font-bold">
                            {idx + 1}
                          </div>
                          <span className="text-sm font-medium text-foreground">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-foreground">
                        {formatUSD(u.revenue)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {u.holders.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-muted-foreground">
                        {u.subscribers.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
