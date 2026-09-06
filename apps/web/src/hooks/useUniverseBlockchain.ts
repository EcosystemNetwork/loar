/**
 * Universe Blockchain Hooks
 *
 * Custom hooks for fetching and processing blockchain data for a universe timeline.
 * Updated for bytes32 content hash storage (PRD 5).
 * Content hashes are stored on-chain; full URLs/descriptions resolved from Ponder indexer.
 */

import { useMemo } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { universeAbi } from '@loar/abis/generated';
import { type Address } from 'viem';
import { ponderGql, ponderQueryDefaults } from '@/utils/ponder-api';
import { trpcClient } from '@/utils/trpc';
import {
  type GraphFetchFailureReason,
  type RawGraphTuple,
  classifyGraphFetchFailure,
  mergeGraphPages,
  planGraphPages,
  shouldPaginateGraph,
} from './universeGraphPaging';
import { type GraphData, type IndexerNodeContent, buildGraphData } from './universeGraphData';

// Re-exported for back-compat: callers still `import { type GraphData } from
// '@/hooks/useUniverseBlockchain'`. The merge logic itself lives in
// universeGraphData.ts (pure, unit-tested).
export type { GraphData, IndexerNodeContent };

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
  isLoadingOffChain: boolean;
  isLoadingAny: boolean;

  // Error states
  isError: boolean;
  graphError: Error | null;
  /**
   * Why the graph fetch failed, so callers can show a specific message
   * instead of a generic "couldn't load, try again" — see
   * `classifyGraphFetchFailure()` in `universeGraphPaging.ts` for what each
   * value means. Always `'none'` when `isError` is false.
   */
  graphErrorReason: GraphFetchFailureReason;

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

/**
 * Fetches the on-chain node graph, transparently falling back to paginated
 * `getGraphPage()` reads once a universe outgrows `getFullGraph()`'s
 * hardcoded cap (`Universe.sol`: `require(latestNodeId <= 500, ...)`).
 *
 * Before this fix, only `getFullGraph()` was ever called — any universe over
 * the cap got a guaranteed on-chain revert on every load, with no fallback
 * and (upstream in `useUniverseBlockchain`) no error ever surfaced to the
 * UI: the timeline editor, event pages, and the branching player all just
 * rendered a permanently empty graph with zero indication anything had
 * failed. `failureReason` lets callers tell a transient RPC hiccup (safe to
 * retry as-is) apart from a universe whose *contract* doesn't support
 * pagination at all (see the field's own doc comment).
 *
 * `latestNodeId` must come from a read the caller already has independently
 * (see `useUniverseBlockchain` below) — `undefined` means "not loaded yet".
 * While unknown, this optimistically attempts the direct call (cheap, and
 * correct for the overwhelming majority of universes); if it later resolves
 * to a value over the cap, the paginated branch takes over and the direct
 * call's now-irrelevant (always-reverting) result is ignored.
 */
function useUniverseFullGraph(contractAddress?: string, latestNodeId?: number) {
  const latestNodeIdKnown = latestNodeId !== undefined;
  const needsPagination = latestNodeIdKnown && shouldPaginateGraph(latestNodeId);

  const direct = useReadContract({
    abi: universeAbi,
    address: (contractAddress || '0x') as Address,
    functionName: 'getFullGraph',
    query: {
      enabled: !!contractAddress && !needsPagination,
      retry: 1, // getFullGraph can hit gas limits on large universes
    },
  });

  // planGraphPages() is pure and cheap, but memoize anyway so the
  // `contracts` array passed to useReadContracts stays referentially stable
  // across renders where nothing actually changed (wagmi/react-query key off
  // this array's contents, but a fresh array identity every render is still
  // wasted work for a query with potentially several page calls in it).
  const pageRequests = useMemo(
    () => (needsPagination ? planGraphPages(latestNodeId as number) : []),
    [needsPagination, latestNodeId]
  );

  const paged = useReadContracts({
    contracts: pageRequests.map(({ startId, count }) => ({
      abi: universeAbi,
      address: (contractAddress || '0x') as Address,
      functionName: 'getGraphPage',
      args: [BigInt(startId), BigInt(count)],
    })),
    // All-or-nothing: a single failed page means the merged graph would be
    // missing nodes that surviving pages' previousNodes/children arrays
    // still reference — a corrupt partial graph is worse than a clear error.
    allowFailure: false,
    query: {
      enabled: !!contractAddress && needsPagination && pageRequests.length > 0,
      retry: 1,
    },
  });

  const isLoading = needsPagination ? paged.isLoading : direct.isLoading;
  const isError = needsPagination ? paged.isError : direct.isError;
  const error = needsPagination ? paged.error : direct.error;
  const refetch = needsPagination ? paged.refetch : direct.refetch;

  const data = useMemo(() => {
    if (!needsPagination) return direct.data;
    if (!paged.data) return undefined;
    return mergeGraphPages(paged.data as unknown as RawGraphTuple[]);
  }, [needsPagination, direct.data, paged.data]);

  return {
    data,
    isLoading,
    isError,
    error,
    /** See classifyGraphFetchFailure()'s doc comment for what each value means. */
    failureReason: classifyGraphFetchFailure(isError, needsPagination),
    refetch,
  };
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

  // Read independently of getFullGraph/getGraphPage — this is what decides
  // *which* of those two to use (see useUniverseFullGraph's doc comment), so
  // it must not depend on either succeeding first.
  const { data: latestNodeIdData, refetch: refetchLatestNodeId } = useReadContract({
    abi: universeAbi,
    address: onChainContractAddress as Address,
    functionName: 'latestNodeId',
    query: {
      enabled: !!onChainContractAddress,
    },
  });
  const latestNodeIdKnown = latestNodeIdData !== undefined;
  const latestNodeId = latestNodeIdKnown ? Number(latestNodeIdData) : 0;

  const {
    data: fullGraphData,
    isLoading: isLoadingFullGraph,
    isError: isGraphError,
    error: graphFetchError,
    failureReason: graphErrorReason,
    refetch: refetchFullGraph,
  } = useUniverseFullGraph(onChainContractAddress, latestNodeIdKnown ? latestNodeId : undefined);
  const {
    data: canonChainData,
    isLoading: isLoadingCanonChain,
    refetch: refetchCanonChain,
  } = useUniverseCanonChain(onChainContractAddress);

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
  const {
    data: offChainData,
    isLoading: rqIsLoadingOffChain,
    status: offChainStatus,
  } = useQuery({
    queryKey: ['offChainNodes', universeId],
    queryFn: () => trpcClient.offChainNodes.list.query({ universeId }),
    enabled: !!universeId && useOffChain,
    staleTime: 30_000,
  });
  // react-query's `isLoading` is `isPending && isFetching`, so on the single
  // render where this query flips disabled→enabled (the universe doc just
  // resolved `isOnChain` to false for a 0x-looking fun-mode id) it's still
  // `false` — the fetch hasn't been kicked off yet. That one frame let the
  // canvas mount with zero nodes before the off-chain list arrived, reading
  // as the timeline loading, blanking, then re-populating. Treat "enabled but
  // not yet settled" as loading. The query is guaranteed to settle (success
  // or error) whenever `useOffChain` is true, so this can't hang.
  const isLoadingOffChain =
    rqIsLoadingOffChain || (useOffChain && !!universeId && offChainStatus === 'pending');

  // Strict on-chain vs off-chain merge — pure logic in universeGraphData.ts
  // (unit-tested there). `universeId` stays in the dep list purely so a
  // universe switch re-derives even if every other input is momentarily
  // referentially stale.
  const graphData = useMemo(
    () =>
      buildGraphData({
        useOnChain,
        onChainContractAddress,
        fullGraphData: fullGraphData as Parameters<typeof buildGraphData>[0]['fullGraphData'],
        canonChainData: canonChainData as readonly (string | number | bigint)[] | undefined,
        contentMap,
        mediaOverrides,
        offChainNodes: offChainData?.nodes as readonly any[] | undefined,
      }),
    [
      universeId,
      useOnChain,
      onChainContractAddress,
      fullGraphData,
      canonChainData,
      contentMap,
      mediaOverrides,
      offChainData,
    ]
  );

  // Include off-chain loading so callers waiting on `isLoadingAny` don't
  // release their loading UI before the off-chain fetch (offChainNodes.list)
  // has resolved for universes whose id happens to look like a 0x address
  // but aren't actually on-chain (see universe/$id.tsx's loading guard,
  // which used to key off the static `id.startsWith('0x')` heuristic and
  // let the canvas render empty before this query even started — reported
  // as nodes "disappearing right away").
  const isLoadingAny =
    isLoadingLeaves || isLoadingFullGraph || isLoadingCanonChain || isLoadingOffChain;

  // Only surface on-chain graph errors when we're actually in on-chain mode.
  // While the universe doc is still loading, `isOnChain` is undefined and this
  // hook runs on-chain reads against the raw universe id. For an off-chain
  // fun-mode universe with a 0x-looking id that isn't a deployed contract,
  // those reads settle to an error — and react-query keeps that errored state
  // even after the query is disabled once the doc resolves the universe as
  // off-chain. That stale error used to blank the editor (its `isGraphError`
  // screen) for such universes whenever the doc read was slow enough to lose
  // the race (e.g. a large lore blob). Once `useOnChain` is false the active
  // data source is the off-chain node list, which has its own error handling.
  const graphErrorActive = useOnChain && isGraphError;

  return {
    graphData,
    latestNodeId,
    leavesData,
    isLoadingLeaves,
    isLoadingFullGraph,
    isLoadingCanonChain,
    isLoadingOffChain,
    isLoadingAny,
    isError: graphErrorActive,
    graphError: graphErrorActive ? (graphFetchError ?? null) : null,
    graphErrorReason: graphErrorActive ? graphErrorReason : 'none',
    refetchLeaves,
    refetchFullGraph,
    refetchCanonChain,
    refetchLatestNodeId,
  };
}
