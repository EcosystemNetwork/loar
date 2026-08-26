/**
 * Unit tests for universeGraphPaging.ts — the pure logic behind the
 * getFullGraph() → getGraphPage() pagination fallback (see that file's
 * top-of-file comment for the full incident writeup: universes past 500
 * total nodes were rendering a permanently empty, silently-failing canvas).
 *
 * These are deliberately framework-free (no wagmi/React/MSW) so they run in
 * milliseconds and pin down the exact page-boundary arithmetic without any
 * network or contract mocking — that coverage lives in
 * apps/contracts/test/Universe.t.sol (contract-side parity) and
 * apps/web/e2e/universe-graph-pagination.spec.ts (end-to-end, mocked RPC).
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_GRAPH_NODE_LIMIT,
  GRAPH_PAGE_SIZE,
  type GraphPageRequest,
  type RawGraphTuple,
  classifyGraphFetchFailure,
  mergeGraphPages,
  planGraphPages,
  shouldPaginateGraph,
} from '../universeGraphPaging';

describe('shouldPaginateGraph', () => {
  it('is false at exactly the contract cap (Universe.sol allows <= 500)', () => {
    expect(shouldPaginateGraph(FULL_GRAPH_NODE_LIMIT)).toBe(false);
  });

  it('is true one past the contract cap', () => {
    expect(shouldPaginateGraph(FULL_GRAPH_NODE_LIMIT + 1)).toBe(true);
  });

  it('is false for a small/typical universe', () => {
    expect(shouldPaginateGraph(37)).toBe(false);
  });

  it('is false for zero (empty or not-yet-loaded universe)', () => {
    expect(shouldPaginateGraph(0)).toBe(false);
  });

  it('respects a custom limit', () => {
    expect(shouldPaginateGraph(10, 5)).toBe(true);
    expect(shouldPaginateGraph(5, 5)).toBe(false);
  });

  it('is false for non-finite input (NaN/Infinity) rather than throwing', () => {
    expect(shouldPaginateGraph(NaN)).toBe(false);
    expect(shouldPaginateGraph(Infinity)).toBe(false);
    expect(shouldPaginateGraph(-Infinity)).toBe(false);
  });
});

describe('planGraphPages', () => {
  it('returns [] for an empty universe', () => {
    expect(planGraphPages(0)).toEqual([]);
  });

  it('returns [] for negative or non-finite latestNodeId instead of throwing', () => {
    expect(planGraphPages(-1)).toEqual([]);
    expect(planGraphPages(NaN)).toEqual([]);
    expect(planGraphPages(-Infinity)).toEqual([]);
  });

  it('plans a single page for a single node', () => {
    expect(planGraphPages(1)).toEqual([{ startId: 1, count: 1 }]);
  });

  it('plans exactly one full page when latestNodeId equals the page size', () => {
    const pages = planGraphPages(GRAPH_PAGE_SIZE);
    expect(pages).toEqual([{ startId: 1, count: GRAPH_PAGE_SIZE }]);
  });

  it('spills into a second page one past the page size', () => {
    const pages = planGraphPages(GRAPH_PAGE_SIZE + 1);
    expect(pages).toEqual([
      { startId: 1, count: GRAPH_PAGE_SIZE },
      { startId: GRAPH_PAGE_SIZE + 1, count: 1 },
    ]);
  });

  it('plans the 501-node boundary case (the smallest universe that must paginate)', () => {
    // latestNodeId = FULL_GRAPH_NODE_LIMIT + 1 is the very first value where
    // getFullGraph() reverts — this is the exact case that was silently
    // broken end to end before this fix.
    const latestNodeId = FULL_GRAPH_NODE_LIMIT + 1;
    expect(shouldPaginateGraph(latestNodeId)).toBe(true);
    const pages = planGraphPages(latestNodeId);
    expect(pages).toEqual([
      { startId: 1, count: 200 },
      { startId: 201, count: 200 },
      { startId: 401, count: 101 },
    ]);
  });

  it('covers a large universe (1000 nodes) with no gaps, no overlap, exact total', () => {
    const latestNodeId = 1000;
    const pages = planGraphPages(latestNodeId);
    expect(pages).toEqual([
      { startId: 1, count: 200 },
      { startId: 201, count: 200 },
      { startId: 401, count: 200 },
      { startId: 601, count: 200 },
      { startId: 801, count: 200 },
    ]);
    assertContiguousCoverage(pages, latestNodeId);
  });

  it('handles a latestNodeId that is not a clean multiple of the page size', () => {
    const latestNodeId = 733;
    const pages = planGraphPages(latestNodeId);
    assertContiguousCoverage(pages, latestNodeId);
    // Last page is the remainder, not a full page.
    expect(pages.at(-1)).toEqual({ startId: 601, count: 133 });
  });

  it('honors a custom page size', () => {
    const pages = planGraphPages(25, 10);
    expect(pages).toEqual([
      { startId: 1, count: 10 },
      { startId: 11, count: 10 },
      { startId: 21, count: 5 },
    ]);
  });

  it('plans one page per node when the page size is 1', () => {
    const pages = planGraphPages(4, 1);
    expect(pages).toEqual([
      { startId: 1, count: 1 },
      { startId: 2, count: 1 },
      { startId: 3, count: 1 },
      { startId: 4, count: 1 },
    ]);
  });

  it('throws on a non-positive page size instead of looping forever', () => {
    // startId += pageSize with pageSize <= 0 would never advance — this is
    // the classic infinite-loop footgun for this kind of pagination helper.
    expect(() => planGraphPages(10, 0)).toThrow(/pageSize must be a positive/);
    expect(() => planGraphPages(10, -5)).toThrow(/pageSize must be a positive/);
  });

  it('throws on a non-finite page size', () => {
    expect(() => planGraphPages(10, NaN)).toThrow(/pageSize must be a positive/);
    expect(() => planGraphPages(10, Infinity)).toThrow(/pageSize must be a positive/);
  });

  /** Every id in 1..latestNodeId is covered by exactly one page. */
  function assertContiguousCoverage(pages: GraphPageRequest[], latestNodeId: number) {
    expect(pages.length).toBeGreaterThan(0);
    let expectedNextStart = 1;
    let totalCovered = 0;
    for (const page of pages) {
      expect(page.startId).toBe(expectedNextStart);
      expect(page.count).toBeGreaterThan(0);
      expectedNextStart = page.startId + page.count;
      totalCovered += page.count;
    }
    expect(totalCovered).toBe(latestNodeId);
    expect(expectedNextStart).toBe(latestNodeId + 1);
  }
});

describe('mergeGraphPages', () => {
  it('returns six empty arrays for an empty page list (never undefined)', () => {
    const merged = mergeGraphPages([]);
    expect(merged).toEqual([[], [], [], [], [], []]);
  });

  it('passes a single page through unchanged (identity — the <=500 fast path)', () => {
    const page = fakePage([1, 2, 3]);
    expect(mergeGraphPages([page])).toEqual(page);
  });

  it('concatenates multiple pages in the given order without sorting', () => {
    // Slice one continuous 6-node "on-chain" graph into three pages of
    // uneven size (2 + 3 + 1) — the same shape getGraphPage() calls would
    // actually return — so previousIds/nextIds stay meaningful *across* the
    // page boundary, unlike three independently-built fixtures would.
    const fullGraph = fakePage([1, 2, 3, 4, 5, 6]);
    const pageA = sliceTuple(fullGraph, 1, 2); // ids 1-2
    const pageB = sliceTuple(fullGraph, 3, 3); // ids 3-5
    const pageC = sliceTuple(fullGraph, 6, 1); // id 6

    const merged = mergeGraphPages([pageA, pageB, pageC]);
    const [ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags] = merged;

    expect(ids).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    expect(contentHashes).toEqual([
      hashFor(1),
      hashFor(2),
      hashFor(3),
      hashFor(4),
      hashFor(5),
      hashFor(6),
    ]);
    expect(plotHashes.length).toBe(6);
    expect(previousIds).toEqual([0n, 1n, 2n, 3n, 4n, 5n]);
    expect(nextIds).toEqual([[2n], [3n], [4n], [5n], [6n], []]);
    expect(canonFlags).toEqual([true, false, false, false, false, false]);
  });

  it('does not mutate the input pages', () => {
    const pageA = fakePage([1, 2]);
    const snapshot = structuredCloneTuple(pageA);
    mergeGraphPages([pageA, fakePage([3])]);
    expect(pageA).toEqual(snapshot);
  });

  it('preserves per-node nextIds arrays (nested arrays) exactly as returned on-chain', () => {
    const branchy: RawGraphTuple = [
      [1n, 2n, 3n],
      [hashFor(1), hashFor(2), hashFor(3)],
      [hashFor(1), hashFor(2), hashFor(3)],
      [0n, 1n, 1n],
      [[2n, 3n], [], []], // node 1 branches into both 2 and 3
      [true, false, false],
    ];
    const merged = mergeGraphPages([branchy]);
    expect(merged[4]).toEqual([[2n, 3n], [], []]);
  });

  it('round-trips: paginating a full graph and merging it back reconstructs the original', () => {
    // This is the core regression guard: for every latestNodeId we might
    // plausibly see in production, slicing a synthetic "on-chain" graph per
    // planGraphPages()'s boundaries and merging the slices back must be
    // byte-for-byte identical to the unpaginated graph.
    for (const latestNodeId of [1, 199, 200, 201, 500, 501, 733, 1000, 2500]) {
      const fullGraph = fakePage(range(1, latestNodeId));
      const pages = planGraphPages(latestNodeId);
      const slices = pages.map(({ startId, count }) => sliceTuple(fullGraph, startId, count));
      const merged = mergeGraphPages(slices);
      expect(merged).toEqual(fullGraph);
    }
  });
});

describe('classifyGraphFetchFailure', () => {
  it('is "none" when there is no error, regardless of pagination state', () => {
    expect(classifyGraphFetchFailure(false, false)).toBe('none');
    expect(classifyGraphFetchFailure(false, true)).toBe('none');
  });

  it('is "full-graph-error" for a plain getFullGraph() failure under the cap', () => {
    // e.g. a flaky RPC provider — retrying the same call is reasonable.
    expect(classifyGraphFetchFailure(true, false)).toBe('full-graph-error');
  });

  it('is "pagination-unsupported" when getGraphPage() itself failed', () => {
    // Each Universe is its own non-proxy contract deploy (see
    // UniverseFactory.sol's `new Universe(config)`) — a universe deployed
    // before getGraphPage() existed on-chain will fail this forever, so the
    // UI must say something different than "transient error, try again".
    expect(classifyGraphFetchFailure(true, true)).toBe('pagination-unsupported');
  });
});

// ── Test fixtures ──────────────────────────────────────────────────────────

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function hashFor(id: number): `0x${string}` {
  return `0x${id.toString(16).padStart(64, '0')}`;
}

/** Builds a fake getFullGraph()/getGraphPage()-shaped tuple for the given
 *  (1-based, arbitrary, non-necessarily-contiguous) node ids, with each node
 *  pointing at the previous one in the list (previousIds[i] = ids[i-1]) so
 *  parent/child relationships are exercisable in assertions. */
function fakePage(ids: number[]): RawGraphTuple {
  return [
    ids.map((id) => BigInt(id)),
    ids.map((id) => hashFor(id)),
    ids.map((id) => hashFor(id)),
    ids.map((id, i) => (i === 0 ? 0n : BigInt(ids[i - 1]))),
    ids.map((id, i) => (i < ids.length - 1 ? [BigInt(ids[i + 1])] : [])),
    ids.map((_, i) => i === 0),
  ];
}

/** Slices a full-graph-shaped tuple the same way getGraphPage(startId, count)
 *  would slice the on-chain array (1-based startId, contiguous ids assumed). */
function sliceTuple(tuple: RawGraphTuple, startId: number, count: number): RawGraphTuple {
  const from = startId - 1;
  const to = from + count;
  return [
    tuple[0].slice(from, to),
    tuple[1].slice(from, to),
    tuple[2].slice(from, to),
    tuple[3].slice(from, to),
    tuple[4].slice(from, to),
    tuple[5].slice(from, to),
  ];
}

function structuredCloneTuple(tuple: RawGraphTuple): RawGraphTuple {
  const deepClone = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(deepClone) : value;
  return tuple.map(deepClone) as unknown as RawGraphTuple;
}
