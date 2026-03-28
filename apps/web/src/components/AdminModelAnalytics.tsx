/**
 * AdminModelAnalytics — Model cost, margin, and usage analytics panel.
 *
 * Shows per-model costs, 30% margin tracking, $LOAR token economics,
 * and model enable/disable controls. Designed to be embedded in the admin toolbar.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────

interface ModelStat {
  modelId: string;
  modelName: string;
  count: number;
  completed: number;
  failed: number;
  totalProviderCostUsd: number;
  totalUserPriceUsd: number;
  totalMarginUsd: number;
  totalCreditsCharged: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  failureRate: number;
}

interface AnalyticsData {
  period: string;
  totalGenerations: number;
  autoRouted: number;
  manualSelected: number;
  autoPercentage: number;
  financials: {
    totalProviderCostUsd: number;
    totalUserRevenueUsd: number;
    totalMarginUsd: number;
    marginPercentage: number;
    totalCreditsCharged: number;
  };
  modelStats: ModelStat[];
}

interface AdminModel {
  id: string;
  displayName: string;
  provider: string;
  qualityTier: string;
  speedTier: string;
  priceTier: string;
  providerCostUsd: number;
  userPriceUsd: number;
  creditCost: number;
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  hasOverride: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pctColor(pct: number): string {
  if (pct >= 30) return 'text-green-400';
  if (pct >= 20) return 'text-yellow-400';
  return 'text-red-400';
}

// ── Main Component ────────────────────────────────────────────────────

export function AdminModelAnalytics() {
  const [days, setDays] = useState(7);
  const [showModels, setShowModels] = useState(false);
  const queryClient = useQueryClient();

  // Fetch analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['adminAnalytics', days],
    queryFn: () => trpcClient.generation.adminAnalytics.query({ days }),
    refetchInterval: 30000, // refresh every 30s
  });

  // Fetch all models for admin control
  const { data: models } = useQuery({
    queryKey: ['adminModels'],
    queryFn: () => trpcClient.generation.adminListModels.query(),
    enabled: showModels,
  });

  // Model toggle mutation
  const toggleModelMutation = useMutation({
    mutationFn: (params: { modelId: string; isEnabled?: boolean; isVisibleToUsers?: boolean }) =>
      trpcClient.generation.adminUpdateModel.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminModels'] });
      toast.success('Model updated');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update model');
    },
  });

  const a = analytics as AnalyticsData | undefined;

  return (
    <div className="space-y-3 text-xs">
      {/* Period Selector */}
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">Period:</span>
        {[1, 7, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2 py-0.5 rounded text-[10px] ${
              days === d ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {analyticsLoading ? (
        <div className="text-zinc-500 py-2">Loading analytics...</div>
      ) : a ? (
        <>
          {/* Financial Summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-900 rounded p-2">
              <div className="text-zinc-500">Provider Cost</div>
              <div className="text-red-400 font-mono font-bold">
                {formatUsd(a.financials.totalProviderCostUsd)}
              </div>
            </div>
            <div className="bg-zinc-900 rounded p-2">
              <div className="text-zinc-500">User Revenue</div>
              <div className="text-green-400 font-mono font-bold">
                {formatUsd(a.financials.totalUserRevenueUsd)}
              </div>
            </div>
            <div className="bg-zinc-900 rounded p-2">
              <div className="text-zinc-500">Gross Margin</div>
              <div className={`font-mono font-bold ${pctColor(a.financials.marginPercentage)}`}>
                {formatUsd(a.financials.totalMarginUsd)} ({a.financials.marginPercentage}%)
              </div>
            </div>
            <div className="bg-zinc-900 rounded p-2">
              <div className="text-zinc-500">$LOAR Charged</div>
              <div className="text-amber-400 font-mono font-bold">
                {a.financials.totalCreditsCharged.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Generation Stats */}
          <div className="flex items-center gap-4 text-zinc-400">
            <span>
              Total: <span className="text-white font-bold">{a.totalGenerations}</span>
            </span>
            <span>
              Auto: <span className="text-blue-400">{a.autoPercentage}%</span>
            </span>
            <span>
              Manual: <span className="text-purple-400">{100 - a.autoPercentage}%</span>
            </span>
          </div>

          {/* Per-Model Breakdown */}
          {a.modelStats.length > 0 && (
            <div className="space-y-1">
              <div className="text-zinc-500 font-medium">By Model</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      <th className="text-left py-1 pr-2">Model</th>
                      <th className="text-right px-1">Count</th>
                      <th className="text-right px-1">Fail%</th>
                      <th className="text-right px-1">Cost</th>
                      <th className="text-right px-1">Revenue</th>
                      <th className="text-right px-1">Margin</th>
                      <th className="text-right px-1">$LOAR</th>
                      <th className="text-right pl-1">Avg ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.modelStats.map((s) => (
                      <tr
                        key={s.modelId}
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                      >
                        <td className="py-1 pr-2 text-white">{s.modelName}</td>
                        <td className="text-right px-1">{s.count}</td>
                        <td
                          className={`text-right px-1 ${s.failureRate > 10 ? 'text-red-400' : 'text-zinc-400'}`}
                        >
                          {s.failureRate}%
                        </td>
                        <td className="text-right px-1 text-red-400">
                          {formatUsd(s.totalProviderCostUsd)}
                        </td>
                        <td className="text-right px-1 text-green-400">
                          {formatUsd(s.totalUserPriceUsd)}
                        </td>
                        <td className="text-right px-1 text-amber-400">
                          {formatUsd(s.totalMarginUsd)}
                        </td>
                        <td className="text-right px-1 text-amber-400">{s.totalCreditsCharged}</td>
                        <td className="text-right pl-1 text-zinc-400">{s.avgLatencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-zinc-500">No generation data yet</div>
      )}

      {/* Model Controls Toggle */}
      <button
        onClick={() => setShowModels(!showModels)}
        className="flex items-center gap-1 text-zinc-400 hover:text-zinc-300 text-[10px] uppercase tracking-wider"
      >
        <svg
          className={`w-3 h-3 transition-transform ${showModels ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Model Controls
      </button>

      {/* Model Enable/Disable Controls */}
      {showModels && models && (
        <div className="space-y-1">
          {(models as AdminModel[]).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between bg-zinc-900 rounded px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${m.isEnabled ? 'bg-green-500' : 'bg-red-500'}`}
                />
                <span className="text-white text-[11px]">{m.displayName}</span>
                <span className="text-zinc-500 text-[10px]">
                  {formatUsd(m.providerCostUsd)} {'\u2192'} {formatUsd(m.userPriceUsd)}
                </span>
                <span className="text-amber-400 text-[10px]">{m.creditCost} $LOAR</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    toggleModelMutation.mutate({
                      modelId: m.id,
                      isEnabled: !m.isEnabled,
                    })
                  }
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    m.isEnabled
                      ? 'bg-green-900/50 text-green-400 hover:bg-red-900/50 hover:text-red-400'
                      : 'bg-red-900/50 text-red-400 hover:bg-green-900/50 hover:text-green-400'
                  }`}
                >
                  {m.isEnabled ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() =>
                    toggleModelMutation.mutate({
                      modelId: m.id,
                      isVisibleToUsers: !m.isVisibleToUsers,
                    })
                  }
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    m.isVisibleToUsers
                      ? 'bg-blue-900/50 text-blue-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                  title={m.isVisibleToUsers ? 'Visible to users' : 'Hidden from users'}
                >
                  {m.isVisibleToUsers ? 'VIS' : 'HID'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
