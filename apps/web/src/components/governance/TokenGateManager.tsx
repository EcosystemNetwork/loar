/**
 * TokenGateManager — Rules table for configuring per-variable token gates.
 * Universe creators can set different ownership thresholds for each access type.
 */
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';
import { useTokenGateRules, type GateTarget, type GateRule } from '../../hooks/useTokenGate';

interface TokenGateManagerProps {
  universeId: string;
  creatorAddress?: string;
}

const ALL_TARGETS: { value: GateTarget; label: string; description: string }[] = [
  { value: 'view', label: 'View Content', description: 'View timeline & media' },
  { value: 'create', label: 'Create Nodes', description: 'Add new narrative nodes' },
  { value: 'canon', label: 'Canon Marketplace', description: 'Submit & vote on canon' },
  { value: 'wiki', label: 'Wiki & Lore', description: 'Access universe wiki' },
  { value: 'governance', label: 'Governance', description: 'Vote on proposals' },
  { value: 'play', label: 'Player', description: 'Use branching player' },
];

interface RuleState {
  enabled: boolean;
  minPercentage: number;
  label: string;
}

export function TokenGateManager({ universeId, creatorAddress }: TokenGateManagerProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { tokenAddress } = useUniverseAddresses(universeId);
  const { rules, isLoading } = useTokenGateRules(universeId);

  const isCreator =
    address && creatorAddress && address.toLowerCase() === creatorAddress.toLowerCase();

  // Local state: one entry per target
  const [ruleStates, setRuleStates] = useState<Record<GateTarget, RuleState>>(
    () =>
      Object.fromEntries(
        ALL_TARGETS.map((t) => [t.value, { enabled: false, minPercentage: 1, label: '' }])
      ) as Record<GateTarget, RuleState>
  );

  // Sync server rules into local state
  useEffect(() => {
    if (rules.length === 0) return;
    setRuleStates((prev) => {
      const next = { ...prev };
      for (const rule of rules) {
        next[rule.target] = {
          enabled: rule.enabled,
          minPercentage: rule.minPercentage,
          label: rule.label ?? '',
        };
      }
      return next;
    });
  }, [rules]);

  const bulkUpsert = useMutation(
    trpc.tokenGates.bulkUpsert.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [['tokenGates']] });
      },
    })
  );

  const removeGate = useMutation(
    trpc.tokenGates.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [['tokenGates']] });
      },
    })
  );

  if (!isCreator) return null;
  if (!tokenAddress) {
    return (
      <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
        <h3 className="font-semibold text-white mb-2">Token Gates</h3>
        <p className="text-zinc-500 text-sm">
          Deploy a governance token first to enable token gating.
        </p>
      </div>
    );
  }

  const updateRule = (target: GateTarget, patch: Partial<RuleState>) => {
    setRuleStates((prev) => ({
      ...prev,
      [target]: { ...prev[target], ...patch },
    }));
  };

  const handleSaveAll = () => {
    const enabledRules = ALL_TARGETS.filter((t) => ruleStates[t.value].enabled).map((t) => ({
      target: t.value,
      minPercentage: ruleStates[t.value].minPercentage,
      enabled: true,
      label: ruleStates[t.value].label || undefined,
    }));

    // Upsert enabled rules
    if (enabledRules.length > 0) {
      bulkUpsert.mutate({
        universeId,
        tokenAddress: tokenAddress!,
        rules: enabledRules,
      });
    }

    // Remove disabled rules that previously existed
    const existingTargets = new Set(rules.filter((r) => r.enabled).map((r) => r.target));
    for (const t of ALL_TARGETS) {
      if (!ruleStates[t.value].enabled && existingTargets.has(t.value)) {
        removeGate.mutate({ universeId, target: t.value });
      }
    }
  };

  const enabledCount = ALL_TARGETS.filter((t) => ruleStates[t.value].enabled).length;

  return (
    <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Token Gate Rules</h3>
        {enabledCount > 0 && (
          <span className="text-xs bg-violet-600/20 text-violet-400 px-2 py-0.5 rounded-full">
            {enabledCount} active
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-zinc-800 rounded" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {ALL_TARGETS.map((t) => {
            const state = ruleStates[t.value];
            return (
              <div
                key={t.value}
                className={`rounded-lg border p-3 transition-colors ${
                  state.enabled
                    ? 'border-violet-600/40 bg-violet-950/20'
                    : 'border-zinc-800 bg-zinc-800/30'
                }`}
              >
                {/* Header row: toggle + label */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(e) => updateRule(t.value, { enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white font-medium">{t.label}</span>
                    <span className="text-xs text-zinc-500 ml-2 hidden sm:inline">
                      {t.description}
                    </span>
                  </div>
                  {state.enabled && (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={state.minPercentage}
                        onChange={(e) =>
                          updateRule(t.value, {
                            minPercentage: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-16 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-white text-xs text-right font-mono focus:border-violet-500 focus:outline-none"
                      />
                      <span className="text-xs text-zinc-400">%</span>
                    </div>
                  )}
                </div>

                {/* Expanded: optional label */}
                {state.enabled && (
                  <div className="mt-2 pl-7">
                    <input
                      type="text"
                      value={state.label}
                      onChange={(e) => updateRule(t.value, { label: e.target.value })}
                      placeholder="Custom label (optional)"
                      className="w-full px-2 py-1 bg-zinc-800/50 border border-zinc-700/50 rounded text-zinc-300 text-xs placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Save button */}
          <button
            onClick={handleSaveAll}
            disabled={bulkUpsert.isPending}
            className="w-full mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {bulkUpsert.isPending ? 'Saving...' : 'Save Rules'}
          </button>

          {bulkUpsert.isSuccess && (
            <p className="text-green-400 text-xs text-center">Rules saved</p>
          )}
          {bulkUpsert.isError && (
            <p className="text-red-400 text-xs text-center">
              {bulkUpsert.error?.message ?? 'Failed to save'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
