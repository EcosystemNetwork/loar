/**
 * PollCard — Individual poll display with voting UI.
 *
 * Shows poll title, type badge, option bars with vote percentages,
 * total votes, time remaining, and inline voting controls.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Clock, Trophy, Users, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { trpc, queryClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';

export interface PollOption {
  id: string;
  text: string;
  voteCount: number;
}

export interface Poll {
  id: string;
  title: string;
  description?: string;
  type: string;
  options: PollOption[];
  totalVotes: number;
  endsAt: string;
  status: string;
  userVote?: { optionIds: string[] };
  creatorUid: string;
}

export interface PollCardProps {
  poll: Poll;
  universeAddress: string;
  onVote?: () => void;
}

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  story_direction: { bg: 'bg-violet-500/20', text: 'text-violet-400', label: 'Story Direction' },
  character_fate: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Character Fate' },
  world_event: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'World Event' },
  general: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', label: 'General' },
  canon_submission: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Canon Submission' },
};

function getTypeStyle(type: string) {
  return TYPE_STYLES[type] ?? TYPE_STYLES.general;
}

function formatTimeRemaining(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Ended';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function PollCard({ poll, universeAddress, onVote }: PollCardProps) {
  const { isAuthenticated } = useWalletAuth();
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(formatTimeRemaining(poll.endsAt));

  const isEnded = poll.status === 'ended' || new Date(poll.endsAt).getTime() <= Date.now();
  const hasVoted = Boolean(poll.userVote);
  const canVote = isAuthenticated && !isEnded && !hasVoted;
  const typeStyle = getTypeStyle(poll.type);

  // Find the winning option (highest vote count)
  const winningOption = isEnded
    ? poll.options.reduce(
        (max, opt) => (opt.voteCount > max.voteCount ? opt : max),
        poll.options[0]
      )
    : null;

  // Update countdown timer
  useEffect(() => {
    if (isEnded) return;
    const interval = setInterval(() => {
      setTimeRemaining(formatTimeRemaining(poll.endsAt));
    }, 30_000);
    return () => clearInterval(interval);
  }, [poll.endsAt, isEnded]);

  const voteMutation = useMutation(
    trpc.polls.vote.mutationOptions({
      onSuccess: () => {
        toast.success('Vote recorded!');
        queryClient.invalidateQueries({ queryKey: [['polls']] });
        onVote?.();
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to vote');
      },
    })
  );

  function toggleOption(optionId: string) {
    if (!canVote) return;
    setSelectedOptionIds((prev) =>
      prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
    );
  }

  function handleVote() {
    if (selectedOptionIds.length === 0) {
      toast.error('Select at least one option');
      return;
    }
    voteMutation.mutate({
      pollId: poll.id,
      optionIds: selectedOptionIds,
      universeAddress,
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h3 className="text-lg font-semibold text-white truncate">{poll.title}</h3>
          {poll.description && (
            <p className="text-sm text-zinc-400 line-clamp-2">{poll.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={`${typeStyle.bg} ${typeStyle.text} border-0 text-xs`}>
            {typeStyle.label}
          </Badge>
          {isEnded && (
            <Badge className="bg-zinc-700/50 text-zinc-400 border-0 text-xs">Ended</Badge>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {poll.options.map((option) => {
          const percentage =
            poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
          const isSelected = selectedOptionIds.includes(option.id);
          const isUserVote = poll.userVote?.optionIds.includes(option.id);
          const isWinner = winningOption?.id === option.id && isEnded;

          return (
            <button
              key={option.id}
              type="button"
              disabled={!canVote}
              onClick={() => toggleOption(option.id)}
              className={`
                w-full relative rounded-lg border p-3 text-left transition-all
                ${canVote ? 'cursor-pointer hover:border-violet-500/50' : 'cursor-default'}
                ${isSelected ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-700 bg-zinc-800/50'}
                ${isWinner ? 'border-amber-500/50 bg-amber-500/5' : ''}
                ${isUserVote ? 'border-violet-500/30' : ''}
              `}
            >
              {/* Bar background */}
              <div
                className={`absolute inset-0 rounded-lg transition-all duration-500 ${
                  isWinner ? 'bg-amber-500/10' : 'bg-violet-500/10'
                }`}
                style={{ width: `${percentage}%` }}
              />

              {/* Content */}
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isUserVote && <Check className="w-4 h-4 text-violet-400 shrink-0" />}
                  {isWinner && <Trophy className="w-4 h-4 text-amber-400 shrink-0" />}
                  <span className="text-sm text-white truncate">{option.text}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-zinc-400">{option.voteCount} votes</span>
                  <span className="text-sm font-medium text-zinc-300 w-10 text-right">
                    {percentage}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {timeRemaining}
          </span>
        </div>

        {canVote && selectedOptionIds.length > 0 && (
          <Button
            size="sm"
            onClick={handleVote}
            disabled={voteMutation.isPending}
            className="bg-violet-600 hover:bg-violet-700 text-white text-xs"
          >
            {voteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Vote
          </Button>
        )}
      </div>
    </div>
  );
}
