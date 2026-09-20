/**
 * Deterministic regression test for the "nodes pop up and disappear seconds
 * later" bug on on-chain universes — deliberately mocked, not real-stack.
 *
 * The end-to-end version of this scenario (real Sepolia RPC, a real
 * Firestore-emulator-backed server, real Ponder) lives in
 * universeCanvasNodesOnScreen.test.tsx and is the stronger proof that the
 * real "Cyber War" universe settles correctly. But it can't reliably catch
 * *this* regression: the bug is a race between two independent fetches
 * (the on-chain graph vs. `nodeMedia.list`), and against fast local infra
 * (localhost server, direct RPC) those two calls routinely resolve close
 * enough together that the buggy intermediate state — `isLoadingAny: false`
 * while `graphData` still holds all 116 un-filtered nodes — never gets
 * observed even with the fix reverted (confirmed by hand: reverting
 * useUniverseBlockchain.ts's isLoadingMediaOverrides and re-running the
 * real-stack test still passed). In production the two calls go over real,
 * uneven-latency network hops, which is what actually opens the window.
 *
 * A mock is the correct tool here, not a workaround: it lets the override
 * fetch be held open on demand so the race window can be inspected
 * deterministically, on every run, regardless of how fast the real backends
 * happen to respond.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOffChainList = vi.fn();
const mockNodeMediaList = vi.fn();

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    offChainNodes: {
      list: { query: (...args: unknown[]) => mockOffChainList(...args) },
    },
    nodeMedia: {
      list: { query: (...args: unknown[]) => mockNodeMediaList(...args) },
    },
  },
}));

// useNodeContents() fires a real ponderGql() fetch whenever a contract
// address is set, independent of everything this test asserts on. Left
// unmocked, that's a live network call — mocked here purely so it settles
// instantly instead of adding unrelated real-network latency to a test
// whose whole point is deterministic timing.
vi.mock('@/utils/ponder-api', () => ({
  ponderGql: vi
    .fn()
    .mockResolvedValue({
      nodeContents: { items: [], pageInfo: { hasNextPage: false, endCursor: '' } },
    }),
  ponderQueryDefaults: {},
}));

// Per-functionName stand-in for wagmi's on-chain reads.
let contractReads: Record<string, { data: unknown }> = {};

vi.mock('wagmi', () => ({
  useReadContract: (config: { functionName: string }) => ({
    data: contractReads[config.functionName]?.data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useReadContracts: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { useUniverseBlockchain } from '../useUniverseBlockchain';

afterEach(() => {
  vi.clearAllMocks();
  contractReads = {};
});

function renderUniverseBlockchain(props: Parameters<typeof useUniverseBlockchain>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUniverseBlockchain(props), { wrapper });
}

describe('useUniverseBlockchain — media-override loading race ("nodes pop up and disappear")', () => {
  // Same universe and same real hidden-override shape as the real-stack
  // test: 0x341ffa19c0ec8d2c8ef42a360cf799949844262e, 102 of 116 real nodes
  // hidden. Trimmed to 3 nodes here since this test cares about timing, not
  // data volume.
  const contractAddress = '0x341ffa19c0ec8d2c8ef42a360cf799949844262e';

  // [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags]
  const RAW_FULL_GRAPH = [
    [1n, 2n, 3n],
    ['0x1', '0x2', '0x3'],
    ['0x1', '0x2', '0x3'],
    [0n, 1n, 2n],
    [[2n], [3n], []],
    [true, true, true],
  ];

  function setUpOnChainGraph() {
    contractReads = {
      latestNodeId: { data: 3n },
      getFullGraph: { data: RAW_FULL_GRAPH },
      currentCanonId: { data: 0n },
    };
    // The off-chain query fires unconditionally (see useUniverseBlockchain's
    // comment on why — a minted universe can still fall back to it), so it
    // needs a resolved value even in this on-chain test, or react-query logs
    // "Query data cannot be undefined" on every render.
    mockOffChainList.mockResolvedValue({ nodes: [], total: 0 });
  }

  it('keeps isLoadingAny true until nodeMedia.list settles, even once the on-chain graph has data', async () => {
    setUpOnChainGraph();
    let resolveOverrides: (value: { overrides: Record<number, { hidden?: boolean }> }) => void;
    mockNodeMediaList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOverrides = resolve;
        })
    );

    const { result } = renderUniverseBlockchain({
      universeId: contractAddress,
      contractAddress,
      isBlockchainUniverse: true,
      isOnChain: true,
    });

    // On-chain graph is already in: this is the exact moment that used to
    // render the canvas with every node before the override fetch weighed in.
    await waitFor(() => expect(result.current.graphData.nodeIds.length).toBe(3));
    expect(result.current.isLoadingAny).toBe(true);

    resolveOverrides!({ overrides: { 2: { hidden: true } } });
    await waitFor(() => expect(result.current.isLoadingAny).toBe(false));
    // buildOnChainGraphData keeps nodeIds in their original on-chain type
    // (bigint here, since RAW_FULL_GRAPH uses bigints) rather than stringifying.
    expect(result.current.graphData.nodeIds).toEqual([1n, 3n]);
  });
});
