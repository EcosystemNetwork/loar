/**
 * Credits — full-page credit balance, purchase, and history.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Zap, TrendingUp, TrendingDown, Gift, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { CreditStore } from '@/components/CreditStore';
import { useCreditBalance, useCreditHistory } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';

export const Route = createFileRoute('/credits')({
  component: CreditsPage,
});

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  purchase: {
    label: 'Purchase',
    icon: <Coins className="w-3.5 h-3.5" />,
    color: 'text-green-400',
  },
  spend: {
    label: 'Spent',
    icon: <TrendingDown className="w-3.5 h-3.5" />,
    color: 'text-red-400',
  },
  grant: {
    label: 'Grant',
    icon: <Gift className="w-3.5 h-3.5" />,
    color: 'text-amber-400',
  },
};

function CreditsPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useWalletAuth();
  const [showStore, setShowStore] = useState(false);

  const { data: balance, isLoading: balanceLoading } = useCreditBalance();
  const { data: txHistory, isLoading: historyLoading } = useCreditHistory(30);
  const { data: costs } = useQuery({
    queryKey: ['generation-costs'],
    queryFn: () => trpcClient.credits.getCosts.query(),
  });

  const credits = balance?.balance ?? 0;
  const isLow = credits < 10;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate({ to: '/dashboard' })}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-bold flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          Credits
        </h1>
        {!showStore && (
          <Button size="sm" className="ml-auto" onClick={() => setShowStore(true)}>
            Buy Credits
          </Button>
        )}
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 space-y-5">
        {showStore ? (
          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-6">
              <CreditStore onClose={() => setShowStore(false)} />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Balance card */}
            <Card className={isLow ? 'border-red-700/50' : undefined}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                      Available Credits
                    </p>
                    {balanceLoading ? (
                      <div className="h-10 w-24 bg-muted animate-pulse rounded" />
                    ) : (
                      <p
                        className={`text-4xl font-bold ${isLow ? 'text-red-400' : 'text-amber-400'}`}
                      >
                        {credits.toLocaleString()}
                      </p>
                    )}
                    {isLow && (
                      <p className="text-xs text-red-400 mt-1">
                        Running low — top up to keep creating
                      </p>
                    )}
                  </div>
                  <div className="text-right space-y-1 text-xs text-muted-foreground">
                    {balance && (
                      <>
                        <p>
                          Purchased:{' '}
                          <span className="text-foreground">
                            {balance.totalPurchased?.toLocaleString() ?? 0}
                          </span>
                        </p>
                        <p>
                          Spent:{' '}
                          <span className="text-foreground">
                            {balance.totalSpent?.toLocaleString() ?? 0}
                          </span>
                        </p>
                        {(balance.totalBonusReceived ?? 0) > 0 && (
                          <p>
                            Bonus:{' '}
                            <span className="text-amber-400">
                              {balance.totalBonusReceived?.toLocaleString()}
                            </span>
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Generation costs reference */}
            {costs && (
              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm">Generation Costs</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(costs).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between bg-muted/40 rounded-md px-3 py-2"
                      >
                        <span className="text-xs text-muted-foreground capitalize">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <Badge variant="outline" className="text-xs ml-2 shrink-0">
                          {value as number} cr
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Transaction history */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Transaction History
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                {!isAuthenticated ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Connect your wallet to view history
                  </p>
                ) : historyLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                ) : !txHistory || txHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No transactions yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(txHistory as any[]).map((tx) => {
                      const meta = TYPE_META[tx.type] ?? TYPE_META.spend;
                      const isPositive = tx.type !== 'spend';
                      const totalCredits = (tx.credits ?? 0) + (tx.bonusCredits ?? 0);
                      return (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between py-2 border-b border-border/40 last:border-0"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={meta.color}>{meta.icon}</span>
                            <div>
                              <p className="text-sm font-medium">
                                {meta.label}
                                {tx.paymentMethod && (
                                  <span className="text-xs text-muted-foreground ml-1.5">
                                    via {tx.paymentMethod}
                                  </span>
                                )}
                              </p>
                              {tx.reason && (
                                <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                  {tx.reason}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p
                              className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}
                            >
                              {isPositive ? '+' : '-'}
                              {totalCredits.toLocaleString()} cr
                            </p>
                            {tx.createdAt && (
                              <p className="text-[10px] text-muted-foreground">
                                {new Date(tx.createdAt).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
