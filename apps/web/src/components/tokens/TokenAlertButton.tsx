/**
 * TokenAlertButton — "Alert" control on the token detail page. Opens a small
 * form to arm an above/below price alert; delivery is an FCM push from the
 * server sweep (apps/server/src/jobs/token-alerts.ts).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bell, BellRing } from 'lucide-react';

export function TokenAlertButton({
  tokenAddress,
  tokenSymbol,
  currentPrice,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  currentPrice: number | null;
}) {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'above' | 'below'>('above');
  const [price, setPrice] = useState('');
  const [open, setOpen] = useState(false);

  const { data: alerts } = useQuery({
    ...trpc.tokenAlerts.list.queryOptions(),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  const activeForToken = (alerts ?? []).filter(
    (a) => a.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() && a.active
  ).length;

  const createMut = useMutation({
    mutationFn: (vars: { kind: 'above' | 'below'; targetPrice: number }) =>
      trpcClient.tokenAlerts.create.mutate({
        tokenAddress,
        tokenSymbol,
        kind: vars.kind,
        targetPrice: vars.targetPrice,
      }),
    onSuccess: () => {
      toast.success('Alert armed — you’ll get a push when it triggers.');
      queryClient.invalidateQueries({ queryKey: ['tokenAlerts', 'list'] });
      setPrice('');
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create alert'),
  });

  if (!isAuthenticated) return null;

  const submit = () => {
    const p = Number(price);
    if (!p || p <= 0 || !Number.isFinite(p)) {
      toast.error('Enter a positive price');
      return;
    }
    createMut.mutate({ kind, targetPrice: p });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {activeForToken > 0 ? (
            <BellRing className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Bell className="h-3.5 w-3.5" />
          )}
          {activeForToken > 0 ? `${activeForToken} alert${activeForToken > 1 ? 's' : ''}` : 'Alert'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-3">
        <p className="mb-2 text-xs font-semibold">Notify me when price is…</p>
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
          {(['above', 'below'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md py-1 text-xs font-medium capitalize ${
                kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="relative">
          <Input
            type="number"
            inputMode="decimal"
            placeholder={currentPrice ? currentPrice.toFixed(8) : '0.0'}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-9 pr-10 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            ETH
          </span>
        </div>
        {currentPrice != null && (
          <div className="mt-1.5 flex gap-1">
            {[-10, -5, 5, 10, 25].map((pct) => (
              <button
                key={pct}
                onClick={() => setPrice((currentPrice * (1 + pct / 100)).toPrecision(6))}
                className="rounded border px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
              >
                {pct > 0 ? '+' : ''}
                {pct}%
              </button>
            ))}
          </div>
        )}
        <Button
          size="sm"
          className="mt-2.5 w-full text-xs"
          disabled={createMut.isPending}
          onClick={submit}
        >
          {createMut.isPending ? 'Arming…' : 'Arm alert'}
        </Button>
        <Link
          to="/tokens/alerts"
          className="mt-2 block text-center text-[11px] text-muted-foreground hover:text-foreground"
        >
          Manage all alerts
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
