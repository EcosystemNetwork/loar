/**
 * Rolling feed of margin / cap alerts with admin acknowledge + manual sweep.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, CheckCircle2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

export function CostAlertsFeed() {
  const qc = useQueryClient();
  const { data: alerts } = useQuery({
    queryKey: ['admin-cost-alerts'],
    queryFn: () => trpcClient.admin.cost.alerts.list.query({ limit: 50 }),
    refetchInterval: 30_000,
  });

  const ack = useMutation({
    mutationFn: (alertId: string) => trpcClient.admin.cost.alerts.acknowledge.mutate({ alertId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-cost-alerts'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Acknowledge failed'),
  });

  const runNow = useMutation({
    mutationFn: () => trpcClient.admin.cost.alerts.runNow.mutate(),
    onSuccess: (res: any) => {
      const n = res?.fired?.length ?? 0;
      toast.success(n ? `Fired ${n} alert(s)` : 'No breaches');
      qc.invalidateQueries({ queryKey: ['admin-cost-alerts'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Run failed'),
  });

  const rows = ((alerts as any[]) ?? []) as any[];
  const open = rows.filter((a) => !a.acknowledged);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-3 w-3" /> Alerts
          {open.length > 0 ? (
            <Badge variant="destructive" className="text-[9px]">
              {open.length} open
            </Badge>
          ) : null}
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={runNow.isPending}
          onClick={() => runNow.mutate()}
        >
          <RefreshCcw className="h-3 w-3 mr-1" /> Check now
        </Button>
      </CardHeader>
      <CardContent className="p-0 text-xs">
        {rows.length === 0 ? (
          <p className="p-3 text-muted-foreground flex items-center gap-2">
            <BellOff className="h-3 w-3" /> No alerts in history.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((a) => (
              <li key={a.id} className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${
                      a.severity === 'page'
                        ? 'text-rose-300 border-rose-500/40'
                        : 'text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {a.kind}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {a.firedAt ? new Date(a.firedAt).toLocaleString() : ''}
                  </span>
                  {a.acknowledged ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] text-emerald-300 border-emerald-500/40"
                    >
                      acked
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 ml-auto"
                      disabled={ack.isPending}
                      onClick={() => ack.mutate(a.id)}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" /> ack
                    </Button>
                  )}
                </div>
                <p>{a.message}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
