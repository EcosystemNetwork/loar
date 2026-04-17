/**
 * PollResults — Detailed results view for a single poll.
 *
 * Shows animated horizontal bar chart per option, vote counts/percentages,
 * winner highlight for ended polls, and "Promote to Canon" for creators.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trophy, Crown, Loader2, Sparkles } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { trpc, queryClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';

interface PollResultsProps {
  pollId: string;
}

export function PollResults({ pollId }: PollResultsProps) {
  const { address } = useWalletAuth();

  const { data: poll, isLoading } = useQuery(trpc.polls.get.queryOptions({ pollId }));

  const promoteMutation = useMutation(
    trpc.polls.promoteToCanon.mutationOptions({
      onSuccess: () => {
        toast.success('Option promoted to canon!');
        queryClient.invalidateQueries({ queryKey: [['polls']] });
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to promote to canon');
      },
    })
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (!poll) {
    return <div className="text-center py-12 text-zinc-500">Poll not found</div>;
  }

  const isEnded = poll.status === 'ended' || new Date(poll.endsAt).getTime() <= Date.now();
  const isCreator = address && poll.creatorUid === address.toLowerCase();

  // Sort options by vote count descending
  const sortedOptions = [...poll.options].sort((a, b) => b.voteCount - a.voteCount);
  const winningOption = isEnded && sortedOptions.length > 0 ? sortedOptions[0] : null;
  const maxVotes = sortedOptions[0]?.voteCount ?? 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-white">{poll.title}</h3>
        {poll.description && <p className="text-sm text-zinc-400">{poll.description}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Badge className="bg-zinc-700/50 text-zinc-300 border-0 text-xs">
            {poll.totalVotes} total vote{poll.totalVotes !== 1 ? 's' : ''}
          </Badge>
          {isEnded && (
            <Badge className="bg-amber-500/20 text-amber-400 border-0 text-xs">Final Results</Badge>
          )}
        </div>
      </div>

      {/* Results bars */}
      <div className="space-y-3">
        {sortedOptions.map((option, index) => {
          const percentage =
            poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
          const isWinner = winningOption?.id === option.id;
          const barWidth = maxVotes > 0 ? (option.voteCount / maxVotes) * 100 : 0;

          return (
            <div key={option.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {isWinner && <Trophy className="w-4 h-4 text-amber-400 shrink-0" />}
                  {index === 0 && !isEnded && (
                    <Crown className="w-4 h-4 text-violet-400 shrink-0" />
                  )}
                  <span
                    className={`truncate ${
                      isWinner ? 'text-amber-300 font-medium' : 'text-zinc-300'
                    }`}
                  >
                    {option.text}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-zinc-500 text-xs">
                    {option.voteCount} vote{option.voteCount !== 1 ? 's' : ''}
                  </span>
                  <span
                    className={`font-medium w-12 text-right ${
                      isWinner ? 'text-amber-400' : 'text-zinc-300'
                    }`}
                  >
                    {percentage}%
                  </span>
                </div>
              </div>

              {/* Animated bar */}
              <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    isWinner
                      ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                      : 'bg-gradient-to-r from-violet-600 to-violet-500'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Promote to Canon */}
      {isEnded && isCreator && winningOption && (
        <div className="pt-2 border-t border-zinc-800">
          <Button
            onClick={() =>
              promoteMutation.mutate({
                pollId: poll.id,
                optionId: winningOption.id,
              })
            }
            disabled={promoteMutation.isPending}
            className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
          >
            {promoteMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Promote "{winningOption.text}" to Canon
          </Button>
        </div>
      )}
    </div>
  );
}
