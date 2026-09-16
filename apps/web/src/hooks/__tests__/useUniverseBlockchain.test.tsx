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
  const queryClient = new QueryClient();
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
});
