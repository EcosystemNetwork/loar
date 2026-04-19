/**
 * Admin Cost Dashboard — full-controls version.
 *
 * Surfaces:
 *  - Margin + revenue + cost cards with period-over-period delta
 *  - 30-day trend chart (SVG, cost bars + margin line vs target)
 *  - Per-provider × kind table
 *  - Per-model table with cost-per-call efficiency
 *  - Top movers (scope switcher)
 *  - Filtered ledger with CSV export
 *  - Kill-switch + daily caps + alert config panel
 *  - Rolling alert feed with acknowledge + manual sweep
 *
 * Wallet-gated twice: route guard + adminProcedure on the server.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import {
  Shield,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Loader2,
  Gauge,
  Users,
  Key,
  Orbit,
  Layers,
  RefreshCw,
  Download,
  Activity,
  Flame,
} from 'lucide-react';
import { CostTrendChart } from '@/components/admin/CostTrendChart';
import { CostControlsPanel } from '@/components/admin/CostControlsPanel';
import { CostAlertsFeed } from '@/components/admin/CostAlertsFeed';

export const Route = createFileRoute('/admin/cost')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/cost' } });
    }
  },
  component: CostDashboard,
});

function fmtUsd(v: number | undefined | null) {
  const n = Number(v ?? 0);
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(r: number | undefined | null) {
  const n = Number(r ?? 0);
  if (!Number.isFinite(n)) return '∞';
  return `${(n * 100).toFixed(1)}%`;
}

function truncAddr(s: string | null | undefined) {
  if (!s) return '—';
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function DeltaChip({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (!Number.isFinite(value)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const up = value > 0;
  const neutral = Math.abs(value) < 0.0001;
  const Icon = neutral ? Activity : up ? TrendingUp : TrendingDown;
  const cls = neutral ? 'text-muted-foreground' : up ? 'text-rose-400' : 'text-emerald-400';
  const sign = up && !neutral ? '+' : '';
  return (
    <span className={`text-[10px] flex items-center gap-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />
      {sign}
      {suffix === '%' ? `${(value * 100).toFixed(1)}pts` : `${sign}${value.toFixed(2)}${suffix}`}
    </span>
  );
}

function CostDashboard() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const [window, setWindow] = useState<'day' | 'month'>('day');
  const [moverScope, setMoverScope] = useState<'user' | 'apiKey' | 'universe'>('user');

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const {
    data: overview,
    isLoading: loadingOverview,
    refetch,
  } = useQuery({
    queryKey: ['admin-cost-overview', window],
    queryFn: () => trpcClient.admin.cost.overview.query({ window }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 15_000,
  });

  const { data: trend } = useQuery({
    queryKey: ['admin-cost-trend'],
    queryFn: () => trpcClient.admin.cost.trend.query({ days: 30 }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  const { data: comparison } = useQuery({
    queryKey: ['admin-cost-comparison', window],
    queryFn: () =>
      trpcClient.admin.cost.comparison.query({
        window: window === 'day' ? 'day' : 'month',
      }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  const { data: byModel } = useQuery({
    queryKey: ['admin-cost-by-model', window],
    queryFn: () => trpcClient.admin.cost.byModel.query({ window, limit: 30 }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  const { data: movers } = useQuery({
    queryKey: ['admin-cost-movers', moverScope],
    queryFn: () => trpcClient.admin.cost.topMovers.query({ scope: moverScope, limit: 10 }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  const { data: byUser } = useQuery({
    queryKey: ['admin-cost-by-user', window],
    queryFn: () => trpcClient.admin.cost.byUser.query({ window, limit: 25 }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  const { data: byApiKey } = useQuery({
    queryKey: ['admin-cost-by-apikey', window],
    queryFn: () => trpcClient.admin.cost.byApiKey.query({ window, limit: 25 }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  const { data: byUniverse } = useQuery({
    queryKey: ['admin-cost-by-universe', window],
    queryFn: () => trpcClient.admin.cost.byUniverse.query({ window, limit: 25 }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 60_000,
  });

  // ── Ledger filters ────────────────────────────────────────────────
  const [providerFilter, setProviderFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [apiKeyFilter, setApiKeyFilter] = useState('');
  const [universeFilter, setUniverseFilter] = useState('');

  const { data: ledger } = useQuery({
    queryKey: ['admin-cost-ledger', providerFilter, userFilter, apiKeyFilter, universeFilter],
    queryFn: () =>
      trpcClient.admin.cost.ledger.query({
        limit: 200,
        provider: providerFilter || undefined,
        userId: userFilter || undefined,
        apiKeyId: apiKeyFilter || undefined,
        universeAddress: universeFilter || undefined,
      }),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 15_000,
  });

  function buildCsvUrl() {
    const base = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    const q = new URLSearchParams();
    if (providerFilter) q.set('provider', providerFilter);
    if (userFilter) q.set('userId', userFilter);
    if (apiKeyFilter) q.set('apiKeyId', apiKeyFilter);
    if (universeFilter) q.set('universeAddress', universeFilter);
    q.set('limit', '2000');
    return `${base}/api/admin/cost/export.csv?${q.toString()}`;
  }

  const margin = (overview as any)?.margin as
    | {
        marginRatio?: number;
        hitsTarget?: boolean;
        target?: number;
        revenueUsd?: number;
        costUsd?: number;
      }
    | undefined;

  const marginGood = margin?.hitsTarget ?? false;
  const marginDelta = useMemo(() => {
    if (!margin) return 0;
    return (margin.marginRatio ?? 0) - (margin.target ?? 0.3);
  }, [margin]);

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) return null;
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 mx-auto text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-muted-foreground text-sm">
            Your wallet address does not have admin access.
          </p>
        </div>
      </div>
    );
  }

  const compCurrent = (comparison as any)?.current;
  const compPrev = (comparison as any)?.previous;
  const compDelta = (comparison as any)?.delta;

  return (
    <div className="min-h-screen bg-background p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="h-6 w-6" /> Cost &amp; Margin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every paid provider API call is attributed here. Target gross margin ≥ 30%.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={window} onValueChange={(v) => setWindow(v as 'day' | 'month')}>
            <TabsList>
              <TabsTrigger value="day">Today</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> refresh
          </button>
        </div>
      </div>

      {/* Top stats w/ period comparison */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Gauge className="h-3 w-3" /> Margin
            </div>
            <p
              className={`text-2xl font-bold ${
                loadingOverview
                  ? 'text-muted-foreground'
                  : marginGood
                    ? 'text-emerald-400'
                    : 'text-rose-400'
              }`}
            >
              {fmtPct(margin?.marginRatio)}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>target {fmtPct(margin?.target ?? 0.3)}</span>
              <span className="text-muted-foreground">
                {marginDelta >= 0 ? '+' : ''}
                {(marginDelta * 100).toFixed(1)}pts
              </span>
            </div>
            {compDelta ? (
              <div className="mt-1">
                <DeltaChip value={compDelta.marginRatioDelta} suffix="%" />
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              Revenue
            </div>
            <p className="text-2xl font-bold">{fmtUsd(margin?.revenueUsd)}</p>
            {compDelta ? (
              <DeltaChip value={compDelta.revenuePct} suffix="%" />
            ) : (
              <p className="text-[10px] text-muted-foreground">credits + subs</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              Provider cost
            </div>
            <p className="text-2xl font-bold">{fmtUsd((overview as any)?.total?.costUsd ?? 0)}</p>
            {compDelta ? (
              <DeltaChip value={compDelta.costPct} suffix="%" />
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {(overview as any)?.total?.calls ?? 0} calls
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">Net</div>
            <p
              className={`text-2xl font-bold ${marginGood ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {fmtUsd((margin?.revenueUsd ?? 0) - (margin?.costUsd ?? 0))}
            </p>
            <p className="text-[10px] text-muted-foreground">revenue − cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend chart */}
      <Card className="mb-4">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">30-day trend</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {trend ? (
            <CostTrendChart
              series={((trend as any).series ?? []) as any[]}
              target={(trend as any).target ?? 0.3}
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-8">
              <Loader2 className="h-3 w-3 animate-spin" /> loading trend…
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grid: per-provider + per-model */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By Provider × Kind</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!(overview as any)?.byProvider?.length ? (
              <p className="text-xs text-muted-foreground p-4">No spend in this window yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left p-2">Provider</th>
                    <th className="text-left p-2">Kind</th>
                    <th className="text-right p-2">Cost</th>
                    <th className="text-right p-2">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {((overview as any).byProvider as any[]).map((r) => {
                    const [provider, kind] = String(r.key).split(':');
                    return (
                      <tr key={r.key} className="border-b">
                        <td className="p-2">
                          <Badge variant="outline" className="text-[9px]">
                            {provider}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">{kind}</td>
                        <td className="p-2 text-right font-mono">{fmtUsd(r.costUsd)}</td>
                        <td className="p-2 text-right text-muted-foreground">{r.calls}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By Model — cost / call</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!(byModel as any)?.rows?.length ? (
              <p className="text-xs text-muted-foreground p-4">No model-attributed spend yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left p-2">Model</th>
                    <th className="text-right p-2">Cost</th>
                    <th className="text-right p-2">$/call</th>
                    <th className="text-right p-2">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {((byModel as any).rows as any[]).map((r) => (
                    <tr key={r.key} className="border-b">
                      <td className="p-2">
                        <span className="font-mono">{r.model || '—'}</span>
                        <span className="text-[9px] text-muted-foreground ml-1">{r.provider}</span>
                      </td>
                      <td className="p-2 text-right font-mono">{fmtUsd(r.costUsd)}</td>
                      <td className="p-2 text-right font-mono">{fmtUsd(r.costPerCallUsd)}</td>
                      <td className="p-2 text-right text-muted-foreground">{r.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Controls + Alerts */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <CostControlsPanel />
        <CostAlertsFeed />
      </div>

      {/* Top movers */}
      <Card className="mb-4">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Flame className="h-3 w-3" /> Top movers — today vs yesterday
          </CardTitle>
          <Tabs value={moverScope} onValueChange={(v) => setMoverScope(v as typeof moverScope)}>
            <TabsList>
              <TabsTrigger value="user">User</TabsTrigger>
              <TabsTrigger value="apiKey">API Key</TabsTrigger>
              <TabsTrigger value="universe">Universe</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          {!(movers as any[])?.length ? (
            <p className="text-xs text-muted-foreground p-4">No movers yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left p-2">{moverScope}</th>
                  <th className="text-right p-2">Today</th>
                  <th className="text-right p-2">Yesterday</th>
                  <th className="text-right p-2">Δ USD</th>
                  <th className="text-right p-2">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {((movers as any[]) ?? []).map((m) => (
                  <tr key={m.key} className="border-b">
                    <td className="p-2 font-mono text-muted-foreground">{truncAddr(m.key)}</td>
                    <td className="p-2 text-right font-mono">{fmtUsd(m.currentUsd)}</td>
                    <td className="p-2 text-right font-mono">{fmtUsd(m.previousUsd)}</td>
                    <td
                      className={`p-2 text-right font-mono ${
                        m.deltaUsd >= 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {m.deltaUsd >= 0 ? '+' : ''}
                      {fmtUsd(m.deltaUsd)}
                    </td>
                    <td className="p-2 text-right text-[10px] text-muted-foreground">
                      {Number.isFinite(m.deltaPct) ? fmtPct(m.deltaPct) : '∞'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Leaderboards */}
      <Tabs defaultValue="byUser" className="mb-4">
        <TabsList className="mb-3">
          <TabsTrigger value="byUser">
            <Users className="h-3 w-3 mr-1" /> By User
          </TabsTrigger>
          <TabsTrigger value="byApiKey">
            <Key className="h-3 w-3 mr-1" /> By API Key
          </TabsTrigger>
          <TabsTrigger value="byUniverse">
            <Orbit className="h-3 w-3 mr-1" /> By Universe
          </TabsTrigger>
          <TabsTrigger value="ledger">
            <Layers className="h-3 w-3 mr-1" /> Ledger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="byUser">
          <ScopeTable rows={(byUser as any)?.rows ?? []} label="User" />
        </TabsContent>
        <TabsContent value="byApiKey">
          <ScopeTable rows={(byApiKey as any)?.rows ?? []} label="API Key ID" />
        </TabsContent>
        <TabsContent value="byUniverse">
          <ScopeTable rows={(byUniverse as any)?.rows ?? []} label="Universe" />
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardContent className="p-3 space-y-3 text-xs">
              <div className="grid grid-cols-5 gap-2">
                <Input
                  placeholder="provider"
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                />
                <Input
                  placeholder="userId (0x…)"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
                <Input
                  placeholder="apiKeyId"
                  value={apiKeyFilter}
                  onChange={(e) => setApiKeyFilter(e.target.value)}
                />
                <Input
                  placeholder="universe (0x…)"
                  value={universeFilter}
                  onChange={(e) => setUniverseFilter(e.target.value)}
                />
                <Button asChild size="sm" variant="outline" className="h-8">
                  <a href={buildCsvUrl()} target="_blank" rel="noreferrer">
                    <Download className="h-3 w-3 mr-1" /> CSV
                  </a>
                </Button>
              </div>
              {!(ledger as any[])?.length ? (
                <p className="text-muted-foreground">No ledger rows match this filter.</p>
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground sticky top-0 bg-background">
                      <tr className="border-b">
                        <th className="text-left p-2">Time</th>
                        <th className="text-left p-2">Route</th>
                        <th className="text-left p-2">Provider</th>
                        <th className="text-left p-2">Model</th>
                        <th className="text-left p-2">User</th>
                        <th className="text-left p-2">API Key</th>
                        <th className="text-left p-2">Universe</th>
                        <th className="text-right p-2">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((ledger as any[]) ?? []).map((r) => (
                        <tr key={r.id} className="border-b">
                          <td className="p-2 text-muted-foreground whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleTimeString()}
                          </td>
                          <td className="p-2 text-muted-foreground truncate max-w-[160px]">
                            {r.route ?? '—'}
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-[9px]">
                              {r.provider}
                            </Badge>
                          </td>
                          <td className="p-2 text-muted-foreground">{r.model ?? '—'}</td>
                          <td className="p-2 font-mono text-muted-foreground">
                            {truncAddr(r.userId)}
                          </td>
                          <td className="p-2 font-mono text-muted-foreground">
                            {truncAddr(r.apiKeyId)}
                          </td>
                          <td className="p-2 font-mono text-muted-foreground">
                            {truncAddr(r.universeAddress)}
                          </td>
                          <td className="p-2 text-right font-mono">{fmtUsd(r.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Period-over-period summary */}
      {compCurrent && compPrev ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Period comparison ({window === 'day' ? 'today vs yesterday' : 'this month vs last'})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-xs">
            <table className="w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left p-2">Metric</th>
                  <th className="text-right p-2">Previous</th>
                  <th className="text-right p-2">Current</th>
                  <th className="text-right p-2">Δ</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-2">Revenue</td>
                  <td className="p-2 text-right font-mono">{fmtUsd(compPrev.revenueUsd)}</td>
                  <td className="p-2 text-right font-mono">{fmtUsd(compCurrent.revenueUsd)}</td>
                  <td className="p-2 text-right">
                    <DeltaChip value={compDelta?.revenuePct ?? 0} suffix="%" />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="p-2">Cost</td>
                  <td className="p-2 text-right font-mono">{fmtUsd(compPrev.costUsd)}</td>
                  <td className="p-2 text-right font-mono">{fmtUsd(compCurrent.costUsd)}</td>
                  <td className="p-2 text-right">
                    <DeltaChip value={compDelta?.costPct ?? 0} suffix="%" />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="p-2">Margin</td>
                  <td className="p-2 text-right font-mono">{fmtPct(compPrev.marginRatio)}</td>
                  <td className="p-2 text-right font-mono">{fmtPct(compCurrent.marginRatio)}</td>
                  <td className="p-2 text-right">
                    <DeltaChip value={compDelta?.marginRatioDelta ?? 0} suffix="%" />
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ScopeTable({ rows, label }: { rows: any[]; label: string }) {
  if (!rows?.length) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          No {label.toLowerCase()}-attributed spend in this window yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="text-left p-2">{label}</th>
              <th className="text-right p-2">Cost</th>
              <th className="text-right p-2">Calls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b">
                <td className="p-2 font-mono text-muted-foreground">
                  {r.key?.length > 14 ? `${r.key.slice(0, 8)}…${r.key.slice(-4)}` : r.key}
                </td>
                <td className="p-2 text-right font-mono">
                  {r.costUsd < 0.01
                    ? `$${Number(r.costUsd).toFixed(4)}`
                    : `$${Number(r.costUsd).toFixed(2)}`}
                </td>
                <td className="p-2 text-right text-muted-foreground">{r.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
