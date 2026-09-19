/**
 * Tests for useGraphLayout — persisted ReactFlow node positions shared by
 * the universe/timeline/anatomy canvases. Previously untested. Directly
 * relevant to the "editor nodes disappear" bug class: `applySavedPositions`
 * runs on every rebuild of the timeline (see the "Convert blockchain data to
 * timeline nodes" effect covered end-to-end in editorNodePipeline.test.ts),
 * so a bug here either silently drops manual drag positions or, worse,
 * collapses nodes onto identical coordinates so they visually overlap into
 * what looks like a single node.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Node } from 'reactflow';

const mockGet = vi.fn();
const mockSave = vi.fn();

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    graphLayouts: {
      get: { query: (...args: unknown[]) => mockGet(...args) },
      save: { mutate: (...args: unknown[]) => mockSave(...args) },
    },
  },
}));

import { useGraphLayout } from '../useGraphLayout';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderLayout(universeId: string | undefined, graphKey = 'timeline:t1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useGraphLayout(universeId, graphKey), { wrapper });
}

const node = (id: string, x: number, y: number): Node => ({
  id,
  position: { x, y },
  data: {},
});

describe('useGraphLayout — disabled state (no universeId)', () => {
  it('never calls the layout query when universeId is undefined', async () => {
    const { result } = renderLayout(undefined);
    expect(result.current.isLoaded).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('applySavedPositions is a no-op passthrough when disabled', () => {
    const { result } = renderLayout(undefined);
    const nodes = [node('a', 1, 2)];
    expect(result.current.applySavedPositions(nodes)).toEqual(nodes);
  });

  it('savePosition is a no-op and never calls save when disabled', () => {
    vi.useFakeTimers();
    const { result } = renderLayout(undefined);
    act(() => {
      result.current.savePosition('a', { x: 1, y: 2 });
      vi.advanceTimersByTime(1000);
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('useGraphLayout — applySavedPositions', () => {
  it('overlays saved positions onto matching nodes, saved wins over computed', async () => {
    mockGet.mockResolvedValue({ positions: { a: { x: 999, y: 888 } }, updatedAt: '2026-01-01' });
    const { result } = renderLayout('uni-1');
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const nodes = [node('a', 1, 2), node('b', 3, 4)];
    const applied = result.current.applySavedPositions(nodes);
    expect(applied.find((n) => n.id === 'a')!.position).toEqual({ x: 999, y: 888 });
    expect(applied.find((n) => n.id === 'b')!.position).toEqual({ x: 3, y: 4 });
  });

  it('leaves nodes untouched (same array) when there is nothing saved yet', async () => {
    mockGet.mockResolvedValue(null);
    const { result } = renderLayout('uni-1');
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const nodes = [node('a', 1, 2)];
    expect(result.current.applySavedPositions(nodes)).toEqual(nodes);
  });

  it('does not mutate the input node objects', async () => {
    mockGet.mockResolvedValue({ positions: { a: { x: 999, y: 888 } }, updatedAt: null });
    const { result } = renderLayout('uni-1');
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const original = node('a', 1, 2);
    result.current.applySavedPositions([original]);
    expect(original.position).toEqual({ x: 1, y: 2 });
  });

  it('isLoaded becomes true even when the layout fetch errors (does not hang the canvas)', async () => {
    mockGet.mockRejectedValue(new Error('500'));
    const { result } = renderLayout('uni-1');
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
  });
});

describe('useGraphLayout — savePosition debounce/flush', () => {
  it('debounces rapid drags into a single save call', async () => {
    mockGet.mockResolvedValue(null);
    mockSave.mockResolvedValue({});
    vi.useFakeTimers();
    const { result } = renderLayout('uni-1');

    act(() => {
      result.current.savePosition('a', { x: 1, y: 1 });
      result.current.savePosition('a', { x: 2, y: 2 });
      result.current.savePosition('b', { x: 5, y: 5 });
    });
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith({
      universeId: 'uni-1',
      graphKey: 'timeline:t1',
      positions: { a: { x: 2, y: 2 }, b: { x: 5, y: 5 } },
    });
  });

  it('a second drag on the same node after the debounce fires triggers its own separate save', async () => {
    mockGet.mockResolvedValue(null);
    mockSave.mockResolvedValue({});
    vi.useFakeTimers();
    const { result } = renderLayout('uni-1');

    act(() => {
      result.current.savePosition('a', { x: 1, y: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    act(() => {
      result.current.savePosition('a', { x: 9, y: 9 });
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave).toHaveBeenLastCalledWith({
      universeId: 'uni-1',
      graphKey: 'timeline:t1',
      positions: { a: { x: 9, y: 9 } },
    });
  });

  it('flushes on unmount so a quick nav-away does not drop the last drag', async () => {
    mockGet.mockResolvedValue(null);
    mockSave.mockResolvedValue({});
    const { result, unmount } = renderLayout('uni-1');

    act(() => {
      result.current.savePosition('a', { x: 7, y: 7 });
    });
    unmount();
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        universeId: 'uni-1',
        graphKey: 'timeline:t1',
        positions: { a: { x: 7, y: 7 } },
      })
    );
  });

  it('a just-saved position is reflected by applySavedPositions before the next natural refetch', async () => {
    // Regression: onSuccess merges the saved batch into query cache so a
    // graphData-triggered rebuild between save and the 60s staleTime window
    // does not revert the user's drag.
    mockGet.mockResolvedValue({ positions: {}, updatedAt: null });
    mockSave.mockResolvedValue({});
    const { result } = renderLayout('uni-1');
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.savePosition('a', { x: 42, y: 43 });
    });
    // Real 600ms debounce, then the mutation's onSuccess microtask.
    await waitFor(() => expect(mockSave).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() =>
      expect(result.current.applySavedPositions([node('a', 1, 1)])[0].position).toEqual({
        x: 42,
        y: 43,
      })
    );
  });
});
