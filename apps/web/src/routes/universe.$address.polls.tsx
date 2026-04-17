/**
 * Universe Polls Route
 *
 * Shows all polls for a universe — active polls first, ended polls below.
 * Authenticated universe creators can create new polls via a dialog.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { trpc } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { PollCard } from '@/components/polls/PollCard';
import { PollResults } from '@/components/polls/PollResults';
import { CreatePollDialog } from '@/components/polls/CreatePollDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, BarChart3, Loader2, Vote } from 'lucide-react';

export const Route = createFileRoute('/universe/$address/polls')({
  component: UniversePollsPage,
});

function UniversePollsPage() {
  const { address: universeAddress } = useParams({
    from: '/universe/$address/polls',
  });
  const { isAuthenticated, address: userAddress } = useWalletAuth();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);

  const {
    data: polls,
    isLoading,
    error,
  } = useQuery(
    trpc.polls.list.queryOptions({ universeAddress }, { enabled: Boolean(universeAddress) })
  );

  // Check if current user is the universe creator (for the Create Poll button).
  // The polls.list response may include a `isCreator` flag, or we check locally.
  const { data: universeData } = useQuery(
    trpc.polls.universeCreator.queryOptions(
      { universeAddress },
      { enabled: Boolean(universeAddress) && isAuthenticated }
    )
  );

  const isUniverseCreator = universeData?.isCreator ?? false;

  const activePolls = (polls ?? []).filter(
    (p) => p.status === 'active' && new Date(p.endsAt).getTime() > Date.now()
  );
  const endedPolls = (polls ?? []).filter(
    (p) => p.status === 'ended' || new Date(p.endsAt).getTime() <= Date.now()
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Vote className="w-7 h-7 text-violet-400" />
              <h1 className="text-2xl font-bold">Community Polls</h1>
            </div>
            <p className="text-zinc-400 text-sm">
              Shape the narrative. Vote on what happens next in this universe.
            </p>
          </div>

          {isAuthenticated && isUniverseCreator && (
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Poll
            </Button>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
            Failed to load polls. Please try again later.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && (polls ?? []).length === 0 && (
          <div className="text-center py-20 space-y-3">
            <BarChart3 className="w-12 h-12 text-zinc-600 mx-auto" />
            <h2 className="text-lg font-medium text-zinc-400">No polls yet</h2>
            <p className="text-sm text-zinc-500 max-w-md mx-auto">
              {isUniverseCreator
                ? 'Create the first poll to let your community shape the story.'
                : "The universe creator hasn't created any polls yet. Check back later!"}
            </p>
          </div>
        )}

        {/* Active Polls */}
        {activePolls.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Active</h2>
              <Badge className="bg-green-500/20 text-green-400 border-0 text-xs">
                {activePolls.length}
              </Badge>
            </div>
            <div className="grid gap-4">
              {activePolls.map((poll) => (
                <div key={poll.id}>
                  <PollCard
                    poll={poll}
                    universeAddress={universeAddress}
                    onVote={() => setExpandedPollId(poll.id)}
                  />
                  {expandedPollId === poll.id && (
                    <div className="mt-2">
                      <PollResults pollId={poll.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Ended Polls */}
        {endedPolls.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-400">Ended</h2>
              <Badge className="bg-zinc-700/50 text-zinc-500 border-0 text-xs">
                {endedPolls.length}
              </Badge>
            </div>
            <div className="grid gap-4">
              {endedPolls.map((poll) => (
                <div key={poll.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedPollId(expandedPollId === poll.id ? null : poll.id)}
                    className="w-full text-left"
                  >
                    <PollCard poll={poll} universeAddress={universeAddress} />
                  </button>
                  {expandedPollId === poll.id && (
                    <div className="mt-2">
                      <PollResults pollId={poll.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Create Poll Dialog */}
      <CreatePollDialog
        universeAddress={universeAddress}
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}
