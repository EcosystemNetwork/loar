/**
 * Universe Blockchain Hooks
 *
 * Custom hooks for fetching and processing blockchain data for a universe timeline.
 * Updated for bytes32 content hash storage (PRD 5).
 * Content hashes are stored on-chain; full URLs/descriptions are resolved via indexer or storage API.
 */

import { useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { universeAbi } from '@loar/abis/generated';
import { type Address } from 'viem';

export interface GraphData {
  nodeIds: readonly (string | number | bigint)[];
  contentHashes: readonly string[]; // bytes32 content hashes from chain
  plotHashes: readonly string[]; // bytes32 plot hashes from chain
  urls: readonly string[]; // Resolved URLs (from indexer/storage)
  descriptions: readonly string[]; // Resolved descriptions (from indexer/storage)
  previousNodes: readonly (string | number | bigint)[];
  children: readonly (string | number | bigint)[][];
  flags: readonly boolean[];
  canonChain: readonly (string | number | bigint)[];
}

export interface UseUniverseBlockchainProps {
  universeId: string;
  contractAddress?: string;
  isBlockchainUniverse: boolean;
}

export interface UseUniverseBlockchainReturn {
  // Data
  graphData: GraphData;
  latestNodeId: number;
  leavesData: any;

  // Loading states
  isLoadingLeaves: boolean;
  isLoadingFullGraph: boolean;
  isLoadingCanonChain: boolean;
  isLoadingAny: boolean;

  // Refetch functions
  refetchLeaves: () => Promise<any>;
  refetchFullGraph: () => Promise<any>;
  refetchCanonChain: () => Promise<any>;
  refetchLatestNodeId: () => Promise<any>;
}

function useUniverseLeaves(contractAddress?: string) {
  return useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'getLeaves',
    query: {
      enabled: !!contractAddress,
    },
  });
}

function useUniverseFullGraph(contractAddress?: string) {
  return useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'getFullGraph',
    query: {
      enabled: !!contractAddress,
    },
  });
}

function useUniverseCanonChain(contractAddress?: string) {
  return useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'getCanonChain',
    query: {
      enabled: !!contractAddress,
      retry: false, // CanonNotSet() revert is expected when no canon has been set
    },
  });
}

/**
 * Main hook for managing all blockchain data for a universe.
 * Now works with bytes32 content hashes instead of raw strings.
 */
export function useUniverseBlockchain({
  universeId,
  contractAddress,
  isBlockchainUniverse,
}: UseUniverseBlockchainProps): UseUniverseBlockchainReturn {
  const {
    data: leavesData,
    isLoading: isLoadingLeaves,
    refetch: refetchLeaves,
  } = useUniverseLeaves(contractAddress);
  const {
    data: fullGraphData,
    isLoading: isLoadingFullGraph,
    refetch: refetchFullGraph,
  } = useUniverseFullGraph(contractAddress);
  const {
    data: canonChainData,
    isLoading: isLoadingCanonChain,
    refetch: refetchCanonChain,
  } = useUniverseCanonChain(contractAddress);

  const { data: latestNodeIdData, refetch: refetchLatestNodeId } = useReadContract({
    abi: universeAbi,
    address: contractAddress as Address,
    functionName: 'latestNodeId',
    query: {
      enabled: !!contractAddress && isBlockchainUniverse,
    },
  });

  const latestNodeId = latestNodeIdData ? Number(latestNodeIdData) : 0;

  const graphData = useMemo(() => {
    if (contractAddress && fullGraphData) {
      // getFullGraph now returns: (uint[] ids, bytes32[] contentHashes, bytes32[] plotHashes, uint[] previousIds, uint[][] nextIds, bool[] canonFlags)
      const [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags] = fullGraphData;

      // Content hashes and plot hashes are bytes32 on-chain.
      // The actual URLs and plot text are stored off-chain (indexer captures from events).
      // For now, pass the hashes through; the UI will resolve via indexer data or storage.resolve().
      const hashStrings = (contentHashes || []) as readonly string[];
      const plotHashStrings = (plotHashes || []) as readonly string[];

      return {
        nodeIds: (nodeIds || []) as readonly (string | number | bigint)[],
        contentHashes: hashStrings,
        plotHashes: plotHashStrings,
        urls: hashStrings, // Placeholder — resolved by the page component
        descriptions: plotHashStrings, // Placeholder — resolved by the page component
        previousNodes: (previousIds || []) as readonly (string | number | bigint)[],
        children: (nextIds || []) as readonly (string | number | bigint)[][],
        flags: flags || [],
        canonChain: (canonChainData || []) as readonly (string | number | bigint)[],
      };
    }

    return {
      nodeIds: [],
      contentHashes: [],
      plotHashes: [],
      urls: [],
      descriptions: [],
      previousNodes: [],
      children: [],
      flags: [],
      canonChain: [],
    };
  }, [universeId, isBlockchainUniverse, fullGraphData, canonChainData, contractAddress]);

  const isLoadingAny = isLoadingLeaves || isLoadingFullGraph || isLoadingCanonChain;

  return {
    graphData,
    latestNodeId,
    leavesData,
    isLoadingLeaves,
    isLoadingFullGraph,
    isLoadingCanonChain,
    isLoadingAny,
    refetchLeaves,
    refetchFullGraph,
    refetchCanonChain,
    refetchLatestNodeId,
  };
}
