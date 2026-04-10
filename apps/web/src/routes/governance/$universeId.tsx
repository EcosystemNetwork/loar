import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { useUniverseGovernor } from '../../hooks/useUniverseGovernor';
import { trpc } from '../../utils/trpc';
import { ProposalList } from '../../components/governance/ProposalList';
import { ProposalCreateDialog } from '../../components/governance/ProposalCreateDialog';
import { VotingPowerCard } from '../../components/governance/VotingPowerCard';
import { DelegationPanel } from '../../components/governance/DelegationPanel';
import { TokenGateManager } from '../../components/governance/TokenGateManager';
import { TokenGateGuard } from '../../components/governance/TokenGateGuard';

export const Route = createFileRoute('/governance/$universeId')({
  component: GovernancePage,
});

function GovernancePage() {
  const { universeId } = Route.useParams();
  const { address } = useAccount();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [stateFilter, setStateFilter] = useState<string | undefined>(undefined);

  const { data: universeData } = useQuery(trpc.universes.get.queryOptions({ id: universeId }));
  const creatorAddress = (universeData?.data as any)?.creator as string | undefined;

  const validStates = [
    'Pending',
    'Active',
    'Canceled',
    'Defeated',
    'Succeeded',
    'Queued',
    'Expired',
    'Executed',
  ] as const;
  type ProposalState = (typeof validStates)[number];
  const mappedState =
    stateFilter && validStates.includes(stateFilter as ProposalState)
      ? (stateFilter as ProposalState)
      : undefined;

  const {
    data: proposals,
    isLoading,
    isError,
    error,
  } = useQuery(
    trpc.governance.listProposals.queryOptions({
      universeId,
      state: mappedState,
      limit: 20,
    })
  );

  const filters = ['All', 'Active', 'Pending', 'Succeeded', 'Defeated', 'Executed'] as const;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Governance</h1>
            <p className="text-zinc-400 mt-1">
              Propose and vote on changes to Universe #{universeId}
            </p>
          </div>
          {address && (
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg font-medium transition-colors"
            >
              New Proposal
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <TokenGateGuard universeId={universeId} target="governance">
            <div className="lg:col-span-2 space-y-6">
              {/* Filter tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2">
                {filters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setStateFilter(filter === 'All' ? undefined : filter)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      (filter === 'All' && !stateFilter) || stateFilter === filter
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              {/* Proposals */}
              {isError ? (
                <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
                  <p className="text-red-400">{error?.message || 'Failed to load proposals'}</p>
                </div>
              ) : isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-zinc-900 rounded-xl p-6 animate-pulse">
                      <div className="h-5 bg-zinc-800 rounded w-3/4 mb-3" />
                      <div className="h-4 bg-zinc-800 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ) : proposals?.proposals.length === 0 ? (
                <div className="bg-zinc-900 rounded-xl p-12 text-center">
                  <p className="text-zinc-400 text-lg">No proposals yet</p>
                  <p className="text-zinc-500 mt-2">Be the first to create a governance proposal</p>
                </div>
              ) : (
                <ProposalList
                  proposals={(proposals?.proposals || []) as any}
                  universeId={universeId}
                />
              )}
            </div>
          </TokenGateGuard>

          {/* Sidebar */}
          <div className="space-y-6">
            <VotingPowerCard universeId={universeId} />
            <DelegationPanel universeId={universeId} />
            <TokenGateManager universeId={universeId} creatorAddress={creatorAddress} />
          </div>
        </div>
      </div>

      {showCreateDialog && (
        <ProposalCreateDialog universeId={universeId} onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  );
}
