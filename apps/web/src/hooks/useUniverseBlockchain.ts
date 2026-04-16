/**
 * Universe Blockchain Hooks
 *
 * Custom hooks for fetching and processing blockchain data for a universe timeline.
 * Updated for bytes32 content hash storage (PRD 5).
 * Content hashes are stored on-chain; full URLs/descriptions resolved from Ponder indexer.
 */

import { useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { universeAbi } from '@loar/abis/generated';
import { type Address } from 'viem';
import { ponderGql, ponderQueryDefaults } from '@/utils/ponder-api';

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

/** Ponder nodeContent shape returned by the GraphQL query. */
interface IndexerNodeContent {
  id: string; // "{universeAddress}:{nodeId}"
  contentHash: string;
  plotHash: string;
  videoLink: string;
  plot: string;
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
      retry: 1, // getFullGraph can hit gas limits on large universes
    },
  });
}

/**
 * Paginated graph fetch — use when getFullGraph exceeds gas limits.
 */
export function useUniverseGraphPage(contractAddress?: string, startId = 1, count = 500) {
  return useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'getGraphPage',
    args: [BigInt(startId), BigInt(count)],
    query: {
      enabled: !!contractAddress,
    },
  });
}

function useUniverseCanonChain(contractAddress?: string) {
  // Read currentCanonId first — only fetch the chain when a canon is set.
  // This avoids the CanonNotSet() revert entirely instead of catching it.
  const { data: currentCanonId } = useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'currentCanonId',
    query: {
      enabled: !!contractAddress,
    },
  });

  const hasCanon = currentCanonId != null && BigInt(currentCanonId as any) !== 0n;

  return useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'getCanonChain',
    query: {
      enabled: !!contractAddress && hasCanon,
    },
  });
}

/**
 * Fetch resolved content (video URLs + plot text) from the Ponder indexer
 * for all nodes in a given universe. The indexer captures these from
 * NodeCreated events — they're emitted but not stored on-chain.
 */
function useNodeContents(contractAddress?: string) {
  return useQuery({
    queryKey: ['nodeContents', contractAddress],
    queryFn: async () => {
      if (!contractAddress) return new Map<string, IndexerNodeContent>();

      const addr = contractAddress.toLowerCase();
      // Paginate to handle universes with >1000 nodes
      const map = new Map<string, IndexerNodeContent>();
      let after: string | null = null;
      const PAGE_SIZE = 1000;

      interface NodeContentPage {
        nodeContents: {
          items: IndexerNodeContent[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      }

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page: NodeContentPage = await ponderGql<NodeContentPage>(
          `query($universePrefix: String!, $limit: Int!, $after: String) {
            nodeContents(where: { id_starts_with: $universePrefix }, limit: $limit, after: $after) {
              items { id contentHash plotHash videoLink plot }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { universePrefix: `${addr}:`, limit: PAGE_SIZE, after }
        );

        for (const item of page?.nodeContents?.items || []) {
          const nodeId = item.id.split(':')[1];
          if (nodeId) map.set(nodeId, item);
        }

        if (!page?.nodeContents?.pageInfo?.hasNextPage) break;
        after = page.nodeContents.pageInfo.endCursor;
      }

      return map;
    },
    enabled: !!contractAddress,
    ...ponderQueryDefaults,
  });
}

/**
 * Main hook for managing all blockchain data for a universe.
 * Merges on-chain graph structure with Ponder-resolved content (URLs + descriptions).
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

  // Fetch resolved content from Ponder indexer
  const { data: contentMap } = useNodeContents(contractAddress);

  const graphData = useMemo(() => {
    if (contractAddress && fullGraphData) {
      const [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags] = fullGraphData;

      const hashStrings = (contentHashes || []) as readonly string[];
      const plotHashStrings = (plotHashes || []) as readonly string[];

      // Resolve URLs and descriptions from indexer content map
      const resolvedUrls: string[] = [];
      const resolvedDescriptions: string[] = [];

      for (let i = 0; i < (nodeIds || []).length; i++) {
        const nid = String(nodeIds[i]);
        const content = contentMap?.get(nid);

        // Use indexer-resolved content if available, otherwise fall back to hash
        resolvedUrls.push(content?.videoLink || String(hashStrings[i] || ''));
        resolvedDescriptions.push(content?.plot || String(plotHashStrings[i] || ''));
      }

      return {
        nodeIds: (nodeIds || []) as readonly (string | number | bigint)[],
        contentHashes: hashStrings,
        plotHashes: plotHashStrings,
        urls: resolvedUrls,
        descriptions: resolvedDescriptions,
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
  }, [
    universeId,
    isBlockchainUniverse,
    fullGraphData,
    canonChainData,
    contractAddress,
    contentMap,
  ]);

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
