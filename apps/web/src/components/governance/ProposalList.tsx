import { Link } from '@tanstack/react-router';

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
  return (
    <div className="space-y-3">
      {proposals.map((proposal) => {
        const forVotes = BigInt(proposal.forVotes || '0');
        const againstVotes = BigInt(proposal.againstVotes || '0');
        const totalVotes = forVotes + againstVotes;
        const forPercent = totalVotes > 0n ? Number((forVotes * 100n) / totalVotes) : 0;

        return (
          <Link
            key={proposal.id}
            to="/governance/$universeId"
            params={{ universeId }}
            hash={`proposal-${proposal.proposalId}`}
            className="block bg-zinc-900 rounded-xl p-5 hover:bg-zinc-900/80 transition-colors border border-zinc-800 hover:border-zinc-700"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate">
                  {proposal.description.split('\n')[0] ||
                    `Proposal #${proposal.proposalId.slice(0, 8)}`}
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
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${forPercent}%` }}
                  />
                </div>
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
