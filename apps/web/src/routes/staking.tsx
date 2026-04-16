/**
 * Staking Dashboard — Premium DeFi staking page inspired by gobob.xyz
 *
 * Tiers unlock: fee discounts, priority AI queue, curation mining boosts,
 * and priority allocation on new universe token launches.
 */
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Shield,
  Zap,
  TrendingUp,
  Crown,
  Loader2,
  ArrowUp,
  ArrowDown,
  Star,
  Percent,
  BarChart3,
  Users,
  Lock,
  ChevronRight,
  Sparkles,
  Trophy,
  Flame,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/staking')({
  beforeLoad: () => {
    throw redirect({ to: '/coming-soon' });
  },
  component: StakingPage,
});

const TIER_COLORS: Record<string, string> = {
  NONE: 'text-muted-foreground',
  BRONZE: 'text-orange-500',
  SILVER: 'text-gray-300',
  GOLD: 'text-yellow-400',
  DIAMOND: 'text-cyan-400',
};

const TIER_GLOW: Record<string, string> = {
  NONE: '',
  BRONZE: 'shadow-orange-500/20',
  SILVER: 'shadow-gray-400/20',
  GOLD: 'shadow-yellow-400/20',
  DIAMOND: 'shadow-cyan-400/20',
};

const TIER_BORDER: Record<string, string> = {
  NONE: 'border-border',
  BRONZE: 'border-orange-500/30',
  SILVER: 'border-gray-400/30',
  GOLD: 'border-yellow-400/30',
  DIAMOND: 'border-cyan-400/30',
};

const TIER_ICONS: Record<string, typeof Shield> = {
  NONE: Shield,
  BRONZE: Shield,
  SILVER: Star,
  GOLD: Crown,
  DIAMOND: Crown,
};

function StakingPage() {
  const { address, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const v = useVocab();
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake'>('stake');

  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/staking' } });
    }
  }, [isAuthenticated, isAuthenticating, navigate]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['staking-profile'],
    queryFn: () => trpcClient.staking.getProfile.query(),
    enabled: isAuthenticated,
  });

  const { data: tiers } = useQuery({
    queryKey: ['staking-tiers'],
    queryFn: () => trpcClient.staking.tiers.query(),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['staking-leaderboard'],
    queryFn: () => trpcClient.staking.leaderboard.query({ limit: 10 }),
  });

  const syncMutation = useMutation({
    mutationFn: (data: { stakedAmount: number }) => trpcClient.staking.syncStake.mutate(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staking-profile'] }),
  });

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
            <Loader2 className="h-10 w-10 animate-spin text-primary relative" />
          </div>
          <p className="text-sm text-muted-foreground">Loading staking dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const p = profile as any;
  const currentTier = p?.tier || 'NONE';
  const TierIcon = TIER_ICONS[currentTier] || Shield;
  const stakedAmount = p?.stakedAmount ?? 0;

  // Calculate total staked across leaderboard for the hero stat
  const totalStaked = leaderboard?.reduce((sum: number, e: any) => sum + e.stakedAmount, 0) ?? 0;
  const totalStakers = leaderboard?.length ?? 0;

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background gradient orbs — BOB-style ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[300px] -left-[200px] w-[700px] h-[700px] rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute top-[200px] -right-[300px] w-[600px] h-[600px] rounded-full bg-primary/5 blur-[100px]" />
        <div className="absolute bottom-[100px] left-[30%] w-[500px] h-[500px] rounded-full bg-secondary/5 blur-[100px]" />
      </div>

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="border-b border-border/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-16">
            {/* Hero headline */}
            <div className="max-w-2xl mb-12">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-medium text-primary uppercase tracking-widest">
                  {v('staking')} Protocol
                </span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
                {v('stake')} $LOAR.
                <br />
                <span className="text-primary">Unlock Power.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {v('stake')} $LOAR to unlock tier benefits — fee discounts, priority AI queue,
                curation boosts, and launchpad allocation. The more you stake, the more you earn.
              </p>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Value Staked"
                value={`${totalStaked.toLocaleString()}`}
                suffix="$LOAR"
                icon={<Lock className="h-4 w-4" />}
              />
              <StatCard
                label="Total Stakers"
                value={totalStakers.toString()}
                icon={<Users className="h-4 w-4" />}
              />
              <StatCard
                label="Your Tier"
                value={currentTier}
                tierColor={TIER_COLORS[currentTier]}
                icon={<TierIcon className="h-4 w-4" />}
              />
              <StatCard
                label="Your Stake"
                value={stakedAmount.toLocaleString()}
                suffix="$LOAR"
                icon={<Flame className="h-4 w-4" />}
              />
            </div>
          </div>
        </section>

        {/* Main content */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left column: Stake/Unstake + Your Position */}
            <div className="lg:col-span-5 space-y-6">
              {/* Stake / Unstake Card */}
              <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
                {/* Tab switcher */}
                <div className="flex border-b border-border/60">
                  <button
                    className={`flex-1 py-4 text-sm font-semibold transition-colors relative ${
                      activeTab === 'stake'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setActiveTab('stake')}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <ArrowUp className="h-4 w-4" />
                      {v('stake')}
                    </span>
                    {activeTab === 'stake' && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </button>
                  <button
                    className={`flex-1 py-4 text-sm font-semibold transition-colors relative ${
                      activeTab === 'unstake'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setActiveTab('unstake')}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <ArrowDown className="h-4 w-4" />
                      {v('unstake')}
                    </span>
                    {activeTab === 'unstake' && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </button>
                </div>

                <div className="p-6 space-y-5">
                  {activeTab === 'stake' ? (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground mb-2 block">
                          Amount to {v('stake').toLowerCase()}
                        </label>
                        <div className="relative">
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={stakeAmount}
                            onChange={(e) => setStakeAmount(e.target.value)}
                            className="h-14 text-xl font-semibold pr-20 bg-background/50 border-border/60"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                            $LOAR
                          </span>
                        </div>
                      </div>

                      {/* Quick amounts */}
                      <div className="flex gap-2">
                        {['1,000', '10,000', '50,000', '100,000'].map((label) => {
                          const val = label.replace(/,/g, '');
                          return (
                            <button
                              key={val}
                              className="flex-1 py-2 text-xs font-medium rounded-lg border border-border/60 bg-background/50 hover:bg-primary/10 hover:border-primary/30 transition-colors"
                              onClick={() => setStakeAmount(val)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      <Button
                        className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90"
                        disabled={
                          !stakeAmount || Number(stakeAmount) <= 0 || syncMutation.isPending
                        }
                        onClick={() => {
                          const amount = Number(stakeAmount);
                          if (amount > 0) {
                            const currentStaked = (profile as any)?.stakedAmount ?? 0;
                            syncMutation.mutate({ stakedAmount: currentStaked + amount });
                            setStakeAmount('');
                          }
                        }}
                      >
                        {syncMutation.isPending ? (
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        ) : null}
                        {syncMutation.isPending
                          ? 'Staking...'
                          : stakeAmount
                            ? `${v('stake')} ${Number(stakeAmount).toLocaleString()} $LOAR`
                            : v('stake-loar')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground mb-2 block">
                          Amount to {v('unstake').toLowerCase()}
                        </label>
                        <div className="relative">
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={unstakeAmount}
                            onChange={(e) => setUnstakeAmount(e.target.value)}
                            className="h-14 text-xl font-semibold pr-20 bg-background/50 border-border/60"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                            $LOAR
                          </span>
                        </div>
                      </div>

                      {stakedAmount > 0 && (
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setUnstakeAmount(String(stakedAmount))}
                        >
                          Max: {stakedAmount.toLocaleString()} $LOAR
                        </button>
                      )}

                      <Button
                        variant="outline"
                        className="w-full h-12 text-base font-semibold border-destructive/30 text-destructive hover:bg-destructive/10"
                        disabled={
                          !unstakeAmount || Number(unstakeAmount) <= 0 || syncMutation.isPending
                        }
                        onClick={() => {
                          const amount = Number(unstakeAmount);
                          const currentStaked = (profile as any)?.stakedAmount ?? 0;
                          if (amount > 0 && amount <= currentStaked) {
                            syncMutation.mutate({ stakedAmount: currentStaked - amount });
                            setUnstakeAmount('');
                          }
                        }}
                      >
                        {syncMutation.isPending ? (
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        ) : null}
                        {syncMutation.isPending
                          ? 'Unstaking...'
                          : unstakeAmount
                            ? `${v('unstake')} ${Number(unstakeAmount).toLocaleString()} $LOAR`
                            : `${v('unstake')} $LOAR`}
                      </Button>
                    </>
                  )}

                  {/* Info line */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <Lock className="h-3 w-3 flex-shrink-0" />
                    <span>7-day lock period. Early unstake = 5% penalty to LP (not burned).</span>
                  </div>
                </div>
              </div>

              {/* Your Position Card */}
              <div
                className={`rounded-xl border bg-card/50 backdrop-blur-sm p-6 ${TIER_BORDER[currentTier]} ${TIER_GLOW[currentTier] ? `shadow-lg ${TIER_GLOW[currentTier]}` : ''}`}
              >
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Your Position
                  </h3>
                  <div className="flex items-center gap-2">
                    <TierIcon className={`h-5 w-5 ${TIER_COLORS[currentTier]}`} />
                    <span className={`text-sm font-bold ${TIER_COLORS[currentTier]}`}>
                      {currentTier}
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Staked</span>
                    <span className="text-lg font-bold tabular-nums">
                      {stakedAmount.toLocaleString()}{' '}
                      <span className="text-sm text-muted-foreground font-normal">$LOAR</span>
                    </span>
                  </div>
                  <div className="h-px bg-border/60" />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Fee Discount</p>
                      <p className="text-lg font-bold text-primary tabular-nums">
                        {((p?.feeDiscountBps ?? 0) / 100).toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Curation Boost</p>
                      <p className="text-lg font-bold text-primary tabular-nums">
                        {((p?.curationBoost ?? 100) / 100).toFixed(1)}x
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Priority Queue</p>
                      <p className="text-lg font-bold">
                        {p?.priorityQueue ? (
                          <span className="text-green-400 flex items-center gap-1">
                            <Zap className="h-4 w-4" /> Active
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Total Earned</p>
                      <p className="text-lg font-bold tabular-nums">
                        {(p?.totalCurationEarned ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Tiers + Leaderboard + How it works */}
            <div className="lg:col-span-7 space-y-6">
              {/* Tier Roadmap */}
              <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
                <div className="p-6 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-bold">Tier Benefits</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Stake more to unlock higher tiers and greater rewards
                  </p>
                </div>

                <div className="px-6 pb-6">
                  <div className="space-y-3">
                    {tiers
                      ?.filter((t: any) => t.name !== 'NONE')
                      .map((tier: any) => {
                        const isActive = currentTier === tier.name;
                        const tierIdx = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'].indexOf(tier.name);
                        const currentIdx = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'].indexOf(
                          currentTier
                        );
                        const isUnlocked = currentIdx >= tierIdx;

                        return (
                          <div
                            key={tier.name}
                            className={`relative rounded-lg border p-4 transition-all ${
                              isActive
                                ? `${TIER_BORDER[tier.name]} bg-primary/5 ${TIER_GLOW[tier.name] ? `shadow-md ${TIER_GLOW[tier.name]}` : ''}`
                                : isUnlocked
                                  ? 'border-border/60 bg-card/80'
                                  : 'border-border/40 bg-card/30 opacity-70'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                                    isActive
                                      ? 'bg-primary/20'
                                      : isUnlocked
                                        ? 'bg-muted'
                                        : 'bg-muted/50'
                                  }`}
                                >
                                  {TIER_ICONS[tier.name] &&
                                    (() => {
                                      const Icon = TIER_ICONS[tier.name];
                                      return (
                                        <Icon className={`h-5 w-5 ${TIER_COLORS[tier.name]}`} />
                                      );
                                    })()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className={`font-bold ${TIER_COLORS[tier.name]}`}>
                                      {tier.name}
                                    </span>
                                    {isActive && (
                                      <Badge className="text-[10px] h-5 bg-primary/20 text-primary border-primary/30">
                                        Current
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Min. {tier.minStake.toLocaleString()} $LOAR
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-6 text-sm">
                                <div className="text-right hidden sm:block">
                                  <p className="text-xs text-muted-foreground">Fee Discount</p>
                                  <p className="font-semibold">{tier.feeDiscountPct}</p>
                                </div>
                                <div className="text-right hidden sm:block">
                                  <p className="text-xs text-muted-foreground">Curation</p>
                                  <p className="font-semibold">{tier.curationBoostPct}</p>
                                </div>
                                <div className="text-right hidden md:block">
                                  <p className="text-xs text-muted-foreground">Priority</p>
                                  <p className="font-semibold">
                                    {tier.priorityQueue ? (
                                      <Zap className="h-4 w-4 text-primary inline" />
                                    ) : (
                                      '—'
                                    )}
                                  </p>
                                </div>
                                {!isUnlocked && (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Leaderboard */}
              <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
                <div className="p-6 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-bold">{v('stakers')}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Top stakers by amount</p>
                </div>

                <div className="px-6 pb-6">
                  {!leaderboard?.length ? (
                    <div className="text-center py-12">
                      <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No stakers yet</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Be the first to stake $LOAR
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {leaderboard.map((entry: any, i: number) => (
                        <div
                          key={entry.address}
                          className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                            i < 3 ? 'bg-primary/5' : 'hover:bg-muted/50'
                          }`}
                        >
                          <div
                            className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                              i === 0
                                ? 'bg-yellow-400/20 text-yellow-400'
                                : i === 1
                                  ? 'bg-gray-300/20 text-gray-300'
                                  : i === 2
                                    ? 'bg-orange-400/20 text-orange-400'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm truncate">
                                {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${TIER_COLORS[entry.tier]} border-current/30`}
                              >
                                {entry.tier}
                              </Badge>
                            </div>
                          </div>
                          <span className="font-bold tabular-nums text-sm">
                            {entry.stakedAmount.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* How it works */}
              <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-6">
                <h3 className="text-lg font-bold mb-4">How It Works</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    {
                      icon: <Lock className="h-5 w-5" />,
                      title: `${v('stake')} $LOAR`,
                      desc: 'Lock your $LOAR tokens to reach a staking tier and start earning benefits.',
                    },
                    {
                      icon: <Percent className="h-5 w-5" />,
                      title: 'Fee Discounts',
                      desc: 'Higher tiers unlock bigger fee discounts on all marketplace transactions.',
                    },
                    {
                      icon: <Zap className="h-5 w-5" />,
                      title: 'Priority AI Queue',
                      desc: 'Silver+ stakers get priority access to AI generation models.',
                    },
                    {
                      icon: <TrendingUp className="h-5 w-5" />,
                      title: 'Curation Mining',
                      desc: 'Discover content early and earn boosted $LOAR rewards from curation.',
                    },
                    {
                      icon: <BarChart3 className="h-5 w-5" />,
                      title: 'Launchpad Access',
                      desc: 'Higher tier = higher allocation weight for new universe token launches.',
                    },
                    {
                      icon: <Shield className="h-5 w-5" />,
                      title: '7-Day Lock',
                      desc: 'Tokens are locked for 7 days. Early unstake sends 5% to LP (not burned).',
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="flex gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors"
                    >
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                        {item.icon}
                      </div>
                      <div>
                        <p className="text-sm font-semibold mb-0.5">{item.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function StatCard({
  label,
  value,
  suffix,
  icon,
  tierColor,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  tierColor?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-muted-foreground">{icon}</div>
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <p className={`text-2xl sm:text-3xl font-bold tabular-nums ${tierColor || ''}`}>
        {value}
        {suffix && (
          <span className="text-sm font-normal text-muted-foreground ml-1.5">{suffix}</span>
        )}
      </p>
    </div>
  );
}
