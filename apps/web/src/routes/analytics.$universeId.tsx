/**
 * Creator Analytics Dashboard — Per-universe metrics, subscriber breakdown,
 * recent activity, and data export.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3,
  Eye,
  Coins,
  Users,
  Download,
  TrendingUp,
  Loader2,
  AlertCircle,
  Activity,
  Crown,
  Star,
  Shield,
  UserCheck,
  Filter,
  Calendar,
} from 'lucide-react';

export const Route = createFileRoute('/analytics/$universeId')({
  component: AnalyticsDashboardPage,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatRevenue(n: number | undefined | null): string {
  if (n == null) return '$0.00';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TIER_META: Record<string, { label: string; color: string; icon: typeof Users }> = {
  FREE: { label: 'Free', color: 'bg-zinc-600', icon: UserCheck },
  BASIC: { label: 'Basic', color: 'bg-blue-600', icon: Shield },
  PREMIUM: { label: 'Premium', color: 'bg-violet-600', icon: Star },
  VIP: { label: 'VIP', color: 'bg-amber-500', icon: Crown },
};

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 bg-zinc-700 rounded" />
          <div className="h-8 w-20 bg-zinc-700 rounded" />
        </div>
      </CardContent>
    </Card>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse flex items-center gap-3">
          <div className="h-8 w-8 bg-zinc-700 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 bg-zinc-700 rounded" />
            <div className="h-3 w-1/2 bg-zinc-700 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AnalyticsDashboardPage() {
  const { universeId } = Route.useParams();
  const [isExporting, setIsExporting] = useState(false);
  const [funnelDays, setFunnelDays] = useState<30 | 90 | 180>(90);
  const [cohortWeeks, setCohortWeeks] = useState<4 | 6 | 8>(6);

  // --- Data queries ---

  const {
    data: metrics,
    isLoading: metricsLoading,
    error: metricsError,
  } = useQuery({
    queryKey: ['universe-metrics', universeId],
    queryFn: () => trpcClient.analytics.getUniverseMetrics.query({ universeId }),
    enabled: !!universeId,
  });

  const {
    data: subStats,
    isLoading: subsLoading,
    error: subsError,
  } = useQuery({
    queryKey: ['sub-stats', universeId],
    queryFn: () => trpcClient.subscriptions.getUniverseStats.query({ universeId }),
    enabled: !!universeId,
  });

  const {
    data: recentActivity,
    isLoading: activityLoading,
    error: activityError,
  } = useQuery({
    queryKey: ['recent-activity', universeId],
    queryFn: () => trpcClient.analytics.getRecentActivity.query({ universeId, limit: 20 }),
    enabled: !!universeId,
  });

  const {
    data: funnel,
    isLoading: funnelLoading,
    error: funnelError,
  } = useQuery({
    queryKey: ['funnel', universeId, funnelDays],
    queryFn: () => trpcClient.analytics.getFunnel.query({ universeId, daysAgo: funnelDays }),
    enabled: !!universeId,
  });

  const {
    data: cohorts,
    isLoading: cohortsLoading,
    error: cohortsError,
  } = useQuery({
    queryKey: ['cohorts', universeId, cohortWeeks],
    queryFn: () => trpcClient.analytics.getCohorts.query({ universeId, weeks: cohortWeeks }),
    enabled: !!universeId,
  });

  // --- Export handler ---

  async function handleExport() {
    setIsExporting(true);
    try {
      const data = await trpcClient.analytics.exportUniverseData.query({
        universeId,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${universeId.slice(0, 8)}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }

  // --- Error state ---

  function ErrorBanner({ message }: { message: string }) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/50 p-4 text-red-300">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }

  // --- Stat cards ---

  const statCards = [
    {
      label: 'Total Views',
      value: formatNumber((metrics as any)?.views),
      icon: Eye,
      accent: 'text-blue-400',
    },
    {
      label: 'Total Mints',
      value: formatNumber((metrics as any)?.mints),
      icon: Coins,
      accent: 'text-emerald-400',
    },
    {
      label: 'Active Subscribers',
      value: formatNumber((metrics as any)?.subscribers),
      icon: Users,
      accent: 'text-violet-400',
    },
    {
      label: 'Total Revenue',
      value: formatRevenue((metrics as any)?.revenue),
      icon: TrendingUp,
      accent: 'text-amber-400',
    },
  ];

  return (
    <div className="container mx-auto px-4 py-6 space-y-8">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground text-sm font-mono truncate max-w-xs">
              {universeId}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={isExporting}
          className="gap-2 border-zinc-700"
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export Data
        </Button>
      </div>

      {/* ---- Error banners ---- */}
      {metricsError && <ErrorBanner message="Failed to load universe metrics." />}

      {/* ---- Stats cards ---- */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {metricsLoading
            ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            : statCards.map((stat) => {
                const Icon = stat.icon;
                return (
                  <Card key={stat.label} className="bg-zinc-900 border-zinc-800">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                        <Icon className={`h-5 w-5 ${stat.accent}`} />
                      </div>
                      <p className="mt-2 text-2xl font-bold">{stat.value}</p>
                    </CardContent>
                  </Card>
                );
              })}
        </div>
      </section>

      {/* ---- Two-column layout: Subscribers + Activity ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subscriber Breakdown */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-violet-400" />
              Subscriber Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subsError && <ErrorBanner message="Failed to load subscriber data." />}
            {subsLoading ? (
              <ListSkeleton rows={4} />
            ) : !subStats || (Array.isArray(subStats) && subStats.length === 0) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No subscriber data yet.
              </p>
            ) : (
              <div className="space-y-3">
                {(['FREE', 'BASIC', 'PREMIUM', 'VIP'] as const).map((tier) => {
                  const meta = TIER_META[tier];
                  const Icon = meta.icon;
                  const count =
                    typeof subStats === 'object' && !Array.isArray(subStats)
                      ? ((subStats as any)[tier] ?? (subStats as any)[tier.toLowerCase()] ?? 0)
                      : 0;
                  return (
                    <div
                      key={tier}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full ${meta.color}`}
                        >
                          <Icon className="h-4 w-4 text-white" />
                        </div>
                        <span className="text-sm font-medium">{meta.label}</span>
                      </div>
                      <Badge variant="secondary" className="font-mono">
                        {formatNumber(count)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscriber Funnel */}
        <Card className="bg-zinc-900 border-zinc-800 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-amber-400" />
                Conversion Funnel
              </div>
              <div className="flex gap-1">
                {([30, 90, 180] as const).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={funnelDays === d ? 'default' : 'outline'}
                    onClick={() => setFunnelDays(d)}
                    className="h-7 text-xs px-2 border-zinc-700"
                  >
                    {d}d
                  </Button>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {funnelError && <ErrorBanner message="Failed to load funnel data." />}
            {funnelLoading ? (
              <ListSkeleton rows={3} />
            ) : !funnel || funnel.stages.every((s: any) => s.count === 0) ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Not enough activity in the last {funnelDays} days to build a funnel.
              </p>
            ) : (
              <FunnelStages funnel={funnel as any} />
            )}
          </CardContent>
        </Card>

        {/* Cohort Retention */}
        <Card className="bg-zinc-900 border-zinc-800 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-400" />
                Weekly Cohort Retention
              </div>
              <div className="flex gap-1">
                {([4, 6, 8] as const).map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    variant={cohortWeeks === w ? 'default' : 'outline'}
                    onClick={() => setCohortWeeks(w)}
                    className="h-7 text-xs px-2 border-zinc-700"
                  >
                    {w}w
                  </Button>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cohortsError && <ErrorBanner message="Failed to load cohort data." />}
            {cohortsLoading ? (
              <ListSkeleton rows={4} />
            ) : !cohorts || (cohorts as any).cohorts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No cohort data for the last {cohortWeeks} weeks.
              </p>
            ) : (
              <CohortTable cohorts={(cohorts as any).cohorts} weeks={cohortWeeks} />
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-emerald-400" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityError && <ErrorBanner message="Failed to load recent activity." />}
            {activityLoading ? (
              <ListSkeleton rows={5} />
            ) : !recentActivity ||
              (Array.isArray(recentActivity) && recentActivity.length === 0) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No recent activity.</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {(Array.isArray(recentActivity) ? recentActivity : []).map(
                  (event: any, i: number) => (
                    <div
                      key={event.id ?? i}
                      className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                        <Activity className="h-4 w-4 text-zinc-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {event.type ?? event.action ?? 'Event'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {event.description ?? event.details ?? event.message ?? ''}
                        </p>
                        {event.createdAt && (
                          <p className="mt-1 text-xs text-zinc-500">
                            {new Date(event.createdAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {event.type && (
                        <Badge variant="outline" className="shrink-0 text-xs border-zinc-700">
                          {event.type}
                        </Badge>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

interface FunnelData {
  daysAgo: number;
  stages: { key: string; label: string; count: number; conversionFromPrev: number | null }[];
  rawViewedWallets: number;
  rawEngagedWallets: number;
  rawMintedWallets: number;
}

function FunnelStages({ funnel }: { funnel: FunnelData }) {
  const maxCount = Math.max(...funnel.stages.map((s) => s.count), 1);
  return (
    <div className="space-y-2">
      {funnel.stages.map((stage, i) => {
        const pct = (stage.count / maxCount) * 100;
        const convPct =
          stage.conversionFromPrev != null ? (stage.conversionFromPrev * 100).toFixed(1) : null;
        return (
          <div key={stage.key} className="flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-500 w-6">{i + 1}</span>
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">{stage.label}</span>
                <div className="flex items-center gap-3">
                  {convPct !== null && (
                    <span className="text-zinc-500">
                      → <span className="text-amber-400 font-mono">{convPct}%</span>
                    </span>
                  )}
                  <span className="font-mono text-zinc-300">
                    {stage.count.toLocaleString()} wallets
                  </span>
                </div>
              </div>
              <div className="h-6 bg-zinc-950 rounded overflow-hidden border border-zinc-800">
                <div
                  className={`h-full transition-all ${
                    i === 0 ? 'bg-blue-500/60' : i === 1 ? 'bg-violet-500/60' : 'bg-emerald-500/60'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="pt-2 mt-2 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          Unique raw wallets — views {funnel.rawViewedWallets}, engage {funnel.rawEngagedWallets},
          mints {funnel.rawMintedWallets}
        </span>
        <span>Last {funnel.daysAgo} days</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cohort table
// ---------------------------------------------------------------------------

interface Cohort {
  cohortWeek: string;
  size: number;
  retention: { weekOffset: number; count: number; rate: number }[];
}

function CohortTable({ cohorts, weeks }: { cohorts: Cohort[]; weeks: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-800">
            <th className="py-2 pr-3 font-semibold">Cohort</th>
            <th className="py-2 pr-3 font-semibold text-right">Size</th>
            {Array.from({ length: weeks }).map((_, i) => (
              <th key={i} className="py-2 px-2 font-semibold text-center">
                W{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohortWeek} className="border-b border-zinc-900">
              <td className="py-2 pr-3 font-mono text-zinc-300">{c.cohortWeek}</td>
              <td className="py-2 pr-3 font-mono text-right">{c.size}</td>
              {c.retention.map((r) => (
                <td key={r.weekOffset} className="py-2 px-2 text-center">
                  <RetentionCell rate={r.rate} count={r.count} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RetentionCell({ rate, count }: { rate: number; count: number }) {
  if (count === 0) return <span className="text-zinc-700">—</span>;
  // Color scale: 0% → zinc, 100% → emerald
  const intensity = Math.min(Math.max(rate, 0), 1);
  const bg = `rgba(16, 185, 129, ${(intensity * 0.55).toFixed(2)})`;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{ backgroundColor: bg, color: intensity > 0.3 ? '#fff' : '#d4d4d8' }}
      title={`${count} wallets returned`}
    >
      {(rate * 100).toFixed(0)}%
    </span>
  );
}
