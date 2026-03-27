import { useReadContract, useWriteContract } from 'wagmi';
import { universeAbi } from '@loar/abis/generated';
import { useChainId } from 'wagmi';
import { TIMELINE_ADDRESSES, type SupportedChainId } from '@/configs/addresses-test';
import { type Address } from 'viem';

//----------READ FUNCTIONS---------
export function useGetNode(id: number) {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId],
    functionName: 'getNode',
    args: [BigInt(id)],
  });
}
export function useGetTimeline(id: number) {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getTimeline',
    args: [BigInt(id)],
  });
}

export function useGetLeaves() {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getLeaves',
  });
}

export function useGetMedia(id: number) {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getMedia',
    args: [BigInt(id)],
  });
}

export function useGetCanonChain() {
  const chainId = useChainId();

  return useReadContract({
    abi: universeAbi,
    address: TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address,
    functionName: 'getCanonChain',
  });
}

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

//-------WRITE FUNCTIONS--------

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

export function useCreateNode() {
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
      address: TIMELINE_ADDRESSES[11155111],
      functionName: 'createNode',
      args: [contentHash, plotHash, BigInt(previous), link, plot],
      chainId: 11155111,
    });

  return { writeAsync };
}

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
