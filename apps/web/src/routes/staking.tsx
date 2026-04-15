/**
 * Staking Dashboard — Stake $LOAR for tier benefits.
 *
 * Tiers unlock: fee discounts, priority AI queue, curation mining boosts,
 * and priority allocation on new universe token launches.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
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
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/staking')({
  component: StakingPage,
});

const TIER_COLORS: Record<string, string> = {
  NONE: 'text-muted-foreground',
  BRONZE: 'text-orange-600',
  SILVER: 'text-gray-400',
  GOLD: 'text-yellow-500',
  DIAMOND: 'text-cyan-400',
};

const TIER_BG: Record<string, string> = {
  NONE: 'from-muted/50 to-muted/30',
  BRONZE: 'from-orange-500/10 to-orange-600/5',
  SILVER: 'from-gray-300/10 to-gray-400/5',
  GOLD: 'from-yellow-500/10 to-yellow-600/5',
  DIAMOND: 'from-cyan-400/10 to-blue-500/5',
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const p = profile as any;
  const currentTier = p?.tier || 'NONE';
  const TierIcon = TIER_ICONS[currentTier] || Shield;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">$LOAR {v('staking')}</h1>
          </div>
          <p className="text-muted-foreground">
            {v('stake')} $LOAR to unlock tier benefits: fee discounts, priority AI queue, curation
            boosts, and launchpad allocation.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Current Stake + Actions */}
          <div className="lg:col-span-2 space-y-6">
            {/* Current Tier Card */}
            <Card className="overflow-hidden">
              <div className={`bg-gradient-to-br ${TIER_BG[currentTier]} p-6`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <TierIcon className={`h-10 w-10 ${TIER_COLORS[currentTier]}`} />
                    <div>
                      <h2 className="text-2xl font-bold">{currentTier}</h2>
                      <p className="text-sm text-muted-foreground">Your Tier</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold tabular-nums">
                      {(p?.stakedAmount ?? 0).toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">$LOAR Staked</p>
                  </div>
                </div>

                {/* Benefits */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 text-center">
                    <Percent className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">
                      {((p?.feeDiscountBps ?? 0) / 100).toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">Fee Discount</p>
                  </div>
                  <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 text-center">
                    <BarChart3 className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">
                      {((p?.curationBoost ?? 100) / 100).toFixed(1)}x
                    </p>
                    <p className="text-[10px] text-muted-foreground">Curation Boost</p>
                  </div>
                  <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 text-center">
                    <Zap className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">{p?.priorityQueue ? 'Yes' : 'No'}</p>
                    <p className="text-[10px] text-muted-foreground">Priority Queue</p>
                  </div>
                  <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 text-center">
                    <TrendingUp className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">
                      {(p?.totalCurationEarned ?? 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">$LOAR Earned</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Stake / Unstake */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ArrowUp className="h-4 w-4 text-green-500" /> {v('stake-loar')}
                  </h3>
                  <Input
                    type="number"
                    placeholder="Amount to stake"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                  />
                  <div className="flex gap-2">
                    {['1000', '10000', '50000', '100000'].map((val) => (
                      <Button
                        key={val}
                        variant="outline"
                        size="sm"
                        className="flex-1 text-[10px]"
                        onClick={() => setStakeAmount(val)}
                      >
                        {Number(val).toLocaleString()}
                      </Button>
                    ))}
                  </div>
                  <Button
                    className="w-full bg-green-600 hover:bg-green-500"
                    disabled={!stakeAmount || Number(stakeAmount) <= 0 || syncMutation.isPending}
                    onClick={() => {
                      const amount = Number(stakeAmount);
                      if (amount > 0) {
                        const currentStaked = (profile as any)?.stakedAmount ?? 0;
                        syncMutation.mutate({ stakedAmount: currentStaked + amount });
                        setStakeAmount('');
                      }
                    }}
                  >
                    {syncMutation.isPending ? 'Staking...' : v('stake')}{' '}
                    {stakeAmount ? `${Number(stakeAmount).toLocaleString()} $LOAR` : ''}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    7-day lock period. Early unstake = 5% penalty to LP.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ArrowDown className="h-4 w-4 text-red-500" /> {v('unstake')} $LOAR
                  </h3>
                  <Input
                    type="number"
                    placeholder="Amount to unstake"
                    value={unstakeAmount}
                    onChange={(e) => setUnstakeAmount(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10"
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
                    {syncMutation.isPending ? 'Unstaking...' : v('unstake')}{' '}
                    {unstakeAmount ? `${Number(unstakeAmount).toLocaleString()} $LOAR` : ''}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    Penalty-free after 7 days. Early unstake sends 5% to LP (not burned).
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Tier Comparison */}
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-4">Tier Benefits</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left py-2 pr-4">Tier</th>
                        <th className="text-right py-2 px-3">Min Stake</th>
                        <th className="text-right py-2 px-3">Fee Discount</th>
                        <th className="text-right py-2 px-3">Curation Boost</th>
                        <th className="text-center py-2 px-3">Priority Queue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers
                        ?.filter((t: any) => t.name !== 'NONE')
                        .map((tier: any) => (
                          <tr
                            key={tier.name}
                            className={`border-b last:border-0 ${currentTier === tier.name ? 'bg-primary/5' : ''}`}
                          >
                            <td className={`py-2.5 pr-4 font-semibold ${TIER_COLORS[tier.name]}`}>
                              {tier.name}
                              {currentTier === tier.name && (
                                <Badge className="ml-2 text-[10px]">Current</Badge>
                              )}
                            </td>
                            <td className="text-right py-2.5 px-3 tabular-nums">
                              {tier.minStake.toLocaleString()}
                            </td>
                            <td className="text-right py-2.5 px-3">{tier.feeDiscountPct}</td>
                            <td className="text-right py-2.5 px-3">{tier.curationBoostPct}</td>
                            <td className="text-center py-2.5 px-3">
                              {tier.priorityQueue ? (
                                <Zap className="h-4 w-4 text-primary mx-auto" />
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Leaderboard */}
          <div className="space-y-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Users className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">{v('stakers')}</h3>
                </div>
                {!leaderboard?.length ? (
                  <p className="text-center py-8 text-xs text-muted-foreground">No stakers yet</p>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry: any, i: number) => (
                      <div key={entry.address} className="flex items-center gap-2 text-xs">
                        <span
                          className={`w-5 text-right font-bold ${i < 3 ? TIER_COLORS[entry.tier] : 'text-muted-foreground'}`}
                        >
                          {i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `#${i + 1}`}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${TIER_COLORS[entry.tier]}`}
                        >
                          {entry.tier}
                        </Badge>
                        <span className="font-mono flex-1 truncate text-[10px]">
                          {entry.address.slice(0, 8)}...{entry.address.slice(-6)}
                        </span>
                        <span className="font-bold tabular-nums">
                          {entry.stakedAmount.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* How it works */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm">How It Works</h3>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>1. {v('stake')} $LOAR to reach a tier</p>
                  <p>2. Higher tier = bigger marketplace fee discounts</p>
                  <p>3. Silver+ gets priority AI generation queue</p>
                  <p>4. Curation mining: discover content early, earn boosted $LOAR</p>
                  <p>5. Launchpad: higher allocation weight for new token launches</p>
                  <p>6. 7-day lock. Early unstake = 5% penalty sent to LP (not burned)</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
