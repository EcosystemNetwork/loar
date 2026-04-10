import { Card, CardContent } from '@/components/ui/card';
import { Coins, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { usePoolBalance } from '@/hooks/useTreasury';

export function TreasuryBalanceCard({ universeId }: { universeId: string }) {
  const { data, isLoading } = usePoolBalance(universeId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-zinc-900 border-zinc-800 animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-zinc-800 rounded w-1/2 mb-3" />
              <div className="h-8 bg-zinc-800 rounded w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const metrics = [
    {
      label: 'Pool Balance',
      value: (data?.balance ?? 0).toLocaleString(),
      icon: Wallet,
      gradient: 'from-emerald-600/20 to-emerald-800/10',
      border: 'border-emerald-800',
      iconColor: 'text-emerald-400',
      valueColor: 'text-emerald-300',
    },
    {
      label: 'Total Purchased',
      value: (data?.totalPurchased ?? 0).toLocaleString(),
      icon: TrendingUp,
      gradient: 'from-blue-600/20 to-blue-800/10',
      border: 'border-blue-800',
      iconColor: 'text-blue-400',
      valueColor: 'text-blue-300',
    },
    {
      label: 'Total Spent',
      value: (data?.totalSpent ?? 0).toLocaleString(),
      icon: TrendingDown,
      gradient: 'from-rose-600/20 to-rose-800/10',
      border: 'border-rose-800',
      iconColor: 'text-rose-400',
      valueColor: 'text-rose-300',
    },
    {
      label: 'Utilization',
      value:
        data?.totalPurchased && data.totalPurchased > 0
          ? `${Math.round((data.totalSpent / data.totalPurchased) * 100)}%`
          : '0%',
      icon: Coins,
      gradient: 'from-amber-600/20 to-amber-800/10',
      border: 'border-amber-800',
      iconColor: 'text-amber-400',
      valueColor: 'text-amber-300',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((m) => (
        <Card
          key={m.label}
          className={`bg-gradient-to-br ${m.gradient} ${m.border} hover:shadow-lg transition-shadow`}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <m.icon className={`h-4 w-4 ${m.iconColor}`} />
              <span className="text-xs font-medium text-zinc-400">{m.label}</span>
            </div>
            <div className={`text-2xl font-bold ${m.valueColor}`}>{m.value}</div>
            <div className="text-xs text-zinc-500 mt-1">credits</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
