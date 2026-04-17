/**
 * Subscription Management Page — View and manage active subscriptions.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useMySubscriptions } from '@/hooks/useRevenue';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Calendar, Shield, XCircle, Loader2, Crown } from 'lucide-react';

export const Route = createFileRoute('/subscriptions')({
  component: SubscriptionsPage,
});

const TIER_COLORS: Record<string, string> = {
  BASIC: 'bg-zinc-600 text-zinc-100',
  PREMIUM: 'bg-violet-600 text-violet-100',
  VIP: 'bg-amber-500 text-amber-950',
};

const TIER_ICONS: Record<string, React.ReactNode> = {
  BASIC: <Shield className="h-4 w-4" />,
  PREMIUM: <Crown className="h-4 w-4" />,
  VIP: <Crown className="h-4 w-4 text-amber-400" />,
};

function SubscriptionsPage() {
  const { isAuthenticated } = useWalletAuth();
  const { data: subscriptions, isLoading } = useMySubscriptions();
  const qc = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: (universeId: string) => trpcClient.subscriptions.cancel.mutate({ universeId }),
    onSuccess: () => {
      toast.success('Subscription cancelled successfully.');
      qc.invalidateQueries({ queryKey: ['my-subs'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to cancel subscription.');
    },
  });

  function handleCancel(universeId: string, universeName: string) {
    const confirmed = window.confirm(
      `Are you sure you want to cancel your subscription to "${universeName}"? This action cannot be undone.`
    );
    if (confirmed) {
      cancelMutation.mutate(universeId);
    }
  }

  // ── Auth guard ──
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <CreditCard className="mx-auto h-12 w-12 text-zinc-500 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-200 mb-2">Connect your wallet</h2>
        <p className="text-zinc-400">Sign in to view and manage your subscriptions.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-violet-400" />
        <h1 className="text-2xl font-bold text-zinc-100">My Subscriptions</h1>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-zinc-800 border-zinc-700 animate-pulse">
              <CardHeader>
                <div className="h-5 w-32 bg-zinc-700 rounded" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-4 w-24 bg-zinc-700 rounded" />
                <div className="h-4 w-40 bg-zinc-700 rounded" />
                <div className="h-9 w-full bg-zinc-700 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!subscriptions || subscriptions.length === 0) && (
        <div className="text-center py-16">
          <CreditCard className="mx-auto h-12 w-12 text-zinc-600 mb-4" />
          <h2 className="text-lg font-semibold text-zinc-300 mb-1">No active subscriptions</h2>
          <p className="text-zinc-500 text-sm">
            Browse universes and subscribe to unlock premium content.
          </p>
        </div>
      )}

      {/* Subscription list */}
      {!isLoading && subscriptions && subscriptions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map((sub: any) => {
            const tier = (sub.tier || 'BASIC').toUpperCase();
            const isActive = sub.status === 'active';
            const expiryDate = sub.expiresAt
              ? new Date(sub.expiresAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : 'N/A';

            return (
              <Card
                key={sub.id}
                className="bg-zinc-800 border-zinc-700 hover:border-violet-600/40 transition-colors"
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-zinc-100">
                    <span className="truncate text-base">
                      {sub.universeName || sub.universeAddress}
                    </span>
                    {TIER_ICONS[tier]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Tier badge */}
                  <div className="flex items-center gap-2">
                    <Badge className={TIER_COLORS[tier] || TIER_COLORS.BASIC}>{tier}</Badge>
                    <Badge
                      variant={isActive ? 'default' : 'destructive'}
                      className={
                        isActive
                          ? 'bg-emerald-600/80 text-emerald-100 border-transparent'
                          : undefined
                      }
                    >
                      {isActive ? 'Active' : 'Expired'}
                    </Badge>
                  </div>

                  {/* Expiry */}
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {isActive ? 'Renews' : 'Expired'} {expiryDate}
                    </span>
                  </div>

                  {/* Cancel button */}
                  {isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-zinc-600 text-zinc-300 hover:bg-red-900/30 hover:border-red-700 hover:text-red-300"
                      disabled={cancelMutation.isPending}
                      onClick={() =>
                        handleCancel(
                          sub.universeAddress || sub.id,
                          sub.universeName || sub.universeAddress
                        )
                      }
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4 mr-2" />
                      )}
                      Cancel Subscription
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
