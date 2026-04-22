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
import { trpcClient } from '@/utils/trpc';

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
  /**
   * True if this universe was actually deployed on-chain via UniverseManager
   * (i.e., the universe doc has `onChainUniverseId` set). Distinguishes real
   * on-chain universes from off-chain "fun mode" universes that happen to
   * have `0x...` document IDs.
   *
   * - true  → ONLY read on-chain nodes (never fall back to off-chain)
   * - false → ONLY read off-chain Firestore nodes (skip on-chain entirely)
   */
  isOnChain?: boolean;
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

  // Error states
  isError: boolean;
  graphError: Error | null;

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
  isOnChain,
}: UseUniverseBlockchainProps): UseUniverseBlockchainReturn {
  // Strict mode: when isOnChain is explicitly false, this is a fun-mode
  // universe → never call the on-chain contract. When undefined, fall back
  // to the legacy isBlockchainUniverse heuristic for backwards compat.
  const useOnChain = isOnChain === undefined ? isBlockchainUniverse : isOnChain;
  const useOffChain = isOnChain === undefined ? !isBlockchainUniverse : !isOnChain;
  const onChainContractAddress = useOnChain ? contractAddress : undefined;
  const {
    data: leavesData,
    isLoading: isLoadingLeaves,
    refetch: refetchLeaves,
  } = useUniverseLeaves(onChainContractAddress);
  const {
    data: fullGraphData,
    isLoading: isLoadingFullGraph,
    isError: isGraphError,
    error: graphFetchError,
    refetch: refetchFullGraph,
  } = useUniverseFullGraph(onChainContractAddress);
  const {
    data: canonChainData,
    isLoading: isLoadingCanonChain,
    refetch: refetchCanonChain,
  } = useUniverseCanonChain(onChainContractAddress);

  const { data: latestNodeIdData, refetch: refetchLatestNodeId } = useReadContract({
    abi: universeAbi,
    address: onChainContractAddress as Address,
    functionName: 'latestNodeId',
    query: {
      enabled: !!onChainContractAddress,
    },
  });

  const latestNodeId = latestNodeIdData ? Number(latestNodeIdData) : 0;

  // Fetch resolved content from Ponder indexer (on-chain only)
  const { data: contentMap } = useNodeContents(onChainContractAddress);

  // Off-chain media URL overrides (for nodes whose event-emitted link has
  // rotted — e.g. expired signed URLs). Server-side writes are gated to the
  // universe admin; reads are public. When an override exists for a nodeId,
  // it takes precedence over Ponder's event-derived videoLink. An override
  // with `hidden: true` drops the node from the rendered timeline entirely —
  // used when the original content is unrecoverable.
  const { data: mediaOverrides } = useQuery({
    queryKey: ['nodeMediaOverrides', onChainContractAddress],
    queryFn: async () => {
      if (!onChainContractAddress)
        return {} as Record<number, { videoLink?: string; hidden?: boolean }>;
      const res = await trpcClient.nodeMedia.list.query({ universeId: onChainContractAddress });
      return (res?.overrides ?? {}) as Record<number, { videoLink?: string; hidden?: boolean }>;
    },
    enabled: !!onChainContractAddress,
    staleTime: 30_000,
  });

  // ── Off-chain timeline nodes (Fun-Mode universes) ──
  // Only loads when this universe is explicitly off-chain. On-chain universes
  // never fall back to off-chain — keeps data sources strictly separated.
  const { data: offChainData } = useQuery({
    queryKey: ['offChainNodes', universeId],
    queryFn: () => trpcClient.offChainNodes.list.query({ universeId }),
    enabled: !!universeId && useOffChain,
    staleTime: 30_000,
  });

  const graphData = useMemo(() => {
    // ── On-chain branch ──
    // Strict: ONLY runs for actual on-chain universes. Off-chain nodes are
    // never merged in here; an on-chain universe with zero nodes shows zero.
    if (useOnChain) {
      if (onChainContractAddress && fullGraphData) {
        const [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags] = fullGraphData;

        const rawNodeIds = (nodeIds || []) as readonly (string | number | bigint)[];
        const hashStrings = (contentHashes || []) as readonly string[];
        const plotHashStrings = (plotHashes || []) as readonly string[];
        const rawPrevious = (previousIds || []) as readonly (string | number | bigint)[];
        const rawChildren = (nextIds || []) as readonly (string | number | bigint)[][];
        const rawFlags = (flags || []) as readonly boolean[];

        // Nodes with an override marked `hidden: true` are dropped from the
        // rendered graph (used when content is unrecoverable). We re-index the
        // parallel arrays and strip references to hidden nodeIds from every
        // `children` list and from `previousNodes` — so surviving nodes whose
        // parent was hidden render as roots rather than pointing into the void.
        const hiddenIdSet = new Set<string>();
        for (let i = 0; i < rawNodeIds.length; i++) {
          const nid = String(rawNodeIds[i]);
          if (mediaOverrides?.[Number(nid)]?.hidden) hiddenIdSet.add(nid);
        }

        const keptIndices: number[] = [];
        for (let i = 0; i < rawNodeIds.length; i++) {
          if (!hiddenIdSet.has(String(rawNodeIds[i]))) keptIndices.push(i);
        }

        const resolvedUrls: string[] = [];
        const resolvedDescriptions: string[] = [];
        const keptNodeIds: (string | number | bigint)[] = [];
        const keptContentHashes: string[] = [];
        const keptPlotHashes: string[] = [];
        const keptPrevious: (string | number | bigint)[] = [];
        const keptChildren: (string | number | bigint)[][] = [];
        const keptFlags: boolean[] = [];

        for (const i of keptIndices) {
          const nid = String(rawNodeIds[i]);
          const content = contentMap?.get(nid);
          const override = mediaOverrides?.[Number(nid)];

          // Prefer off-chain override → indexer → on-chain hash fallback
          resolvedUrls.push(
            override?.videoLink || content?.videoLink || String(hashStrings[i] || '')
          );
          resolvedDescriptions.push(content?.plot || String(plotHashStrings[i] || ''));
          keptNodeIds.push(rawNodeIds[i]);
          keptContentHashes.push(String(hashStrings[i] || ''));
          keptPlotHashes.push(String(plotHashStrings[i] || ''));
          // Drop the parent pointer if it refers to a hidden node so the
          // survivor renders as a root instead of pointing at a ghost.
          const prev = rawPrevious[i];
          keptPrevious.push(hiddenIdSet.has(String(prev)) ? '' : prev);
          keptChildren.push((rawChildren[i] || []).filter((c) => !hiddenIdSet.has(String(c))));
          keptFlags.push(Boolean(rawFlags[i]));
        }

        return {
          nodeIds: keptNodeIds as readonly (string | number | bigint)[],
          contentHashes: keptContentHashes as readonly string[],
          plotHashes: keptPlotHashes as readonly string[],
          urls: resolvedUrls,
          descriptions: resolvedDescriptions,
          previousNodes: keptPrevious as readonly (string | number | bigint)[],
          children: keptChildren as readonly (string | number | bigint)[][],
          flags: keptFlags as readonly boolean[],
          canonChain: ((canonChainData || []) as readonly (string | number | bigint)[]).filter(
            (c) => !hiddenIdSet.has(String(c))
          ),
        };
      }

      // On-chain universe but graph not loaded yet (or genuinely empty)
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
    }

    // ── Off-chain branch ──
    // Strict: ONLY runs for fun-mode universes. Never reads on-chain data.
    if (offChainData?.nodes && offChainData.nodes.length > 0) {
      const nodes = offChainData.nodes as any[];
      const nodeIds = nodes.map((n) => String(n.nodeId));
      const contentHashes = nodes.map((n) => String(n.contentHash || ''));
      const plotHashes = nodes.map((n) => String(n.plotHash || ''));
      const urls = nodes.map((n) => String(n.videoUrl || ''));
      const descriptions = nodes.map((n) => String(n.title || n.plot || ''));
      const previousNodes = nodes.map((n) => String(n.previousNodeId || 0));
      const children = nodes.map((n) =>
        Array.isArray(n.children) ? (n.children as number[]).map((c) => String(c)) : []
      );
      const flags = nodes.map((n) => Boolean(n.canon));
      const canonChain = nodes.filter((n) => n.canon).map((n) => String(n.nodeId));

      return {
        nodeIds: nodeIds as readonly (string | number | bigint)[],
        contentHashes: contentHashes as readonly string[],
        plotHashes: plotHashes as readonly string[],
        urls: urls as readonly string[],
        descriptions: descriptions as readonly string[],
        previousNodes: previousNodes as readonly (string | number | bigint)[],
        children: children as readonly (string | number | bigint)[][],
        flags: flags as readonly boolean[],
        canonChain: canonChain as readonly (string | number | bigint)[],
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
    useOnChain,
    onChainContractAddress,
    fullGraphData,
    canonChainData,
    contentMap,
    mediaOverrides,
    offChainData,
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
    isError: isGraphError,
    graphError: graphFetchError ?? null,
    refetchLeaves,
    refetchFullGraph,
    refetchCanonChain,
    refetchLatestNodeId,
  };
}
