/**
 * Regression coverage for `graphSource` / `rawOnChainNodeCount` — the
 * diagnostic fields NodeCountChip renders in the universe editor toolbar
 * (see components/flow/NodeCountChip.tsx's header for why this exists).
 * Gets it wrong and the toolbar chip lies about where a universe's nodes
 * actually came from, which defeats the whole point of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOffChainList = vi.fn();
const mockNodeMediaList = vi.fn();

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    offChainNodes: { list: { query: (...args: unknown[]) => mockOffChainList(...args) } },
    nodeMedia: { list: { query: (...args: unknown[]) => mockNodeMediaList(...args) } },
  },
}));
vi.mock('@/utils/ponder-api', () => ({
  ponderGql: vi.fn().mockResolvedValue({
    nodeContents: { items: [], pageInfo: { hasNextPage: false, endCursor: '' } },
  }),
  ponderQueryDefaults: {},
}));

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

const addr = '0x341ffa19c0ec8d2c8ef42a360cf799949844262e';

describe('useUniverseBlockchain — graphSource / rawOnChainNodeCount', () => {
  it('"on-chain": the contract graph itself has nodes', async () => {
    contractReads = {
      latestNodeId: { data: 3n },
      getFullGraph: {
        data: [
          [1n, 2n, 3n],
          ['0x1', '0x2', '0x3'],
          ['0x1', '0x2', '0x3'],
          [0n, 1n, 2n],
          [[2n], [3n], []],
          [true, true, true],
        ],
      },
      currentCanonId: { data: 0n },
    };
    mockOffChainList.mockResolvedValue({ nodes: [], total: 0 });
    mockNodeMediaList.mockResolvedValue({ overrides: {} });

    const { result } = renderUniverseBlockchain({
      universeId: addr,
      contractAddress: addr,
      isBlockchainUniverse: true,
      isOnChain: true,
    });

    await waitFor(() => expect(result.current.isLoadingAny).toBe(false));
    expect(result.current.graphSource).toBe('on-chain');
    expect(result.current.rawOnChainNodeCount).toBe(3);
    expect(result.current.graphData.nodeIds.length).toBe(3);
  });

  it('"on-chain": hidden overrides still read as \'on-chain\', with rawOnChainNodeCount > graphData.nodeIds.length', async () => {
    contractReads = {
      latestNodeId: { data: 3n },
      getFullGraph: {
        data: [
          [1n, 2n, 3n],
          ['0x1', '0x2', '0x3'],
          ['0x1', '0x2', '0x3'],
          [0n, 1n, 2n],
          [[2n], [3n], []],
          [true, true, true],
        ],
      },
      currentCanonId: { data: 0n },
    };
    mockOffChainList.mockResolvedValue({ nodes: [], total: 0 });
    mockNodeMediaList.mockResolvedValue({ overrides: { 2: { hidden: true } } });

    const { result } = renderUniverseBlockchain({
      universeId: addr,
      contractAddress: addr,
      isBlockchainUniverse: true,
      isOnChain: true,
    });

    await waitFor(() => expect(result.current.isLoadingAny).toBe(false));
    expect(result.current.graphSource).toBe('on-chain');
    expect(result.current.rawOnChainNodeCount).toBe(3);
    expect(result.current.graphData.nodeIds.length).toBe(2);
    // NodeCountChip derives "hidden by override" as this difference.
    expect(result.current.rawOnChainNodeCount - result.current.graphData.nodeIds.length).toBe(1);
  });

  it('"off-chain-fallback": minted (isOnChain) but the contract graph is empty — renders Firestore nodes instead', async () => {
    contractReads = {
      latestNodeId: { data: 0n },
      getFullGraph: { data: [[], [], [], [], [], []] },
      currentCanonId: { data: 0n },
    };
    mockOffChainList.mockResolvedValue({
      nodes: [
        { nodeId: 1, videoUrl: 'x', title: 't', previousNodeId: 0, children: [], canon: true },
      ],
      total: 1,
    });
    mockNodeMediaList.mockResolvedValue({ overrides: {} });

    const { result } = renderUniverseBlockchain({
      universeId: addr,
      contractAddress: addr,
      isBlockchainUniverse: true,
      isOnChain: true,
    });

    await waitFor(() => expect(result.current.isLoadingAny).toBe(false));
    expect(result.current.graphSource).toBe('off-chain-fallback');
    expect(result.current.rawOnChainNodeCount).toBe(0);
    expect(result.current.graphData.nodeIds.length).toBe(1);
  });

  it('"off-chain": a never-minted fun-mode universe', async () => {
    mockOffChainList.mockResolvedValue({
      nodes: [
        { nodeId: 1, videoUrl: 'x', title: 't', previousNodeId: 0, children: [], canon: true },
      ],
      total: 1,
    });

    const { result } = renderUniverseBlockchain({
      universeId: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
      contractAddress: undefined,
      isBlockchainUniverse: true,
      isOnChain: false,
    });

    await waitFor(() => expect(result.current.isLoadingAny).toBe(false));
    expect(result.current.graphSource).toBe('off-chain');
    expect(result.current.rawOnChainNodeCount).toBe(0);
  });

  it('"empty": neither source has any nodes', async () => {
    contractReads = {
      latestNodeId: { data: 0n },
      getFullGraph: { data: [[], [], [], [], [], []] },
      currentCanonId: { data: 0n },
    };
    mockOffChainList.mockResolvedValue({ nodes: [], total: 0 });
    mockNodeMediaList.mockResolvedValue({ overrides: {} });

    const { result } = renderUniverseBlockchain({
      universeId: addr,
      contractAddress: addr,
      isBlockchainUniverse: true,
      isOnChain: true,
    });

    await waitFor(() => expect(result.current.isLoadingAny).toBe(false));
    expect(result.current.graphSource).toBe('empty');
    expect(result.current.graphData.nodeIds.length).toBe(0);
  });
});
