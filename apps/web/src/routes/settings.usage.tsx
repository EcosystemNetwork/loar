/**
 * /settings/usage — 30-day credit usage breakdown.
 *
 * Pulls from `providers.usage` (server-side aggregation of
 * creditReservations rows) and shows: total credits spent in the last
 * 30 days, BYOK vs server-pool split, per-provider stats.
 *
 * No interactive controls — read-only dashboard for transparency. To
 * change usage limits, users go to /credits (purchase top-ups).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Coins, Lock, Server } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/settings/usage')({
  component: UsagePage,
});

function UsagePage() {
  const usageQuery = useQuery({
    queryKey: ['providers', 'usage'],
    queryFn: () => trpcClient.providers.usage.query(),
    staleTime: 30_000,
  });

  if (usageQuery.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const data = usageQuery.data;
  if (!data) {
    return (
      <div className="container max-w-4xl py-8">
        <p className="text-muted-foreground">No usage data available yet.</p>
      </div>
    );
  }

  const serverCredits = data.totalCredits - data.byokCredits;
  const byokPct =
    data.totalCredits > 0 ? Math.round((data.byokCredits / data.totalCredits) * 100) : 0;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Last {data.windowDays} days of model spend across captions, generation, and pipelines.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Coins className="size-4 text-amber-400" /> Total spent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{data.totalCredits.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">credits</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Server className="size-4 text-sky-400" /> Platform-paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{serverCredits.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              calls billed against your LOAR credits
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Lock className="size-4 text-emerald-400" /> BYOK
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{data.byokCredits.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {byokPct}% of usage on your own keys
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By provider</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byProvider.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No provider activity in the last {data.windowDays} days.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {[...data.byProvider]
                .sort((a, b) => b.totalCredits - a.totalCredits)
                .map((row) => (
                  <div key={row.provider} className="flex items-center gap-3 py-3">
                    <Badge variant="outline" className="capitalize">
                      {row.provider}
                    </Badge>
                    <div className="flex-1">
                      <div className="text-sm">
                        {row.calls.toLocaleString()} call{row.calls === 1 ? '' : 's'} ·{' '}
                        {row.byokCalls.toLocaleString()} BYOK
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{row.totalCredits.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">credits</div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        BYOK calls bill a flat 1-credit routing fee regardless of duration. Platform-paid calls bill
        at the per-minute price of the chosen model.
      </p>
    </div>
  );
}
