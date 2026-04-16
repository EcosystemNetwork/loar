/**
 * LPYieldManager — Universe creator dashboard panel for managing
 * LP yield incentives: view reward recipients, collect fees, claim
 * earnings, and update reward splits.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useLPRewardConfig,
  useClaimableFees,
  useCollectRewards,
  useClaimFees,
  useUpdateRewardRecipient,
} from '@/hooks/useLPYield';
import {
  useUniversePool,
  useDistributeUniverseReward,
  useApproveLoar,
  useLoarBalance,
} from '@/hooks/useUniverseStaking';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { toast } from 'sonner';
import {
  Coins,
  ArrowDownToLine,
  RefreshCw,
  UserPlus,
  Loader2,
  Percent,
  Wallet,
  CheckCircle2,
  TrendingUp,
  Gift,
} from 'lucide-react';
import type { Address } from 'viem';

interface LPYieldManagerProps {
  tokenAddress: Address;
  universeName: string;
  onChainUniverseId?: number;
}

export function LPYieldManager({
  tokenAddress,
  universeName,
  onChainUniverseId,
}: LPYieldManagerProps) {
  const { address } = useWalletAccount();
  const {
    rewardConfig,
    isLoading: configLoading,
    refetch: refetchConfig,
  } = useLPRewardConfig(tokenAddress);
  const {
    claimableFeesFormatted,
    claimableFees,
    refetch: refetchFees,
  } = useClaimableFees(address as Address | undefined, tokenAddress);
  const { collectRewards, isPending: collecting } = useCollectRewards();
  const { claimFees, isPending: claiming } = useClaimFees();
  const { updateRecipient, isPending: updating } = useUpdateRewardRecipient();

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [newRecipient, setNewRecipient] = useState('');
  const [distributeAmount, setDistributeAmount] = useState('');

  // Universe staking pool data (for distribute rewards)
  const { pool: universePool } = useUniversePool(onChainUniverseId);
  const { distributeReward, isPending: distributing } = useDistributeUniverseReward();
  const { approve: approveLoar, isPending: approvingLoar } = useApproveLoar();
  const { balanceFormatted: loarBalance } = useLoarBalance();

  if (configLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!rewardConfig || rewardConfig.rewardRecipients.length === 0) {
    return null; // No LP pool configured
  }

  const isAdmin = rewardConfig.rewardAdmins.some(
    (admin) => admin.toLowerCase() === address?.toLowerCase()
  );
  const isRecipient = rewardConfig.rewardRecipients.some(
    (r) => r.toLowerCase() === address?.toLowerCase()
  );

  const handleCollect = async () => {
    try {
      await collectRewards(tokenAddress);
      toast.success('Fees collected and distributed to recipients');
      refetchFees();
      refetchConfig();
    } catch (err: any) {
      toast.error(err.message || 'Failed to collect fees');
    }
  };

  const handleClaim = async () => {
    try {
      await claimFees(tokenAddress);
      toast.success('Fees claimed to your wallet');
      refetchFees();
    } catch (err: any) {
      toast.error(err.message || 'Failed to claim fees');
    }
  };

  const handleUpdateRecipient = async (index: number) => {
    if (!newRecipient.match(/^0x[0-9a-fA-F]{40}$/)) {
      toast.error('Invalid address format');
      return;
    }
    try {
      await updateRecipient(tokenAddress, index, newRecipient as Address);
      toast.success('Reward recipient updated');
      setEditIndex(null);
      setNewRecipient('');
      refetchConfig();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update recipient');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-base">LP Yield & Fees</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {universeName}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Claimable Fees */}
        {isRecipient && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <div>
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                Claimable Fees
              </p>
              <p className="text-2xl font-bold">{claimableFeesFormatted} ETH</p>
            </div>
            <Button
              size="sm"
              onClick={handleClaim}
              disabled={claiming || !claimableFees || claimableFees === 0n}
              className="gap-1.5"
            >
              {claiming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-4 w-4" />
              )}
              Claim
            </Button>
          </div>
        )}

        {/* Collect Fees (anyone can call) */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Collect Pool Fees</p>
            <p className="text-xs text-muted-foreground">
              Harvest accumulated swap fees from the LP and distribute to recipients
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCollect}
            disabled={collecting}
            className="gap-1.5"
          >
            {collecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Collect
          </Button>
        </div>

        {/* Reward Recipients */}
        <div>
          <p className="text-sm font-medium mb-2">Fee Recipients</p>
          <div className="space-y-2">
            {rewardConfig.rewardRecipients.map((recipient, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2.5 rounded-md border bg-card"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Wallet className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    {editIndex === i ? (
                      <div className="flex gap-2">
                        <Input
                          value={newRecipient}
                          onChange={(e) => setNewRecipient(e.target.value)}
                          placeholder="0x..."
                          className="h-7 text-xs font-mono"
                        />
                        <Button
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleUpdateRecipient(i)}
                          disabled={updating}
                        >
                          {updating ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => {
                            setEditIndex(null);
                            setNewRecipient('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs font-mono truncate">
                        {recipient.slice(0, 6)}...{recipient.slice(-4)}
                        {recipient.toLowerCase() === address?.toLowerCase() && (
                          <Badge variant="secondary" className="ml-2 text-xs px-1">
                            You
                          </Badge>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="outline" className="text-xs gap-1">
                    <Percent className="h-3 w-3" />
                    {(rewardConfig.rewardBps[i] / 100).toFixed(1)}%
                  </Badge>
                  {isAdmin && editIndex !== i && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        setEditIndex(i);
                        setNewRecipient(recipient);
                      }}
                    >
                      <UserPlus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {!isAdmin && !isRecipient && (
          <p className="text-xs text-muted-foreground text-center py-2">
            You are not a fee recipient or admin for this pool. Anyone can collect fees to trigger
            distribution.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
