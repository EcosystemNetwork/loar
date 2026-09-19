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
});
