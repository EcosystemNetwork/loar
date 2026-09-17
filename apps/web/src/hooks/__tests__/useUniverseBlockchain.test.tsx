/**
 * Regression tests for the "nodes don't populate" bug: every fun-mode
 * (off-chain) universe rendered an empty timeline in the editor except
 * Fogline.
 *
 * Root cause: `offChainNodesRouter.list` does an exact-match Firestore query
 * (`where('universeId', '==', ...)`), and `offChainNodesRouter.create`
 * stores EVM-shaped universe ids as given by the caller — which, per the
 * seed/backfill scripts (see scripts/audit-empty-universes.ts,
 * scripts/generate-fogline-episode.ts), is always lowercased. `/watch` and
 * `/profile` already run the route id through `normalizeUniverseId()` before
 * querying `offChainNodes.list`, but `useUniverseBlockchain` (the hook behind
 * the universe editor at `/universe/$id`) queried with the raw route id.
 * Any universe reached via a mixed-case/checksummed address (e.g. produced by
 * viem's `getAddress()` at publish time — see UniversePublishPanel.tsx)
 * therefore queried for a doc that could never match, and got back zero
 * nodes. Fogline's hardcoded `UNIVERSE_ID` happens to already be all-lowercase,
 * which is why it was the one universe that "worked".
 *
 * These tests mock the off-chain query to behave like Firestore's exact
 * match against a lowercased stored id, so they fail against the
 * unnormalized query and pass once the hook normalizes like `/watch` does.
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

vi.mock('wagmi', () => ({
  useReadContract: () => ({
    data: undefined,
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
});

/** A single-node off-chain timeline, in the shape `offChainNodesRouter` returns. */
const ONE_NODE = [
  {
    nodeId: 1,
    contentHash: '',
    plotHash: '',
    videoUrl: 'https://example.com/1.mp4',
    title: 'Scene 1',
    previousNodeId: 0,
    children: [] as number[],
    canon: true,
  },
];

/**
 * Stands in for Firestore's `where('universeId', '==', storedId)` — only
 * "finds" nodes when the hook queries with exactly the id they were stored
 * under, exercising the same exact-match behavior the real backend has.
 */
function mockFirestoreExactMatch(storedId: string) {
  mockOffChainList.mockImplementation(async ({ universeId }: { universeId: string }) => {
    if (universeId !== storedId) return { nodes: [], total: 0 };
    return { nodes: ONE_NODE, total: ONE_NODE.length };
  });
}

function renderUniverseBlockchain(props: Parameters<typeof useUniverseBlockchain>[0]) {
  // retry: false — otherwise react-query's default 3-attempt exponential
  // backoff makes the error-path test slow and flaky.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUniverseBlockchain(props), { wrapper });
}

describe('useUniverseBlockchain — off-chain node population', () => {
  it('normalizes a mixed-case EVM universe id the same way /watch and /profile do', async () => {
    const mixedCaseId = '0xAbC1230000000000000000000000000019d9e26c';
    mockFirestoreExactMatch(mixedCaseId.toLowerCase());

    renderUniverseBlockchain({
      universeId: mixedCaseId,
      contractAddress: undefined,
      isBlockchainUniverse: true,
      isOnChain: false,
    });

    await waitFor(() => expect(mockOffChainList).toHaveBeenCalled());
    expect(mockOffChainList).toHaveBeenCalledWith({ universeId: mixedCaseId.toLowerCase() });
  });

  it('populates graphData.nodeIds for a mixed-case EVM universe id once nodes resolve', async () => {
    const mixedCaseId = '0xAbC1230000000000000000000000000019d9e26c';
    mockFirestoreExactMatch(mixedCaseId.toLowerCase());

    const { result } = renderUniverseBlockchain({
      universeId: mixedCaseId,
      contractAddress: undefined,
      isBlockchainUniverse: true,
      isOnChain: false,
    });

    await waitFor(() => expect(result.current.graphData.nodeIds.length).toBe(1));
    expect(result.current.graphData.nodeIds[0]).toBe('1');
  });

  it('does not touch the case of a non-EVM (Solana base58 PDA) universe id', async () => {
    // Base58 — case-sensitive, and the exact string a Solana universe is
    // actually keyed by. Lowercasing this would 404/empty it just like the
    // earlier Solana-PDA-lowercasing bug did for `/watch`.
    const solanaId = 'BQnLnDdvBnJ2FYFPNZzUgwvtQiQhkYbNW7cLtYsuXCT9';
    mockFirestoreExactMatch(solanaId);

    renderUniverseBlockchain({
      universeId: solanaId,
      contractAddress: undefined,
      isBlockchainUniverse: true,
      isOnChain: false,
    });

    await waitFor(() => expect(mockOffChainList).toHaveBeenCalled());
    expect(mockOffChainList).toHaveBeenCalledWith({ universeId: solanaId });
  });

  it("already-lowercase ids (e.g. Fogline's hardcoded UNIVERSE_ID) match either way", async () => {
    const lowercaseId = '0x0000000000000000000000000000019d9e26795c';
    mockFirestoreExactMatch(lowercaseId);

    const { result } = renderUniverseBlockchain({
      universeId: lowercaseId,
      contractAddress: undefined,
      isBlockchainUniverse: true,
      isOnChain: false,
    });

    await waitFor(() => expect(result.current.graphData.nodeIds.length).toBe(1));
  });

  it('reproduces the reported "nodes won\'t populate" incident end-to-end with real Techno Antichrist data', async () => {
    // Techno Antichrist: a Solana (non-EVM) fun-mode universe reported as
    // "nodes won't populate" on loar.fun. universes.get and offChainNodes.list
    // were both confirmed healthy directly against production during that
    // investigation (real shape reproduced below) — this pins that the hook
    // itself correctly turns that real response into a populated graph, so
    // any future regression in the fetch/merge path (not the UI layer) shows
    // up here instead of only in a user's browser.
    const universeId = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
    const REAL_NODES = [
      {
        id: '7e014953-c85b-4386-8297-079bcfae901d',
        universeId,
        nodeId: 1,
        contentHash: '0x7e31467ff562d3e464439d9bf7d41a4fc5f9b36b9d485956d09ba9043d8a85bd',
        plotHash: '0x9f2f88bc129b156aeeb397a0de058173f949a56abb803e68783277d69826ebc6',
        videoUrl:
          'https://firebasestorage.googleapis.com/v0/b/loar-db.firebasestorage.app/o/objects%2F57%2F5729654e330bb49493a803136a1aa3d914772a2528419a3b3f626b4ed9c271fb.mp4?alt=media',
        plot: 'A flawless "Briefing" at full tilt.',
        title: 'Ep 1 — The Commission — shot 1',
        previousNodeId: 0,
        canon: true,
        children: [2],
      },
      {
        id: '7a79637b-7864-4455-818f-3eb78c78b3bf',
        universeId,
        nodeId: 2,
        contentHash: '0x6879da702c64574e30cf200842476a8469b9c122a877bf86020b7a4fa94422db',
        plotHash: '0xeb66851f498f94f570bd0cee15a46ffc1f696d1924e0fc95d4e59894fa436a7f',
        videoUrl:
          'https://firebasestorage.googleapis.com/v0/b/loar-db.firebasestorage.app/o/objects%2F9b%2F9b23bac7e292bc13d591cdfd8ea18a8e67725dad3c6a51aa5f243086eb35128a.mp4?alt=media',
        plot: 'Backstage load-out at 1 a.m.',
        title: 'Ep 1 — The Commission — shot 2',
        previousNodeId: 1,
        canon: false,
        children: [3],
      },
    ];
    mockOffChainList.mockResolvedValue({ nodes: REAL_NODES, total: REAL_NODES.length });

    const { result } = renderUniverseBlockchain({
      universeId,
      contractAddress: undefined,
      // isAddressLikeUniverseId(universeId) is true (Solana base58 PDA).
      isBlockchainUniverse: true,
      // onChainUniverseId is null on the real universe doc — confirmed
      // fun-mode, never touch the (nonexistent) contract.
      isOnChain: false,
    });

    await waitFor(() => expect(result.current.graphData.nodeIds.length).toBe(2));
    expect(result.current.graphData.nodeIds).toEqual(['1', '2']);
    expect(result.current.graphData.urls[0]).toContain('firebasestorage.googleapis.com');
    expect(result.current.graphData.children[0]).toEqual(['2']);
    expect(result.current.isLoadingOffChain).toBe(false);
    expect(result.current.isLoadingAny).toBe(false);
  });

  it('does not crash and yields an empty graph when offChainNodes.list itself errors (e.g. a 500)', async () => {
    const universeId = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
    mockOffChainList.mockRejectedValue(new Error('INTERNAL_SERVER_ERROR'));

    const { result } = renderUniverseBlockchain({
      universeId,
      contractAddress: undefined,
      isBlockchainUniverse: true,
      isOnChain: false,
    });

    await waitFor(() => expect(result.current.isLoadingOffChain).toBe(false));
    expect(result.current.graphData.nodeIds).toEqual([]);
  });
});
