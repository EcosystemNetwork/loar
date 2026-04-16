/**
 * useLPYield — hooks for reading LP reward config and fee data from on-chain contracts.
 *
 * Reads from:
 * - LoarLpLockerMultiple: reward recipients, bps splits, admins
 * - LoarFeeLocker: claimable fees per recipient
 * - Provides write helpers for updateRewardRecipient and collectRewards
 */
import { useReadContract, useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { loarLpLockerMultipleAbi, loarFeeLockerAbi } from '@loar/abis/generated';
import { LoarLpLockerMultiple, LoarFeeLocker } from '@loar/abis/addresses';
import { formatEther, type Address } from 'viem';

/**
 * Read the reward configuration for a universe token from the LP locker.
 */
export function useLPRewardConfig(tokenAddress: Address | undefined) {
  const chainId = useChainId();
  const lockerAddress = LoarLpLockerMultiple[
    String(chainId) as keyof typeof LoarLpLockerMultiple
  ] as Address | undefined;

  const {
    data: rewardInfo,
    isLoading,
    refetch,
  } = useReadContract({
    address: lockerAddress,
    abi: loarLpLockerMultipleAbi,
    functionName: 'tokenRewards',
    args: tokenAddress ? [tokenAddress] : undefined,
    query: { enabled: !!lockerAddress && !!tokenAddress },
    chainId,
  });

  // Parse the reward info tuple
  const parsed = rewardInfo
    ? {
        rewardAdmins: (rewardInfo as any)[0] as Address[],
        rewardRecipients: (rewardInfo as any)[1] as Address[],
        rewardBps: ((rewardInfo as any)[2] as bigint[]).map(Number),
      }
    : null;

  return { rewardConfig: parsed, isLoading, refetch };
}

/**
 * Read claimable fees for an address from the fee locker.
 */
export function useClaimableFees(
  recipientAddress: Address | undefined,
  tokenAddress: Address | undefined
) {
  const chainId = useChainId();
  const feeLockerAddress = LoarFeeLocker[String(chainId) as keyof typeof LoarFeeLocker] as
    | Address
    | undefined;

  const {
    data: fees,
    isLoading,
    refetch,
  } = useReadContract({
    address: feeLockerAddress,
    abi: loarFeeLockerAbi,
    functionName: 'availableFees',
    args: recipientAddress && tokenAddress ? [recipientAddress, tokenAddress] : undefined,
    query: { enabled: !!feeLockerAddress && !!recipientAddress && !!tokenAddress },
    chainId,
  });

  return {
    claimableFees: fees as bigint | undefined,
    claimableFeesFormatted: fees ? formatEther(fees as bigint) : '0',
    isLoading,
    refetch,
  };
}

/**
 * Write: update a reward recipient on the LP locker.
 * Caller must be the rewardAdmin for the given index.
 */
export function useUpdateRewardRecipient() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const lockerAddress = LoarLpLockerMultiple[
    String(chainId) as keyof typeof LoarLpLockerMultiple
  ] as Address | undefined;

  const updateRecipient = async (
    tokenAddress: Address,
    rewardIndex: number,
    newRecipient: Address
  ) => {
    if (!lockerAddress) throw new Error('LP Locker not deployed on this chain');
    await writeContractAsync({
      address: lockerAddress,
      abi: loarLpLockerMultipleAbi,
      functionName: 'updateRewardRecipient',
      args: [tokenAddress, BigInt(rewardIndex), newRecipient],
      chainId,
    });
  };

  return { updateRecipient, isPending, error };
}

/**
 * Write: collect accumulated swap fees for a token.
 * Anyone can call this — fees go to configured recipients via the fee locker.
 */
export function useCollectRewards() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const lockerAddress = LoarLpLockerMultiple[
    String(chainId) as keyof typeof LoarLpLockerMultiple
  ] as Address | undefined;

  const collectRewards = async (tokenAddress: Address) => {
    if (!lockerAddress) throw new Error('LP Locker not deployed on this chain');
    await writeContractAsync({
      address: lockerAddress,
      abi: loarLpLockerMultipleAbi,
      functionName: 'collectRewards',
      args: [tokenAddress],
      chainId,
    });
  };

  return { collectRewards, isPending, error };
}

/**
 * Write: claim fees from the fee locker.
 * Only the fee recipient can call this.
 */
export function useClaimFees() {
  const chainId = useChainId();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const feeLockerAddress = LoarFeeLocker[String(chainId) as keyof typeof LoarFeeLocker] as
    | Address
    | undefined;

  const claimFees = async (tokenAddress: Address) => {
    if (!feeLockerAddress) throw new Error('Fee Locker not deployed on this chain');
    await writeContractAsync({
      address: feeLockerAddress,
      abi: loarFeeLockerAbi,
      functionName: 'claim',
      args: [tokenAddress],
      chainId,
    });
  };

  return { claimFees, isPending, error };
}
