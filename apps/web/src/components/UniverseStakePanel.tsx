/**
 * UniverseStakePanel — Users stake $LOAR into a universe pool to earn
 * revenue share from trading fees, subscriptions, and NFT mints.
 *
 * Shows: pool stats, user's stake, pending rewards, stake/unstake/claim actions.
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  useUniverseStake,
  useUniversePool,
  usePendingReward,
  useLoarBalance,
  useApproveLoar,
  useStakeInUniverse,
  useUnstakeFromUniverse,
  useClaimUniverseReward,
  useStakingConfig,
} from '@/hooks/useUniverseStaking';
import { useChainId } from 'wagmi';

// Chains where LaunchpadStaking is deployed
const STAKING_CHAINS = new Set([84532]); // Base Sepolia
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { toast } from 'sonner';
import { parseEther } from 'viem';
import {
  Coins,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  TrendingUp,
  Lock,
  AlertTriangle,
  Gift,
} from 'lucide-react';

interface UniverseStakePanelProps {
  universeId: number;
  universeName?: string;
}

export function UniverseStakePanel({ universeId, universeName }: UniverseStakePanelProps) {
  const chainId = useChainId();
  const { address } = useWalletAccount();

  // Don't render if staking isn't deployed on this chain
  if (!STAKING_CHAINS.has(chainId)) return null;
  const { pool, refetch: refetchPool } = useUniversePool(universeId);
  const { stake, refetch: refetchStake } = useUniverseStake(universeId);
  const { pendingFormatted, pending, refetch: refetchPending } = usePendingReward(universeId);
  const { balanceFormatted, balance, allowance, refetchBalance, refetchAllowance } =
    useLoarBalance();
  const { minLockDays, penaltyPercent } = useStakingConfig();

  const { approve, isPending: approving } = useApproveLoar();
  const { stakeInUniverse, isPending: staking } = useStakeInUniverse();
  const { unstakeFromUniverse, isPending: unstaking } = useUnstakeFromUniverse();
  const { claimReward, isPending: claiming } = useClaimUniverseReward();

  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'stake' | 'unstake'>('stake');

  const refetchAll = () => {
    refetchPool();
    refetchStake();
    refetchPending();
    refetchBalance();
    refetchAllowance();
  };

  const needsApproval =
    mode === 'stake' &&
    amount &&
    allowance !== undefined &&
    parseEther(amount || '0') > (allowance ?? 0n);

  const isLocked =
    stake && stake.stakedAt > 0 && Date.now() / 1000 < stake.stakedAt + minLockDays * 86400;

  const handleApprove = async () => {
    try {
      await approve(parseEther(amount));
      toast.success('Approved $LOAR for staking');
      refetchAllowance();
    } catch (err: any) {
      toast.error(err.message || 'Approval failed');
    }
  };

  const handleStake = async () => {
    if (!amount || Number(amount) <= 0) return;
    try {
      await stakeInUniverse(universeId, amount);
      toast.success(`Staked ${amount} $LOAR into ${universeName || 'universe'}`);
      setAmount('');
      refetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Stake failed');
    }
  };

  const handleUnstake = async () => {
    if (!amount || Number(amount) <= 0) return;
    try {
      await unstakeFromUniverse(universeId, amount);
      toast.success(`Unstaked ${amount} $LOAR from ${universeName || 'universe'}`);
      setAmount('');
      refetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Unstake failed');
    }
  };

  const handleClaim = async () => {
    try {
      await claimReward(universeId);
      toast.success('Rewards claimed!');
      refetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Claim failed');
    }
  };

  if (!address) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold text-sm">Stake & Earn</h3>
          </div>
          <Badge variant="outline" className="text-xs">
            {minLockDays}d lock
          </Badge>
        </div>

        {/* Pool Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/50 rounded-lg p-2.5">
            <p className="text-xs text-muted-foreground">Pool Total</p>
            <p className="font-semibold text-sm">
              {pool
                ? Number(pool.totalStakedFormatted).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })
                : '0'}{' '}
              LOAR
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2.5">
            <p className="text-xs text-muted-foreground">Total Distributed</p>
            <p className="font-semibold text-sm">
              {pool
                ? Number(pool.totalDistributedFormatted).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
                : '0'}{' '}
              LOAR
            </p>
          </div>
        </div>

        {/* Your Position */}
        {stake && stake.amount > 0n && (
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Your Stake</span>
              <span className="font-semibold text-sm">
                {Number(stake.amountFormatted).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{' '}
                LOAR
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Gift className="h-3 w-3" /> Pending Rewards
              </span>
              <span className="font-semibold text-sm text-green-500">
                {Number(pendingFormatted).toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                LOAR
              </span>
            </div>
            {isLocked && (
              <div className="flex items-center gap-1 text-xs text-amber-500">
                <Lock className="h-3 w-3" />
                Locked until{' '}
                {new Date((stake.stakedAt + minLockDays * 86400) * 1000).toLocaleDateString()}
              </div>
            )}
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleClaim}
              disabled={claiming || !pending || pending === 0n}
            >
              {claiming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-4 w-4" />
              )}
              Claim Rewards
            </Button>
          </div>
        )}

        {/* Stake / Unstake Toggle */}
        <div className="flex gap-1 bg-muted/50 rounded-md p-1">
          <button
            className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
              mode === 'stake' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'
            }`}
            onClick={() => setMode('stake')}
          >
            Stake
          </button>
          <button
            className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
              mode === 'unstake' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'
            }`}
            onClick={() => setMode('unstake')}
          >
            Unstake
          </button>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Amount</span>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() =>
                setAmount(mode === 'stake' ? balanceFormatted : stake?.amountFormatted || '0')
              }
            >
              Max:{' '}
              {mode === 'stake'
                ? Number(balanceFormatted).toLocaleString(undefined, { maximumFractionDigits: 2 })
                : Number(stake?.amountFormatted || 0).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
            </button>
          </div>
          <Input
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10"
          />
        </div>

        {/* Early Unstake Warning */}
        {mode === 'unstake' && isLocked && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Early unstake penalty: {penaltyPercent}% of unstaked amount goes to LP pool. Wait
              until lock expires to avoid penalty.
            </p>
          </div>
        )}

        {/* Action Button */}
        {mode === 'stake' ? (
          needsApproval ? (
            <Button className="w-full" onClick={handleApprove} disabled={approving}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Approve $LOAR
            </Button>
          ) : (
            <Button
              className="w-full gap-1.5"
              onClick={handleStake}
              disabled={staking || !amount || Number(amount) <= 0}
            >
              {staking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-4 w-4" />
              )}
              Stake $LOAR
            </Button>
          )
        ) : (
          <Button
            className="w-full gap-1.5"
            variant="outline"
            onClick={handleUnstake}
            disabled={unstaking || !amount || Number(amount) <= 0 || !stake || stake.amount === 0n}
          >
            {unstaking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpFromLine className="h-4 w-4" />
            )}
            Unstake $LOAR
          </Button>
        )}

        <p className="text-[10px] text-muted-foreground text-center leading-tight">
          Stake $LOAR to earn a share of trading fees, subscriptions, and NFT revenue from this
          universe.
          {minLockDays > 0 &&
            ` ${minLockDays}-day lock period. ${penaltyPercent}% early unstake penalty.`}
        </p>
      </CardContent>
    </Card>
  );
}
