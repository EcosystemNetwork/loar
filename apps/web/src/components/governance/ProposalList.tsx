import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useUniverseGovernor } from '../../hooks/useUniverseGovernor';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';
import { toast } from 'sonner';

interface Proposal {
  id: string;
  proposalId: string;
  universeId: string;
  description: string;
  proposer: string;
  state: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  startBlock: number;
  endBlock: number;
}

const STATE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-900/30 text-yellow-400',
  Active: 'bg-blue-900/30 text-blue-400',
  Succeeded: 'bg-green-900/30 text-green-400',
  Defeated: 'bg-red-900/30 text-red-400',
  Executed: 'bg-violet-900/30 text-violet-400',
  Canceled: 'bg-zinc-800 text-zinc-400',
  Expired: 'bg-zinc-800 text-zinc-500',
  Queued: 'bg-orange-900/30 text-orange-400',
};

export function ProposalList({
  proposals,
  universeId,
}: {
  proposals: Proposal[];
  universeId: string;
}) {
  const { governorAddress } = useUniverseAddresses(universeId);

  return (
    <div className="space-y-3">
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          universeId={universeId}
          governorAddress={governorAddress}
        />
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  universeId,
  governorAddress,
}: {
  proposal: Proposal;
  universeId: string;
  governorAddress: `0x${string}` | undefined;
}) {
  const { address } = useAccount();
  const { castVote } = useUniverseGovernor(governorAddress);
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);

  const forVotes = BigInt(proposal.forVotes || '0');
  const againstVotes = BigInt(proposal.againstVotes || '0');
  const totalVotes = forVotes + againstVotes;
  const forPercent = totalVotes > 0n ? Number((forVotes * 100n) / totalVotes) : 0;

  const isActive = proposal.state === 'Active';
  const canVote = isActive && !!address && !!governorAddress && !voted;

  async function handleVote(support: 0 | 1 | 2) {
    if (!canVote || !castVote) return;
    setVoting(true);
    try {
      await castVote({ proposalId: BigInt(proposal.proposalId), support });
      setVoted(true);
      toast.success(support === 1 ? 'Voted For' : support === 0 ? 'Voted Against' : 'Abstained');
    } catch (err: any) {
      if (!err?.message?.includes('rejected')) {
        toast.error(err?.message ?? 'Vote failed');
      }
    } finally {
      setVoting(false);
    }
  }

  return (
    <div
      id={`proposal-${proposal.proposalId}`}
      className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 hover:border-zinc-700 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate">
            {proposal.description.split('\n')[0] || `Proposal #${proposal.proposalId.slice(0, 8)}`}
          </h3>
          <p className="text-sm text-zinc-500 mt-1">
            by {proposal.proposer.slice(0, 6)}...{proposal.proposer.slice(-4)}
          </p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            STATE_COLORS[proposal.state] || 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {proposal.state}
        </span>
      </div>

      {/* Vote bar */}
      {totalVotes > 0n && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-zinc-400 mb-1">
            <span>For {forPercent}%</span>
            <span>Against {100 - forPercent}%</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${forPercent}%` }} />
          </div>
        </div>
      )}

      {/* Vote actions — only for Active proposals */}
      {isActive && address && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => handleVote(1)}
            disabled={!canVote || voting}
            className="flex-1 px-3 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-600/30 text-green-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {voting ? '...' : 'For'}
          </button>
          <button
            onClick={() => handleVote(0)}
            disabled={!canVote || voting}
            className="flex-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 text-red-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {voting ? '...' : 'Against'}
          </button>
          <button
            onClick={() => handleVote(2)}
            disabled={!canVote || voting}
            className="flex-1 px-3 py-2 bg-zinc-700/50 hover:bg-zinc-700/70 border border-zinc-600/30 text-zinc-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {voting ? '...' : 'Abstain'}
          </button>
        </div>
      )}

      {voted && <p className="text-xs text-green-400 mt-2">Vote submitted on-chain</p>}
    </div>
  );
}
