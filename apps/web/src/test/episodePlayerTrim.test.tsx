/**
 * The public episode page must play only the trimmed part of each clip.
 * Regression: a scene trimmed in the timeline editor was labelled "trimmed" there but the
 * published page played the whole file, because episodes built from timeline nodes stored
 * trimStart/trimEnd = 0 and the player never applied trims anyway.
 *
 * tRPC and the router are mocked; the page, its <video> handling and the trim rules are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const t = vi.hoisted(() => ({
  episodes: { get: { query: vi.fn() } },
  universes: { get: { query: vi.fn() } },
  universeEvents: { get: { query: vi.fn() } },
}));

vi.mock('@/utils/trpc', () => ({ trpcClient: t, SERVER_URL: 'http://server' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useWatchSession', () => ({ useWatchSession: () => {} }));
vi.mock('@/lib/offline-cache', () => ({
  isSaved: async () => false,
  offlineSupported: () => false,
  removeEpisode: vi.fn(),
  saveEpisode: vi.fn(),
}));
vi.mock('@/components/SmartImage', () => ({ SmartImage: () => null }));
vi.mock('@/utils/ipfs-url', () => ({ resolveIpfsUrlPreferred: (u: string) => u }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useParams: () => ({ id: 'e1' }),
  Link: ({ children, to, params: _p, search: _s, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Route } from '@/routes/episode.$id';

const Page = (Route as unknown as { component: React.ComponentType }).component;

const clip = (over: Record<string, unknown> = {}) => ({
  nodeId: '1',
  label: 'Part 1',
  videoUrl: 'https://v/1.mp4',
  trimStart: 0,
  trimEnd: 0,
  ...over,
});
const episode = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  universeId: 'U1',
  title: 'Pilot',
  clips: [clip(), clip({ nodeId: '2', label: 'Part 2', videoUrl: 'https://v/2.mp4' })],
  exportUrl: null,
  ...over,
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}

const player = () => document.querySelector('video') as HTMLVideoElement;
/** jsdom doesn't play media: set the element's clock and fire the event a browser would. */
function tick(video: HTMLVideoElement, currentTime: number) {
  Object.defineProperty(video, 'currentTime', {
    value: currentTime,
    writable: true,
    configurable: true,
  });
  fireEvent.timeUpdate(video);
}
const partLabels = () => screen.getAllByText(/^Part \d/).map((n) => n.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom stubs for media methods it doesn't implement
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  t.universes.get.query.mockResolvedValue({ data: { id: 'U1', name: 'Test Universe' } });
  t.universeEvents.get.query.mockResolvedValue({ events: {} });
  t.episodes.get.query.mockResolvedValue(episode());
});
afterEach(cleanup);

describe('episode player honours trims', () => {
  it('starts a trimmed clip at its in-point and hands over at its out-point', async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({
        clips: [
          clip({ trimStart: 2, trimEnd: 6 }),
          clip({ nodeId: '2', videoUrl: 'https://v/2.mp4' }),
        ],
      })
    );
    mount();
    await waitFor(() => expect(player()).not.toBeNull());
    expect(player().src).toBe('https://v/1.mp4');

    // metadata loaded at t=0 → jump to the in-point
    const v = player();
    Object.defineProperty(v, 'currentTime', { value: 0, writable: true, configurable: true });
    fireEvent.loadedMetadata(v);
    expect(v.currentTime).toBe(2);

    tick(v, 5); // inside the trim: keeps playing on the same clip
    expect(player().src).toBe('https://v/1.mp4');

    tick(v, 6); // out-point reached (the file itself would run on) → next clip
    await waitFor(() => expect(player().src).toBe('https://v/2.mp4'));
  });

  it('stops on the last clip at its out-point instead of playing the rest of the file', async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({ clips: [clip({ trimStart: 1, trimEnd: 4 })] })
    );
    mount();
    await waitFor(() => expect(player()).not.toBeNull());
    const v = player();
    tick(v, 4.2);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(player().src).toBe('https://v/1.mp4'); // no clip to advance to
  });

  it('advances only once however many timeupdates arrive past the out-point', async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({
        clips: [
          clip({ trimEnd: 3 }),
          clip({ nodeId: '2', videoUrl: 'https://v/2.mp4' }),
          clip({ nodeId: '3', videoUrl: 'https://v/3.mp4' }),
        ],
      })
    );
    mount();
    await waitFor(() => expect(player()).not.toBeNull());
    const v = player();
    tick(v, 3.1);
    tick(v, 3.4);
    tick(v, 3.9);
    await waitFor(() => expect(player().src).toBe('https://v/2.mp4'));
  });

  it('snaps a viewer who scrubs before the in-point back to it', async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({ clips: [clip({ trimStart: 3, trimEnd: 8 })] })
    );
    mount();
    await waitFor(() => expect(player()).not.toBeNull());
    const v = player();
    tick(v, 0.5);
    expect(v.currentTime).toBe(3);
  });

  it('an untrimmed clip plays straight through, untouched', async () => {
    mount();
    await waitFor(() => expect(player()).not.toBeNull());
    const v = player();
    tick(v, 0.1);
    tick(v, 9999);
    expect(v.currentTime).toBe(9999);
    expect(player().src).toBe('https://v/1.mp4');
  });
});

describe('scene trims from the timeline editor', () => {
  it("applies a scene's trim to an episode clip that has none of its own", async () => {
    t.universeEvents.get.query.mockResolvedValue({
      events: { '1': { trimStart: 2000, trimEnd: 6500 } },
    });
    mount();
    await waitFor(() =>
      expect(t.universeEvents.get.query).toHaveBeenCalledWith({ universeId: 'u1' })
    );
    const v = await waitFor(() => {
      const el = player();
      expect(el).not.toBeNull();
      return el;
    });
    // wait for the events to land, then the trim is live: past 6.5 s hands over to part 2
    await waitFor(() => {
      tick(v, 6.6);
      expect(player().src).toBe('https://v/2.mp4');
    });
  });

  it("the episode clip's own trim wins over the scene's", async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({
        clips: [
          clip({ trimStart: 0, trimEnd: 9 }),
          clip({ nodeId: '2', videoUrl: 'https://v/2.mp4' }),
        ],
      })
    );
    t.universeEvents.get.query.mockResolvedValue({
      events: { '1': { trimStart: 2000, trimEnd: 6500 } },
    });
    mount();
    await waitFor(() => expect(t.universeEvents.get.query).toHaveBeenCalled());
    const v = player();
    tick(v, 7); // past the scene's out-point, before the clip's own
    expect(player().src).toBe('https://v/1.mp4');
    tick(v, 9.1);
    await waitFor(() => expect(player().src).toBe('https://v/2.mp4'));
  });

  it('still plays when the scene events cannot be loaded', async () => {
    t.universeEvents.get.query.mockRejectedValue(new Error('offline'));
    mount();
    await waitFor(() => expect(player()).not.toBeNull());
    tick(player(), 50);
    expect(player().src).toBe('https://v/1.mp4');
  });
});

describe('merged export', () => {
  const merged = { exportUrl: 'https://v/merged.mp4' };

  it('is the default view when no clip needs a trim the export lacks', async () => {
    t.episodes.get.query.mockResolvedValue(episode(merged));
    mount();
    await waitFor(() => expect(player().src).toBe('https://v/merged.mp4'));
  });

  it('is skipped when a scene trim postdates it, so the trim is not bypassed by a stale merged file', async () => {
    t.episodes.get.query.mockResolvedValue(episode(merged));
    t.universeEvents.get.query.mockResolvedValue({
      events: { '1': { trimStart: 1000, trimEnd: 3000 } },
    });
    mount();
    await waitFor(() => expect(player().src).toBe('https://v/1.mp4'));
  });

  it("stays merged when the episode's clips carry their own trims (the export already applied them)", async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({
        ...merged,
        clips: [
          clip({ trimStart: 1, trimEnd: 3 }),
          clip({ nodeId: '2', videoUrl: 'https://v/2.mp4' }),
        ],
      })
    );
    t.universeEvents.get.query.mockResolvedValue({
      events: { '1': { trimStart: 1000, trimEnd: 3000 } },
    });
    mount();
    await waitFor(() => expect(player().src).toBe('https://v/merged.mp4'));
    // give the events query time to settle and confirm it does not flip to clips
    await new Promise((r) => setTimeout(r, 50));
    expect(player().src).toBe('https://v/merged.mp4');
  });
});
