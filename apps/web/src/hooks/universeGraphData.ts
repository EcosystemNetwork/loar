/**
 * universeGraphData — pure graph-merge logic for the universe timeline.
 *
 * Extracted from useUniverseBlockchain so the on-chain / off-chain merge
 * (hidden-override filtering, the "never hide the whole graph" guard,
 * override→indexer→on-chain-hash URL precedence, parent-pointer rewriting
 * when a parent is hidden, canon-chain filtering, off-chain field mapping)
 * can be unit-tested without wagmi / react-query / React.
 *
 * useUniverseBlockchain's `graphData` useMemo is now a thin call into
 * `buildGraphData()`.
 */

export interface GraphData {
  nodeIds: readonly (string | number | bigint)[];
  contentHashes: readonly string[]; // bytes32 content hashes from chain
  plotHashes: readonly string[]; // bytes32 plot hashes from chain
  urls: readonly string[]; // Resolved URLs (from indexer/storage/override)
  descriptions: readonly string[]; // Resolved descriptions (from indexer/storage)
  previousNodes: readonly (string | number | bigint)[];
  children: readonly (string | number | bigint)[][];
  flags: readonly boolean[];
  canonChain: readonly (string | number | bigint)[];
}

/** Ponder nodeContent shape (subset used by the merge). */
export interface IndexerNodeContent {
  id: string; // "{universeAddress}:{nodeId}"
  contentHash: string;
  plotHash: string;
  videoLink: string;
  plot: string;
}

export interface NodeMediaOverride {
  videoLink?: string;
  hidden?: boolean;
}

/** Raw getFullGraph()/getGraphPage() tuple: [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags]. */
export type RawFullGraph = readonly [
  readonly (string | number | bigint)[] | undefined,
  readonly string[] | undefined,
  readonly string[] | undefined,
  readonly (string | number | bigint)[] | undefined,
  readonly (string | number | bigint)[][] | undefined,
  readonly boolean[] | undefined,
];

// Frozen so a consumer that accidentally mutates `graphData.*` (all current
// callers only read: forEach/map/filter/every/some/spread) fails loudly in
// dev instead of corrupting the shared empty across renders.
export const EMPTY_GRAPH_DATA: GraphData = Object.freeze({
  nodeIds: Object.freeze([]),
  contentHashes: Object.freeze([]),
  plotHashes: Object.freeze([]),
  urls: Object.freeze([]),
  descriptions: Object.freeze([]),
  previousNodes: Object.freeze([]),
  children: Object.freeze([]),
  flags: Object.freeze([]),
  canonChain: Object.freeze([]),
}) as GraphData;

/**
 * Merge an on-chain getFullGraph tuple with Ponder-indexed content and
 * off-chain per-node media overrides.
 *
 * URL precedence per node: override.videoLink → indexer.videoLink →
 * on-chain contentHash (bytes32) as a last-ditch string.
 * Description precedence: indexer.plot → on-chain plotHash (bytes32).
 *
 * A node whose override has `hidden: true` is dropped, and every reference
 * to it (in another node's `children`, in `previousNodes`, in the canon
 * chain) is stripped so survivors don't dangle. The one exception: if
 * *every* node would be hidden, the hidden set is ignored so the caller
 * never renders an empty canvas with no error.
 */
export function buildOnChainGraphData(
  fullGraphData: RawFullGraph,
  canonChainData: readonly (string | number | bigint)[] | undefined,
  contentMap: Map<string, IndexerNodeContent> | undefined,
  mediaOverrides: Record<number, NodeMediaOverride> | undefined
): GraphData {
  const [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags] = fullGraphData;

  const rawNodeIds = (nodeIds || []) as readonly (string | number | bigint)[];
  const hashStrings = (contentHashes || []) as readonly string[];
  const plotHashStrings = (plotHashes || []) as readonly string[];
  const rawPrevious = (previousIds || []) as readonly (string | number | bigint)[];
  const rawChildren = (nextIds || []) as readonly (string | number | bigint)[][];
  const rawFlags = (flags || []) as readonly boolean[];

  const hiddenIdSet = new Set<string>();
  for (let i = 0; i < rawNodeIds.length; i++) {
    const nid = String(rawNodeIds[i]);
    if (mediaOverrides?.[Number(nid)]?.hidden) hiddenIdSet.add(nid);
  }

  // Never hide the entire graph — a bad bulk override run must not blank the
  // canvas with no error.
  if (rawNodeIds.length > 0 && hiddenIdSet.size >= rawNodeIds.length) {
    console.warn(
      `[universeGraphData] every node has a hidden media override (${hiddenIdSet.size}/${rawNodeIds.length}); ignoring so the graph isn't blank.`
    );
    hiddenIdSet.clear();
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

    resolvedUrls.push(override?.videoLink || content?.videoLink || String(hashStrings[i] || ''));
    resolvedDescriptions.push(content?.plot || String(plotHashStrings[i] || ''));
    keptNodeIds.push(rawNodeIds[i]);
    keptContentHashes.push(String(hashStrings[i] || ''));
    keptPlotHashes.push(String(plotHashStrings[i] || ''));
    const prev = rawPrevious[i];
    keptPrevious.push(hiddenIdSet.has(String(prev)) ? '' : prev);
    keptChildren.push((rawChildren[i] || []).filter((c) => !hiddenIdSet.has(String(c))));
    keptFlags.push(Boolean(rawFlags[i]));
  }

  return {
    nodeIds: keptNodeIds,
    contentHashes: keptContentHashes,
    plotHashes: keptPlotHashes,
    urls: resolvedUrls,
    descriptions: resolvedDescriptions,
    previousNodes: keptPrevious,
    children: keptChildren,
    flags: keptFlags,
    canonChain: ((canonChainData || []) as readonly (string | number | bigint)[]).filter(
      (c) => !hiddenIdSet.has(String(c))
    ),
  };
}

/** Off-chain (fun-mode) timeline: map Firestore `offChainNodes` docs to GraphData. */
export function buildOffChainGraphData(offChainNodes: readonly any[] | undefined): GraphData {
  if (!offChainNodes || offChainNodes.length === 0) return EMPTY_GRAPH_DATA;

  const nodes = offChainNodes;
  return {
    nodeIds: nodes.map((n) => String(n.nodeId)),
    contentHashes: nodes.map((n) => String(n.contentHash || '')),
    plotHashes: nodes.map((n) => String(n.plotHash || '')),
    urls: nodes.map((n) => String(n.videoUrl || '')),
    descriptions: nodes.map((n) => String(n.title || n.plot || '')),
    previousNodes: nodes.map((n) => String(n.previousNodeId || 0)),
    children: nodes.map((n) =>
      Array.isArray(n.children) ? (n.children as number[]).map((c) => String(c)) : []
    ),
    flags: nodes.map((n) => Boolean(n.canon)),
    canonChain: nodes.filter((n) => n.canon).map((n) => String(n.nodeId)),
  };
}

export interface BuildGraphDataArgs {
  /** Strict mode: true → on-chain only, false → off-chain only. */
  useOnChain: boolean;
  /** Truthy only when a real on-chain Universe contract address is in play. */
  onChainContractAddress?: string;
  fullGraphData?: RawFullGraph;
  canonChainData?: readonly (string | number | bigint)[];
  contentMap?: Map<string, IndexerNodeContent>;
  mediaOverrides?: Record<number, NodeMediaOverride>;
  offChainNodes?: readonly any[];
}

/** Drop-in for useUniverseBlockchain's `graphData` useMemo body. */
export function buildGraphData({
  useOnChain,
  onChainContractAddress,
  fullGraphData,
  canonChainData,
  contentMap,
  mediaOverrides,
  offChainNodes,
}: BuildGraphDataArgs): GraphData {
  if (useOnChain) {
    if (onChainContractAddress && fullGraphData) {
      return buildOnChainGraphData(fullGraphData, canonChainData, contentMap, mediaOverrides);
    }
    return EMPTY_GRAPH_DATA;
  }
  return buildOffChainGraphData(offChainNodes);
}
