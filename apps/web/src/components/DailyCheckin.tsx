/**
 * DailyCheckin — Daily streak widget with escalating $LOAR rewards.
 *
 * Dopamine loop: check in every day to keep your streak alive and
 * earn progressively larger $LOAR token rewards. Day 7 pays 150 $LOAR.
 * Missing a day resets the streak to Day 1.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { useState } from 'react';

const DAY_LABELS = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
const DAY_REWARDS = [5, 10, 20, 35, 50, 75, 150];
const DAY_ICONS = ['🌱', '⚡', '🔥', '💥', '🌟', '💎', '👑'];

export function DailyCheckin() {
  const queryClient = useQueryClient();
  const [claimed, setClaimed] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['checkinStatus'],
    queryFn: () => trpcClient.quests.getCheckinStatus.query(),
    refetchOnWindowFocus: true,
  });

  const checkinMutation = useMutation({
    mutationFn: () => trpcClient.quests.dailyCheckin.mutate(),
    onSuccess: (data) => {
      setClaimed(true);
      toast.success(`+${data.reward} $LOAR claimed! Day ${data.currentStreak} streak!`, {
        description:
          data.currentStreak >= 7
            ? 'MAX STREAK! Keep going for bonus rewards!'
            : `Next check-in tomorrow for +${DAY_REWARDS[Math.min(data.dayIndex + 1, 6)]} $LOAR`,
        duration: 4000,
      });
      queryClient.invalidateQueries({ queryKey: ['checkinStatus'] });
      queryClient.invalidateQueries({ queryKey: ['creditBalance'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Check-in failed');
    },
  });

  if (isLoading) {
    return (
      <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-32 mb-3" />
        <div className="flex gap-1.5 mb-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 h-10 bg-zinc-800 rounded" />
          ))}
        </div>
        <div className="h-9 bg-zinc-800 rounded" />
      </div>
    );
  }

  const s = status ?? {
    currentStreak: 0,
    longestStreak: 0,
    totalCheckins: 0,
    checkedInToday: false,
    nextReward: 5,
    dayIndex: 0,
    dayRewards: DAY_REWARDS,
  };

  const alreadyClaimed = s.checkedInToday || claimed;
  const nextDayIndex = Math.min(s.currentStreak, 6);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white">Daily Check-in</span>
              {s.currentStreak >= 3 && (
                <span className="text-orange-400 text-sm font-bold">
                  🔥 {s.currentStreak} day streak
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {alreadyClaimed
                ? 'Come back tomorrow to continue your streak!'
                : `Check in to earn +${s.nextReward} $LOAR`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-amber-400 text-lg font-black">{s.currentStreak}</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Streak</div>
          </div>
        </div>
      </div>

      {/* 7-Day Track */}
      <div className="px-4 py-3">
        <div className="flex gap-1">
          {DAY_REWARDS.map((reward, i) => {
            const isPast = i < s.currentStreak && alreadyClaimed;
            const isCurrent =
              i === s.currentStreak - 1 && alreadyClaimed
                ? true
                : i === nextDayIndex && !alreadyClaimed;
            const isFuture = !isPast && !isCurrent;

            return (
              <div
                key={i}
                className={`flex-1 flex flex-col items-center gap-0.5 rounded-lg py-2 px-0.5 transition-all ${
                  isPast
                    ? 'bg-green-950 border border-green-800'
                    : isCurrent
                      ? alreadyClaimed
                        ? 'bg-green-950 border border-green-600'
                        : 'bg-amber-950 border border-amber-500 ring-1 ring-amber-400/30'
                      : 'bg-zinc-800 border border-zinc-700'
                }`}
              >
                <span className="text-sm leading-none">
                  {isPast ? '✅' : isCurrent && alreadyClaimed ? '✅' : DAY_ICONS[i]}
                </span>
                <span
                  className={`text-[9px] font-bold leading-none mt-1 ${
                    isPast || (isCurrent && alreadyClaimed)
                      ? 'text-green-400'
                      : isCurrent
                        ? 'text-amber-400'
                        : 'text-zinc-500'
                  }`}
                >
                  +{reward}
                </span>
                <span
                  className={`text-[8px] leading-none ${
                    isFuture ? 'text-zinc-600' : 'text-zinc-400'
                  }`}
                >
                  D{i + 1}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pb-4">
        {alreadyClaimed ? (
          <div className="w-full py-2 rounded-lg bg-green-900/40 border border-green-800 text-green-400 text-sm font-medium text-center">
            ✓ Checked in today
          </div>
        ) : (
          <button
            onClick={() => checkinMutation.mutate()}
            disabled={checkinMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-all active:scale-95 disabled:opacity-50 relative overflow-hidden"
          >
            <span className="relative z-10">
              {checkinMutation.isPending ? 'Claiming...' : `Claim +${s.nextReward} $LOAR`}
            </span>
            {!checkinMutation.isPending && (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_infinite]" />
            )}
          </button>
        )}
        <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-600">
          <span>Total check-ins: {s.totalCheckins}</span>
          <span>Best streak: {s.longestStreak}</span>
        </div>
      </div>
    </div>
  );
}
