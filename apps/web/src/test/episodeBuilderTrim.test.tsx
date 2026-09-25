/**
 * Regression: building an episode from timeline nodes must carry each scene's trim.
 * The editor stores it in milliseconds on the node ("trimmed" badge); the episode wants seconds.
 * It used to be dropped (trimStart/trimEnd = 0), so the published episode played the whole file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const t = vi.hoisted(() => ({
  episodes: {
    create: { mutate: vi.fn() },
    update: { mutate: vi.fn() },
    export: { mutate: vi.fn() },
    exportStatus: { query: vi.fn() },
  },
}));
vi.mock('@/utils/trpc', () => ({ trpcClient: t, SERVER_URL: 'http://server' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/ipfs-url', () => ({ resolveIpfsUrlPreferred: (u: string) => u }));

import { EpisodeBuilder } from '@/components/episodes/EpisodeBuilder';

const node = (id: string, data: Record<string, unknown>) =>
  ({
    id,
    type: 'timelineEvent',
    position: { x: 0, y: 0 },
    data: {
      label: `Scene ${id}`,
      videoUrl: `https://v/${id}.mp4`,
      eventId: id,
      nodeType: 'scene',
      ...data,
    },
  }) as any;

function mount(nodes: any[], initialNodeIds: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EpisodeBuilder
        universeId="u1"
        nodes={nodes}
        initialNodeIds={initialNodeIds}
        onClose={() => {}}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  t.episodes.create.mutate.mockResolvedValue({ id: 'e1' });
  t.episodes.exportStatus.query.mockResolvedValue({ status: 'queued', progress: 0 });
});
afterEach(cleanup);

describe('EpisodeBuilder', () => {
  it("sends each selected scene's trim, converted from ms to seconds", async () => {
    mount(
      [
        node('a', { trimStart: 1500, trimEnd: 6500 }),
        node('b', {}), // untrimmed
        node('c', { trimStart: 2000 }), // in-point only
      ],
      ['a', 'b', 'c']
    );
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(t.episodes.create.mutate).toHaveBeenCalled());
    const { clips } = t.episodes.create.mutate.mock.calls[0][0];
    expect(clips).toMatchObject([
      { nodeId: 'a', trimStart: 1.5, trimEnd: 6.5 },
      { nodeId: 'b', trimStart: 0, trimEnd: 0 },
      { nodeId: 'c', trimStart: 2, trimEnd: 0 },
    ]);
  });
});
