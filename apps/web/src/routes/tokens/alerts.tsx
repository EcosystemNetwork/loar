/**
 * Price alerts management — list, pause/resume and delete the caller's token
 * price alerts. Delivery is an FCM push from the server sweep.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Bell, Trash2, Play, Pause, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export const Route = createFileRoute('/tokens/alerts')({
  component: AlertsPage,
});

function AlertsPage() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tokenAlerts', 'list'] });

  const { data: alerts, isLoading } = useQuery({
    ...trpc.tokenAlerts.list.queryOptions(),
    enabled: isAuthenticated,
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => trpcClient.tokenAlerts.setActive.mutate(v),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => trpcClient.tokenAlerts.remove.mutate({ id }),
    onSuccess: () => {
      toast.success('Alert deleted');
      invalidate();
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-6 flex items-center gap-4">
          <Link to="/tokens">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Launchpad
            </Button>
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Bell className="h-6 w-6 text-primary" />
              Price Alerts
            </h1>
            <p className="text-sm text-muted-foreground">
              Get a push when a token crosses your target price.
            </p>
          </div>
        </div>

        {!isAuthenticated ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Sign in to manage price alerts.
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : !alerts?.length ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No alerts yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open any token and hit “Alert” to arm one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <Card key={a.id} className={a.active ? '' : 'opacity-60'}>
                <CardContent className="flex items-center gap-3 p-3">
                  <div
                    className={`rounded-lg p-2 ${
                      a.kind === 'above' ? 'bg-green-500/10' : 'bg-red-500/10'
                    }`}
                  >
                    {a.kind === 'above' ? (
                      <ArrowUpRight className="h-4 w-4 text-green-500" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/tokens/$address"
                      params={{ address: a.tokenAddress }}
                      className="text-sm font-semibold hover:underline"
                    >
                      {a.tokenSymbol ? `$${a.tokenSymbol}` : `${a.tokenAddress.slice(0, 10)}…`}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {a.kind === 'above' ? 'Above' : 'Below'}{' '}
                      <span className="font-mono">
                        {a.targetPrice < 0.001
                          ? a.targetPrice.toExponential(2)
                          : a.targetPrice.toFixed(8)}{' '}
                        ETH
                      </span>
                      {a.triggerCount > 0 && (
                        <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[9px]">
                          fired {a.triggerCount}×
                        </Badge>
                      )}
                    </p>
                  </div>
                  {!a.active && (
                    <Badge variant="outline" className="text-[9px]">
                      {a.triggerCount > 0 ? 'triggered' : 'paused'}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    title={a.active ? 'Pause' : 'Resume'}
                    onClick={() => toggleMut.mutate({ id: a.id, active: !a.active })}
                  >
                    {a.active ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                    title="Delete"
                    onClick={() => removeMut.mutate(a.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
