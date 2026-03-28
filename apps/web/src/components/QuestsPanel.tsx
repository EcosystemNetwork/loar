/**
 * QuestsPanel — Quest list + affiliate section for earning $LOAR tokens.
 *
 * Shows quest progress, claimable rewards, affiliate referral link,
 * and leaderboard. Designed as a slide-out panel or dashboard section.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────

interface Quest {
  id: string;
  category: string;
  title: string;
  description: string;
  loarReward: number;
  targetCount: number;
  icon: string;
  repeatable: boolean;
  currentCount: number;
  isCompleted: boolean;
  isClaimable: boolean;
  progressPercent: number;
}

// ── Icons ─────────────────────────────────────────────────────────────

const questIcons: Record<string, string> = {
  wallet: '\u{1F4B3}',
  video: '\u{1F3AC}',
  globe: '\u{1F30D}',
  user: '\u{1F464}',
  edit: '\u{270F}\u{FE0F}',
  calendar: '\u{1F4C5}',
  film: '\u{1F3A5}',
  share: '\u{1F517}',
  vote: '\u{1F5F3}\u{FE0F}',
  users: '\u{1F465}',
  crown: '\u{1F451}',
  handshake: '\u{1F91D}',
  layers: '\u{1F4DA}',
  trophy: '\u{1F3C6}',
  cpu: '\u{1F916}',
  diamond: '\u{1F48E}',
};

const categoryLabels: Record<string, string> = {
  onboarding: 'Getting Started',
  engagement: 'Daily Engagement',
  social: 'Social & Referrals',
  power_user: 'Power User',
};

const categoryColors: Record<string, string> = {
  onboarding: 'border-blue-600',
  engagement: 'border-green-600',
  social: 'border-purple-600',
  power_user: 'border-amber-600',
};

// ── Quest Card ────────────────────────────────────────────────────────

function QuestCard({
  quest,
  onClaim,
  isClaiming,
}: {
  quest: Quest;
  onClaim: (id: string) => void;
  isClaiming: boolean;
}) {
  const icon = questIcons[quest.icon] || '\u{2B50}';

  return (
    <div
      className={`bg-zinc-900 rounded-lg p-3 border-l-2 ${
        quest.isClaimable
          ? 'border-l-amber-500 ring-1 ring-amber-500/20'
          : quest.isCompleted
            ? 'border-l-green-600 opacity-60'
            : categoryColors[quest.category] || 'border-l-zinc-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1">
          <span className="text-lg">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{quest.title}</span>
              {quest.repeatable && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  REPEATABLE
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">{quest.description}</p>

            {/* Progress bar */}
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
                <span>
                  {quest.currentCount}/{quest.targetCount}
                </span>
                <span>{quest.progressPercent}%</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    quest.isClaimable
                      ? 'bg-amber-500'
                      : quest.isCompleted
                        ? 'bg-green-600'
                        : 'bg-blue-600'
                  }`}
                  style={{ width: `${quest.progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="text-amber-400 text-xs font-bold whitespace-nowrap">
            +{quest.loarReward} $LOAR
          </span>
          {quest.isClaimable && (
            <button
              onClick={() => onClaim(quest.id)}
              disabled={isClaiming}
              className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10px] rounded font-medium transition-colors disabled:opacity-50"
            >
              {isClaiming ? 'Claiming...' : 'Claim'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Affiliate Section ─────────────────────────────────────────────────

function AffiliateSection() {
  const { data: affiliate, isLoading } = useQuery({
    queryKey: ['affiliateCode'],
    queryFn: () => trpcClient.quests.getAffiliateCode.query(),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['affiliateLeaderboard'],
    queryFn: () => trpcClient.quests.affiliateLeaderboard.query({ limit: 5 }),
  });

  if (isLoading) return <div className="text-xs text-zinc-500 py-2">Loading...</div>;
  if (!affiliate) return null;

  return (
    <div className="space-y-3">
      {/* Referral Link */}
      <div className="bg-zinc-900 rounded-lg p-3">
        <div className="text-sm font-medium text-white mb-1">Your Referral Link</div>
        <p className="text-xs text-zinc-400 mb-2">
          Earn <span className="text-amber-400 font-bold">100 $LOAR</span> per friend who joins.
          They get <span className="text-amber-400 font-bold">50 $LOAR</span> too.
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={affiliate.link}
            className="flex-1 bg-zinc-800 text-zinc-300 text-xs px-2 py-1.5 rounded border border-zinc-700 font-mono"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(affiliate.link);
              toast.success('Referral link copied!');
            }}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded font-medium"
          >
            Copy
          </button>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400">
          <span>
            Code: <span className="text-white font-mono">{affiliate.code}</span>
          </span>
          <span>
            Referrals: <span className="text-white">{affiliate.totalReferrals}</span>
          </span>
          <span>
            Earned: <span className="text-amber-400">{affiliate.totalEarned} $LOAR</span>
          </span>
        </div>
      </div>

      {/* Leaderboard */}
      {leaderboard && leaderboard.length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 font-medium mb-1.5 uppercase tracking-wider">
            Top Referrers
          </div>
          <div className="space-y-1">
            {leaderboard.map((entry) => (
              <div
                key={entry.rank}
                className="flex items-center justify-between bg-zinc-900/50 rounded px-2 py-1 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-5 text-center font-bold ${
                      entry.rank === 1
                        ? 'text-amber-400'
                        : entry.rank === 2
                          ? 'text-zinc-300'
                          : entry.rank === 3
                            ? 'text-orange-400'
                            : 'text-zinc-500'
                    }`}
                  >
                    #{entry.rank}
                  </span>
                  <span className="text-zinc-300 font-mono">{entry.userId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400">{entry.totalReferrals} refs</span>
                  <span className="text-amber-400 font-bold">{entry.totalEarned} $LOAR</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export function QuestsPanel() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAffiliate, setShowAffiliate] = useState(false);
  const queryClient = useQueryClient();

  const { data: quests, isLoading } = useQuery({
    queryKey: ['quests'],
    queryFn: () => trpcClient.quests.list.query(),
  });

  const claimMutation = useMutation({
    mutationFn: (questId: string) => trpcClient.quests.claimReward.mutate({ questId }),
    onSuccess: (data) => {
      toast.success(`Claimed ${data.loarTokensEarned} $LOAR!`);
      queryClient.invalidateQueries({ queryKey: ['quests'] });
      queryClient.invalidateQueries({ queryKey: ['creditBalance'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to claim reward');
    },
  });

  const questList = (quests || []) as Quest[];
  const categories = ['onboarding', 'engagement', 'social', 'power_user'];
  const claimableCount = questList.filter((q) => q.isClaimable).length;
  const totalEarnable = questList
    .filter((q) => q.isClaimable)
    .reduce((sum, q) => sum + q.loarReward, 0);

  const filteredQuests = activeCategory
    ? questList.filter((q) => q.category === activeCategory)
    : questList;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Quests & Rewards</h2>
          <p className="text-xs text-zinc-400">Complete quests to earn $LOAR tokens</p>
        </div>
        {claimableCount > 0 && (
          <div className="text-right">
            <div className="text-amber-400 text-sm font-bold">{claimableCount} claimable</div>
            <div className="text-xs text-zinc-400">+{totalEarnable} $LOAR</div>
          </div>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2 py-1 rounded text-xs ${
            !activeCategory
              ? 'bg-amber-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          All
        </button>
        {categories.map((cat) => {
          const catCount = questList.filter((q) => q.category === cat && q.isClaimable).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                activeCategory === cat
                  ? 'bg-amber-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {categoryLabels[cat]}
              {catCount > 0 && (
                <span className="bg-amber-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                  {catCount}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setShowAffiliate(!showAffiliate)}
          className={`px-2 py-1 rounded text-xs ml-auto ${
            showAffiliate
              ? 'bg-purple-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          Affiliate Program
        </button>
      </div>

      {/* Affiliate Section */}
      {showAffiliate && <AffiliateSection />}

      {/* Quest List */}
      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading quests...</div>
      ) : (
        <div className="space-y-2">
          {filteredQuests.map((quest) => (
            <QuestCard
              key={quest.id}
              quest={quest}
              onClaim={(id) => claimMutation.mutate(id)}
              isClaiming={claimMutation.isPending}
            />
          ))}
          {filteredQuests.length === 0 && (
            <div className="text-center text-zinc-500 py-4 text-sm">No quests in this category</div>
          )}
        </div>
      )}
    </div>
  );
}
