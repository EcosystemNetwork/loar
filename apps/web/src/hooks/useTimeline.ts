/**
 * Timeline Contract Hooks
 *
 * Wagmi hooks for reading from and writing to the Universe smart contract.
 * Provides typed wrappers around on-chain timeline operations (nodes, media, canon chain).
 * All read hooks resolve the contract address from the current chain ID.
 */

import { useReadContract, useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { universeAbi } from '@loar/abis/generated';
import { TIMELINE_ADDRESSES, type SupportedChainId } from '@/configs/addresses-test';
import { type Address } from 'viem';

// ---- Read Hooks ----

/**
 * Fetches a single node by its on-chain ID.
 * @param id - Numeric node identifier
 * @returns Wagmi read contract result with node data
 */
export function useGetNode(id: number) {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId],
    functionName: 'getNode',
    args: [BigInt(id)],
  });
}

/**
 * Fetches the full timeline chain starting from a given node ID.
 * @param id - Starting node identifier
 * @returns Wagmi read contract result with timeline data
 */
export function useGetTimeline(id: number) {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getTimeline',
    args: [BigInt(id)],
  });
}

/**
 * Fetches all leaf nodes (nodes with no children) from the timeline.
 * @returns Wagmi read contract result with an array of leaf node IDs
 */
export function useGetLeaves() {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getLeaves',
  });
}

/**
 * Fetches media metadata (content hash and link) for a given node.
 * @param id - Numeric node identifier
 * @returns Wagmi read contract result with media data
 */
export function useGetMedia(id: number) {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getMedia',
    args: [BigInt(id)],
  });
}

/**
 * Fetches the canonical chain -- the governance-approved main narrative path.
 * @returns Wagmi read contract result with an ordered array of canon node IDs
 */
export function useGetCanonChain() {
  const chainId = useChainId();
  const address = TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address;

  // Read currentCanonId first — only fetch the chain when a canon is set.
  // This avoids the CanonNotSet() revert entirely.
  const { data: currentCanonId } = useReadContract({
    abi: universeAbi,
    address,
    functionName: 'currentCanonId',
  });

  const hasCanon = currentCanonId != null && BigInt(currentCanonId as any) !== 0n;

  return useReadContract({
    abi: universeAbi,
    address,
    functionName: 'getCanonChain',
    query: {
      enabled: hasCanon,
    },
  });
}

/**
 * Fetches the complete graph structure (all nodes, edges, and canon flags).
 * @param timelineAddress - Optional override for the Universe contract address
 * @returns Wagmi read contract result with the full graph tuple
 */
export function useGetFullGraph(timelineAddress?: string) {
  const chainId = useChainId();

  // Use provided address or fall back to default
  const address = timelineAddress || TIMELINE_ADDRESSES[chainId as SupportedChainId];

  return useReadContract({
    abi: universeAbi,
    address: address as Address,
    functionName: 'getFullGraph',
    query: {
      enabled: !!address,
    },
  });
}

// ---- Write Hooks ----

/**
 * Returns a function to set a node as the canonical continuation of the timeline.
 * @returns Object with `writeAsync(id)` that submits the setCanon transaction
 */
export function useSetCanon() {
  const chainId = useChainId();
  const contract = useWriteContract();

  const writeAsync = (id: number) =>
    contract.writeContractAsync({
      abi: universeAbi,
      address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
      functionName: 'setCanon',
      args: [BigInt(id)],
    });

  return { writeAsync };
}

/**
 * Returns a function to create a new narrative node on-chain.
 * Uses the currently connected chain.
 * @returns Object with `writeAsync(contentHash, plotHash, previous, link, plot)`
 */
export function useCreateNode() {
  const chainId = useChainId();
  const contract = useWriteContract();

  const writeAsync = (
    contentHash: `0x${string}`,
    plotHash: `0x${string}`,
    previous: number,
    link: string,
    plot: string
  ) =>
    contract.writeContractAsync({
      abi: universeAbi,
      address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as `0x${string}`,
      functionName: 'createNode',
      args: [contentHash, plotHash, BigInt(previous), link, plot],
      chainId,
    });

  return { writeAsync };
}

/**
 * Returns a function to update media (video link + content hash) on an existing node.
 * @returns Object with `writeAsync(id, contentHash, link)`
 */
export function useSetMedia() {
  const chainId = useChainId();
  const contract = useWriteContract();

  const writeAsync = (id: number, contentHash: `0x${string}`, link: string) =>
    contract.writeContractAsync({
      abi: universeAbi,
      address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
      functionName: 'setMedia',
      args: [BigInt(id), contentHash, link],
    });

  return { writeAsync };
}

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
    });

  return { writeAsync };
}
