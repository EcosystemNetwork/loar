/**
 * Universe on-chain graph pagination — pure, framework-free logic.
 *
 * `Universe.sol#getFullGraph()` hard-reverts once a universe's `latestNodeId`
 * (a monotonically-increasing total-nodes-ever-created counter — it never
 * decrements, so archived/regenerated nodes still count) exceeds 500:
 *
 *   require(latestNodeId <= 500, "Use getGraphPage for large graphs");
 *
 * The contract ships a paginated escape hatch, `getGraphPage(startId, count)`,
 * but nothing on the frontend called it — every universe that crossed 500
 * nodes silently rendered a permanently empty timeline/canvas, with no error
 * shown anywhere (see useUniverseBlockchain.ts, which never surfaced
 * isError/graphError to any of its three callers).
 *
 * This module is the pure planning/merging half of the fix — kept dependency
 * free (no wagmi/React) so it's cheap to exhaustively unit test. The wagmi
 * wiring lives in useUniverseBlockchain.ts.
 */

/** Mirrors Universe.sol's getFullGraph() hardcoded cap exactly. If the
 *  contract's cap ever changes, this constant must change with it — the
 *  parity test in apps/contracts/test/Universe.t.sol pins the pair together. */
export const FULL_GRAPH_NODE_LIMIT = 500;

/** Nodes fetched per getGraphPage() call. Kept well under FULL_GRAPH_NODE_LIMIT
 *  so a single page's eth_call return data stays small regardless of provider
 *  response-size limits — large universes are exactly the ones already at risk
 *  of hitting such limits, which is why they needed pagination in the first
 *  place. */
export const GRAPH_PAGE_SIZE = 200;

/** The exact tuple shape `getFullGraph()` / `getGraphPage()` return, in order:
 *  [ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags]. */
export type RawGraphTuple = readonly [
  readonly bigint[],
  readonly `0x${string}`[],
  readonly `0x${string}`[],
  readonly bigint[],
  readonly (readonly bigint[])[],
  readonly boolean[],
];

export interface GraphPageRequest {
  /** First node id in this page (1-based, inclusive — matches Universe.sol). */
  startId: number;
  /** Number of nodes requested in this page. */
  count: number;
}

/**
 * True when a universe's node count means `getFullGraph()` would revert and
 * `getGraphPage()` pagination must be used instead.
 */
export function shouldPaginateGraph(
  latestNodeId: number,
  limit: number = FULL_GRAPH_NODE_LIMIT
): boolean {
  return Number.isFinite(latestNodeId) && latestNodeId > limit;
}

/**
 * Splits `1..latestNodeId` into `getGraphPage(startId, count)` requests of at
 * most `pageSize` nodes each, in ascending order with no gaps or overlap.
 *
 * Returns `[]` for `latestNodeId <= 0` (nothing to fetch — an empty or
 * not-yet-loaded universe, not an error).
 */
export function planGraphPages(
  latestNodeId: number,
  pageSize: number = GRAPH_PAGE_SIZE
): GraphPageRequest[] {
  if (!Number.isFinite(latestNodeId) || latestNodeId <= 0) return [];
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error(`planGraphPages: pageSize must be a positive finite number, got ${pageSize}`);
  }

  const pages: GraphPageRequest[] = [];
  for (let startId = 1; startId <= latestNodeId; startId += pageSize) {
    const remaining = latestNodeId - startId + 1;
    pages.push({ startId, count: Math.min(pageSize, remaining) });
  }
  return pages;
}

/**
 * Merges an ordered array of `getGraphPage()` result tuples (or a single
 * `getFullGraph()` tuple) into one combined tuple, preserving order.
 *
 * Callers are responsible for passing pages in ascending `startId` order
 * (i.e. exactly the order `planGraphPages()` produced them in) — this
 * function does not sort, since the on-chain `ids` returned are opaque
 * numbers to it and re-sorting would be guessing at intent.
 *
 * `[]` in, `[[], [], [], [], [], []]` out — never `undefined`, so callers can
 * always safely destructure the result.
 */
export function mergeGraphPages(pages: readonly RawGraphTuple[]): RawGraphTuple {
  const ids: bigint[] = [];
  const contentHashes: `0x${string}`[] = [];
  const plotHashes: `0x${string}`[] = [];
  const previousIds: bigint[] = [];
  const nextIds: (readonly bigint[])[] = [];
  const canonFlags: boolean[] = [];

  for (const page of pages) {
    const [pIds, pContentHashes, pPlotHashes, pPreviousIds, pNextIds, pCanonFlags] = page;
    ids.push(...pIds);
    contentHashes.push(...pContentHashes);
    plotHashes.push(...pPlotHashes);
    previousIds.push(...pPreviousIds);
    nextIds.push(...pNextIds);
    canonFlags.push(...pCanonFlags);
  }

  return [ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags] as const;
}

/**
 * Why the graph fetch failed, for choosing a specific error message instead
 * of one generic "couldn't load" banner:
 *
 *  - 'none'                     — no error.
 *  - 'full-graph-error'         — getFullGraph() failed for a universe
 *                                  believed to be under the 500-node cap —
 *                                  a transient RPC/provider problem, safe to
 *                                  retry as-is.
 *  - 'pagination-unsupported'   — this universe is over the cap AND its
 *                                  getGraphPage() calls failed too. Each
 *                                  Universe is deployed as its own contract
 *                                  (no shared upgradeable implementation —
 *                                  see UniverseFactory.sol's `new Universe(..)`),
 *                                  so a universe deployed before
 *                                  getGraphPage() existed on-chain will always
 *                                  fail here — retrying won't help.
 */
export type GraphFetchFailureReason = 'none' | 'full-graph-error' | 'pagination-unsupported';

export function classifyGraphFetchFailure(
  isError: boolean,
  needsPagination: boolean
): GraphFetchFailureReason {
  if (!isError) return 'none';
  return needsPagination ? 'pagination-unsupported' : 'full-graph-error';
}
