/**
 * useUniverseEvents — the sync patch must contain only what THIS browser
 * changed. It used to be diffed against the last server copy, so a stale local
 * entry (one a teammate had since edited) was pushed back on the next
 * unrelated save and clobbered their edit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockGet = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    universeEvents: {
      get: { query: (...a: unknown[]) => mockGet(...a) },
      upsert: { mutate: (...a: unknown[]) => mockUpsert(...a) },
    },
  },
}));

import { useUniverseEvents } from '../useUniverseEvents';

const KEY = 'universe_events_u1';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUniverseEvents('u1'), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  mockUpsert.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('useUniverseEvents', () => {
  it('only sends the entries the user changed, not stale ones a teammate edited', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        '2': { title: 'mine-old', timestamp: 1 },
        '5': { title: 'stale', timestamp: 1 },
      })
    );
    // Server: teammate edited 5 but with no newer timestamp than local → local stays.
    mockGet.mockResolvedValue({ events: { '5': { title: 'teammate', timestamp: 1 } } });
    const { result } = setup();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    act(() => {
      const ev = result.current.getStoredEvents();
      ev['2'] = { title: 'mine-new', timestamp: 2 };
      result.current.setStoredEvents(ev);
    });
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled(), { timeout: 3000 });
    const patch = mockUpsert.mock.calls[0][0].events;
    expect(Object.keys(patch)).toEqual(['2']);
  });

  it('propagates deletions even before the server copy has hydrated', async () => {
    localStorage.setItem(KEY, JSON.stringify({ '1': { title: 'a', timestamp: 1 } }));
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = setup();
    act(() => {
      const ev = result.current.getStoredEvents();
      delete ev['1'];
      result.current.setStoredEvents(ev);
    });
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled(), { timeout: 3000 });
    expect(mockUpsert.mock.calls[0][0].events).toEqual({ '1': null });
  });

  it('adopts a strictly newer server entry over a stale local one', async () => {
    localStorage.setItem(KEY, JSON.stringify({ '5': { title: 'stale', timestamp: 1 } }));
    mockGet.mockResolvedValue({ events: { '5': { title: 'teammate', timestamp: 9 } } });
    const { result } = setup();
    await waitFor(() => expect(result.current.getStoredEvents()['5']?.title).toBe('teammate'));
  });

  // Regression: `useMutation` returns a fresh object every render. Depending on
  // it made setStoredEvents change identity on every render, and the editor
  // lists it in the deps of the handlers that feed the node-rebuild effect —
  // a ~170/sec render loop that kept every ReactFlow node `visibility:hidden`
  // (measured dimensions were wiped each cycle). Identity MUST stay stable.
  describe('referential stability (editor render-loop regression)', () => {
    it('getStoredEvents / setStoredEvents keep their identity across re-renders', () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      const { result, rerender } = setup();
      const first = { ...result.current };
      for (let i = 0; i < 5; i++) rerender();
      expect(result.current.setStoredEvents).toBe(first.setStoredEvents);
      expect(result.current.getStoredEvents).toBe(first.getStoredEvents);
    });

    it('stays stable through a mutation state change (mutate → pending → settled)', async () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      const { result } = setup();
      const before = result.current.setStoredEvents;
      act(() => {
        const ev = result.current.getStoredEvents();
        ev['1'] = { title: 'x', timestamp: 1 };
        result.current.setStoredEvents(ev);
      });
      await waitFor(() => expect(mockUpsert).toHaveBeenCalled(), { timeout: 3000 });
      expect(result.current.setStoredEvents).toBe(before);
    });

    it('still flushes through the latest mutate after re-renders', async () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      const { result, rerender } = setup();
      rerender();
      act(() => result.current.setStoredEvents({ '9': { title: 'n', timestamp: 1 } }));
      await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1), { timeout: 3000 });
    });
  });
});
