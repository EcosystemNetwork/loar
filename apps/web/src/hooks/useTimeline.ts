/**
 * Timeline Contract Hooks
 *
 * Wagmi hooks for reading from and writing to the Universe smart contract.
 * Provides typed wrappers around on-chain timeline operations (nodes, media, canon chain).
 * All read hooks resolve the contract address from the current chain ID.
 */

import { useReadContract, useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { universeAbi } from '@loar/abis/generated';
import { TIMELINE_ADDRESSES, type SupportedChainId } from '@/configs/addresses-test';
import { type Address } from 'viem';

/**
 * Returns a function to swap the content (media + plot) between two nodes on-chain.
 * The DAG structure stays intact — only contentHash and plotHash are exchanged.
 * @returns Object with `writeAsync(nodeA, nodeB)` that submits the swapNodes transaction
 */
export function useSwapNodes() {
  const chainId = useChainId();
  const contract = useWriteContract();

  const writeAsync = (nodeA: number, nodeB: number) =>
    contract.writeContractAsync({
      abi: universeAbi,
      address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
      functionName: 'swapNodes',
      args: [BigInt(nodeA), BigInt(nodeB)],
      chainId,
    });

  return { writeAsync };
}
