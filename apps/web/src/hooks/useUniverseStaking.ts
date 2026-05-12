/**
 * useUniverseStaking — hooks for staking $LOAR into universe pools
 * to earn revenue share from trading fees, subscriptions, etc.
 *
 * Reads from LaunchpadStaking contract on-chain.
 */
import { useReadContract, useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { launchpadStakingAbi, loarTokenAbi } from '@loar/abis/generated';
import { formatEther, parseEther, type Address } from 'viem';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { getEvmAddresses } from '@/configs/addresses';
import { confirmTx } from '@/components/tx-confirm';

function stakingChainName(id: number | undefined): string {
  switch (id) {
    case 11155111:
      return 'Sepolia';
    case 84532:
      return 'Base Sepolia';
    case 8453:
      return 'Base';
    case 1:
      return 'Ethereum';
    default:
      return id ? `Chain ${id}` : 'Unknown chain';
  }
}

// LaunchpadStaking deployment addresses per chain
const LAUNCHPAD_STAKING: Record<number, Address> = {
  84532: '0x17250A23fA2E2deB1e695589FF272559d8bEb5bc', // Base Sepolia
};

function useStakingAddress(): Address | undefined {
  const chainId = useChainId();
  return LAUNCHPAD_STAKING[chainId];
}

function useLoarTokenAddress(): Address | undefined {
  const chainId = useChainId();
  const addrs = getEvmAddresses(chainId);
  return addrs?.loarToken;
}

/**
 * Read a user's stake in a specific universe pool.
 */
export function useUniverseStake(universeId: number | undefined) {
  const { address } = useWalletAccount();
  const chainId = useChainId();
  const stakingAddress = useStakingAddress();

  const {
    data: stakeData,
    isLoading,
    refetch,
  } = useReadContract({
    address: stakingAddress,
    abi: launchpadStakingAbi,
    functionName: 'universeStakes',
    args:
      address && universeId !== undefined ? [address as Address, BigInt(universeId)] : undefined,
    query: { enabled: !!stakingAddress && !!address && universeId !== undefined },
    chainId,
  });

  // universeStakes returns (amount, stakedAt, rewardDebt)
  const parsed = stakeData
    ? {
        amount: (stakeData as any)[0] as bigint,
        amountFormatted: formatEther((stakeData as any)[0] as bigint),
        stakedAt: Number((stakeData as any)[1]),
        rewardDebt: (stakeData as any)[2] as bigint,
      }
    : null;

  return { stake: parsed, isLoading, refetch };
}

/**
 * Read the universe pool info (totalStaked, accRewardPerShare, totalDistributed).
 */
export function useUniversePool(universeId: number | undefined) {
  const chainId = useChainId();
  const stakingAddress = useStakingAddress();

  const {
    data: poolData,
    isLoading,
    refetch,
  } = useReadContract({
    address: stakingAddress,
    abi: launchpadStakingAbi,
    functionName: 'universePools',
    args: universeId !== undefined ? [BigInt(universeId)] : undefined,
    query: { enabled: !!stakingAddress && universeId !== undefined },
    chainId,
  });

  const parsed = poolData
    ? {
        totalStaked: (poolData as any)[0] as bigint,
        totalStakedFormatted: formatEther((poolData as any)[0] as bigint),
        accRewardPerShare: (poolData as any)[1] as bigint,
        totalDistributed: (poolData as any)[2] as bigint,
        totalDistributedFormatted: formatEther((poolData as any)[2] as bigint),
      }
    : null;

  return { pool: parsed, isLoading, refetch };
}

/**
 * Read pending rewards for the current user in a universe pool.
 */
export function usePendingReward(universeId: number | undefined) {
  const { address } = useWalletAccount();
  const chainId = useChainId();
  const stakingAddress = useStakingAddress();

  const {
    data: pending,
    isLoading,
    refetch,
  } = useReadContract({
    address: stakingAddress,
    abi: launchpadStakingAbi,
    functionName: 'pendingUniverseReward',
    args:
      address && universeId !== undefined ? [address as Address, BigInt(universeId)] : undefined,
    query: {
      enabled: !!stakingAddress && !!address && universeId !== undefined,
      refetchInterval: 30_000,
    },
    chainId,
  });

  return {
    pending: pending as bigint | undefined,
    pendingFormatted: pending ? formatEther(pending as bigint) : '0',
    isLoading,
    refetch,
  };
}

/**
 * Read user's $LOAR balance and allowance for the staking contract.
 */
export function useLoarBalance() {
  const { address } = useWalletAccount();
  const chainId = useChainId();
  const loarToken = useLoarTokenAddress();
  const stakingAddress = useStakingAddress();

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: loarToken,
    abi: loarTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address as Address] : undefined,
    query: { enabled: !!loarToken && !!address },
    chainId,
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: loarToken,
    abi: loarTokenAbi,
    functionName: 'allowance',
    args: address && stakingAddress ? [address as Address, stakingAddress] : undefined,
    query: { enabled: !!loarToken && !!address && !!stakingAddress },
    chainId,
  });

  return {
    balance: balance as bigint | undefined,
    balanceFormatted: balance ? formatEther(balance as bigint) : '0',
    allowance: allowance as bigint | undefined,
    refetchBalance,
    refetchAllowance,
  };
}

/**
 * Write: approve $LOAR spending for the staking contract.
 */
export function useApproveLoar() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const loarToken = useLoarTokenAddress();
  const stakingAddress = useStakingAddress();

  const approve = async (amount: bigint) => {
    if (!loarToken || !stakingAddress) throw new Error('Contracts not deployed on this chain');
    const ok = await confirmTx({
      title: 'Approve $LOAR for staking contract',
      chainName: stakingChainName(chainId),
      functionName: 'approve',
      to: loarToken,
      summary: [
        ['Spender (staking)', stakingAddress],
        ['Amount', formatEther(amount)],
      ],
      confirmLabel: 'Approve',
    });
    if (!ok) throw new Error('Cancelled by user');
    await writeContractAsync({
      address: loarToken,
      abi: loarTokenAbi,
      functionName: 'approve',
      args: [stakingAddress, amount],
      chainId,
    });
  };

  return { approve, isPending, error };
}

/**
 * Write: stake $LOAR into a universe pool.
 */
export function useStakeInUniverse() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const stakingAddress = useStakingAddress();

  const stakeInUniverse = async (universeId: number, amount: string) => {
    if (!stakingAddress) throw new Error('Staking not deployed on this chain');
    const ok = await confirmTx({
      title: 'Stake $LOAR in universe pool',
      description: 'Tokens lock until unstake. Early unstake incurs a 5% penalty.',
      chainName: stakingChainName(chainId),
      functionName: 'stakeInUniverse',
      to: stakingAddress,
      summary: [
        ['Universe #', String(universeId)],
        ['Amount staked', `${amount} LOAR`],
      ],
      confirmLabel: 'Stake',
    });
    if (!ok) throw new Error('Cancelled by user');
    await writeContractAsync({
      address: stakingAddress,
      abi: launchpadStakingAbi,
      functionName: 'stakeInUniverse',
      args: [BigInt(universeId), parseEther(amount)],
      chainId,
    });
  };

  return { stakeInUniverse, isPending, error };
}

/**
 * Write: unstake $LOAR from a universe pool.
 */
export function useUnstakeFromUniverse() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const stakingAddress = useStakingAddress();

  const unstakeFromUniverse = async (universeId: number, amount: string) => {
    if (!stakingAddress) throw new Error('Staking not deployed on this chain');
    const ok = await confirmTx({
      title: 'Unstake $LOAR',
      description: 'Early unstake may incur a 5% penalty if still inside the lock window.',
      chainName: stakingChainName(chainId),
      functionName: 'unstakeFromUniverse',
      to: stakingAddress,
      summary: [
        ['Universe #', String(universeId)],
        ['Amount unstaked', `${amount} LOAR`],
      ],
      confirmLabel: 'Unstake',
    });
    if (!ok) throw new Error('Cancelled by user');
    await writeContractAsync({
      address: stakingAddress,
      abi: launchpadStakingAbi,
      functionName: 'unstakeFromUniverse',
      args: [BigInt(universeId), parseEther(amount)],
      chainId,
    });
  };

  return { unstakeFromUniverse, isPending, error };
}

/**
 * Write: claim pending universe staking rewards.
 */
export function useClaimUniverseReward() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const stakingAddress = useStakingAddress();

  const claimReward = async (universeId: number) => {
    if (!stakingAddress) throw new Error('Staking not deployed on this chain');
    await writeContractAsync({
      address: stakingAddress,
      abi: launchpadStakingAbi,
      functionName: 'claimUniverseReward',
      args: [BigInt(universeId)],
      chainId,
    });
  };

  return { claimReward, isPending, error };
}

/**
 * Write: distribute rewards to a universe pool (owner/treasury only).
 */
export function useDistributeUniverseReward() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const stakingAddress = useStakingAddress();

  const distributeReward = async (universeId: number, amount: string) => {
    if (!stakingAddress) throw new Error('Staking not deployed on this chain');
    await writeContractAsync({
      address: stakingAddress,
      abi: launchpadStakingAbi,
      functionName: 'distributeUniverseReward',
      args: [BigInt(universeId), parseEther(amount)],
      chainId,
    });
  };

  return { distributeReward, isPending, error };
}

/**
 * Read the min lock period and penalty rate.
 */
export function useStakingConfig() {
  const chainId = useChainId();
  const stakingAddress = useStakingAddress();

  const { data: minLock } = useReadContract({
    address: stakingAddress,
    abi: launchpadStakingAbi,
    functionName: 'minLockPeriod',
    query: { enabled: !!stakingAddress },
    chainId,
  });

  const { data: penaltyBps } = useReadContract({
    address: stakingAddress,
    abi: launchpadStakingAbi,
    functionName: 'earlyUnstakePenaltyBps',
    query: { enabled: !!stakingAddress },
    chainId,
  });

  return {
    minLockDays: minLock ? Number(minLock as bigint) / 86400 : 7,
    penaltyPercent: penaltyBps ? Number(penaltyBps as unknown as bigint) / 100 : 5,
  };
}
