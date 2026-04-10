const SOURCE_COLORS: Record<string, string> = {
  nft_sales: '#8b5cf6',
  subscriptions: '#3b82f6',
  credits: '#10b981',
  licensing: '#f59e0b',
  merch: '#ef4444',
  ads: '#06b6d4',
  canon_royalties: '#ec4899',
  collabs: '#84cc16',
  appearance_fees: '#f97316',
};

import { useVocab } from '@/hooks/use-vocab';

export function RevenueBreakdown({ bySource }: { bySource: Record<string, number> }) {
  const v = useVocab();

  const SOURCE_LABELS: Record<string, string> = {
    nft_sales: v('nft-sales'),
    subscriptions: 'Subscriptions',
    credits: 'Credits',
    licensing: 'IP Licensing',
    merch: 'Merchandise',
    ads: 'Ad Revenue',
    canon_royalties: v('canon-royalties'),
    collabs: 'Collaborations',
    appearance_fees: 'Appearances',
  };
  const entries = Object.entries(bySource).filter(([, v]) => v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <h3 className="font-semibold text-white mb-4">Revenue by Source</h3>
        <p className="text-zinc-500 text-sm">No revenue data yet</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
      <h3 className="font-semibold text-white mb-4">Revenue by Source</h3>

      {/* Horizontal stacked bar */}
      <div className="h-4 rounded-full overflow-hidden flex mb-6">
        {entries.map(([source, amount]) => (
          <div
            key={source}
            style={{
              width: `${(amount / total) * 100}%`,
              backgroundColor: SOURCE_COLORS[source] || '#71717a',
            }}
            className="h-full first:rounded-l-full last:rounded-r-full"
            title={`${SOURCE_LABELS[source] || source}: ${amount.toFixed(4)} ETH`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {entries
          .sort(([, a], [, b]) => b - a)
          .map(([source, amount]) => (
            <div key={source} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: SOURCE_COLORS[source] || '#71717a' }}
                />
                <span className="text-sm text-zinc-300">{SOURCE_LABELS[source] || source}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-400">
                  {total > 0 ? Math.round((amount / total) * 100) : 0}%
                </span>
                <span className="text-sm font-mono text-white">{amount.toFixed(4)} ETH</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
