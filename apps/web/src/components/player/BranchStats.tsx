import { useQuery } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';

export function BranchStats({ universeId, nodeId }: { universeId: string; nodeId: number }) {
  const { data } = useQuery(trpc.player.getBranchAnalytics.queryOptions({ universeId, nodeId }));

  const distribution = (
    'choiceDistribution' in (data ?? {}) ? (data as any).choiceDistribution : {}
  ) as Record<string, number>;
  const totalPlays = ('totalPlays' in (data ?? {}) ? (data as any).totalPlays : 0) as number;

  if (totalPlays === 0) return null;

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
      <div className="bg-zinc-900/90 backdrop-blur-md rounded-2xl p-6 max-w-sm w-full mx-4">
        <h3 className="text-white font-semibold mb-4 text-center">What others chose</h3>
        <div className="space-y-3">
          {Object.entries(distribution).map(([choiceNodeId, count]) => {
            const pct = totalPlays > 0 ? Math.round((count / totalPlays) * 100) : 0;
            return (
              <div key={choiceNodeId}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-300">Path #{choiceNodeId}</span>
                  <span className="text-zinc-400">{pct}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-zinc-500 text-xs text-center mt-4">
          Based on {totalPlays.toLocaleString()} plays
        </p>
      </div>
    </div>
  );
}
