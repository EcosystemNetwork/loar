import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePoolHistory } from '@/hooks/useTreasury';
import { ArrowDownCircle, ArrowUpCircle, Users, Banknote, Loader2 } from 'lucide-react';

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof ArrowDownCircle }> =
  {
    fund: {
      label: 'Fund',
      color: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
      icon: ArrowDownCircle,
    },
    spend: {
      label: 'Spend',
      color: 'bg-rose-900/50 text-rose-300 border-rose-700',
      icon: ArrowUpCircle,
    },
    allocate: {
      label: 'Allocate',
      color: 'bg-blue-900/50 text-blue-300 border-blue-700',
      icon: Users,
    },
    revenue_deposit: {
      label: 'Revenue',
      color: 'bg-amber-900/50 text-amber-300 border-amber-700',
      icon: Banknote,
    },
  };

export function TreasuryHistoryTable({ universeId }: { universeId: string }) {
  const { data: history, isLoading } = usePoolHistory(universeId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl p-12 text-center">
        <p className="text-zinc-400 text-lg">No transactions yet</p>
        <p className="text-zinc-500 mt-2">Fund the pool to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((tx: any) => {
        const config = TYPE_CONFIG[tx.type] || TYPE_CONFIG.fund;
        const Icon = config.icon;
        const credits = Math.abs(tx.credits || 0);
        const isNegative = tx.type === 'spend' || tx.type === 'allocate';
        const date =
          tx.createdAt?.toDate?.() ??
          (tx.createdAt?._seconds ? new Date(tx.createdAt._seconds * 1000) : new Date());

        return (
          <Card
            key={tx.id}
            className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${config.color.split(' ')[0]}`}>
                    <Icon className={`h-4 w-4 ${config.color.split(' ')[1]}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-xs ${config.color}`}>
                        {config.label}
                      </Badge>
                      {tx.packageName && (
                        <span className="text-xs text-zinc-500">{tx.packageName}</span>
                      )}
                      {tx.source && <span className="text-xs text-zinc-500">{tx.source}</span>}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {date.toLocaleDateString()}{' '}
                      {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {tx.allocatedToUid && (
                        <span className="ml-2">
                          to {tx.allocatedToUid.slice(0, 6)}...{tx.allocatedToUid.slice(-4)}
                        </span>
                      )}
                      {tx.reason && <span className="ml-2 text-zinc-600">- {tx.reason}</span>}
                    </div>
                  </div>
                </div>
                <div
                  className={`text-lg font-bold ${isNegative ? 'text-rose-400' : 'text-emerald-400'}`}
                >
                  {isNegative ? '-' : '+'}
                  {credits.toLocaleString()}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
