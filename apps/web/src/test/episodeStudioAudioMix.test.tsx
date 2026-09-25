/**
 * Page-level tests for the multi-track audio mix in Episode Studio: it hydrates from the
 * server, shows as lanes, counts as an unsaved edit, autosaves, undoes, and a legacy single
 * soundtrack is folded into a track. tRPC and the router are mocked; everything else is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const t = vi.hoisted(() => ({
  episodes: {
    get: { query: vi.fn() },
    update: { mutate: vi.fn() },
    export: { mutate: vi.fn() },
    exportStatus: { query: vi.fn() },
    listVersions: { query: vi.fn() },
    getVersion: { query: vi.fn() },
  },
  clipLibrary: {
    list: { query: vi.fn() },
    importExternal: { mutate: vi.fn() },
    merge: { mutate: vi.fn() },
    renderStatus: { query: vi.fn() },
    delete: { mutate: vi.fn() },
  },
  gallery: { browse: { query: vi.fn() } },
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

vi.mock('@/utils/trpc', () => ({ trpcClient: t, SERVER_URL: 'http://server' }));
vi.mock('sonner', () => ({ toast: t.toast }));
vi.mock('@/lib/upload-file', () => ({ uploadFile: vi.fn(), VIDEO_TYPES: ['video/mp4'] }));
vi.mock('@/components/DirectUpload', () => ({ DirectUpload: () => <div /> }));
// The audio decoder needs Web Audio + network; lanes render fine without decoded buffers.
vi.mock('@/lib/audioBuffers', () => ({
  audioBuffers: {
    subscribe: () => () => {},
    snapshot: () => 0,
    get: () => undefined,
    status: () => undefined,
    load: () => Promise.resolve(null),
  },
  getAudioContext: () => {
    throw new Error('no Web Audio in tests');
  },
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useParams: () => ({ id: 'u1', episodeId: 'e1' }),
  Link: ({ children, to, params: _p, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Route } from '@/routes/universe/$id/episode.$episodeId.studio';
import { EMPTY_MIX, addClip, newTrack, patchTrack } from '@/lib/audioMix';

const Page = (Route as unknown as { component: React.ComponentType }).component;

const clip = (over = {}) => ({
  nodeId: 'a',
  label: 'Opening',
  videoUrl: 'https://v/a.mp4',
  trimStart: 0,
  trimEnd: 6,
  ...over,
});
const episode = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  universeId: 'u1',
  title: 'Pilot',
  description: '',
  clips: [clip()],
  overlays: [],
  soundtrack: null,
  audioMix: null,
  isCanon: false,
  exportUrl: null,
  updatedAt: new Date(1_000).toISOString(),
  ...over,
});

/** A saved mix: one Voice track holding a 3 s clip at 1 s. */
function savedMix() {
  const withTrack = newTrack(EMPTY_MIX, 'voice');
  const id = withTrack.tracks[0].id;
  return patchTrack(
    addClip(withTrack, id, { url: 'https://a/vo.mp3', label: 'Narration', start: 1, length: 3 })
      .mix,
    id,
    { volume: 0.8 }
  );
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}
const loaded = () => screen.findByDisplayValue('Pilot');
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const lastUpdate = () => {
  const calls = t.episodes.update.mutate.mock.calls;
  return calls[calls.length - 1]?.[0];
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  t.episodes.get.query.mockResolvedValue(episode());
  t.episodes.update.mutate.mockResolvedValue({ ok: true });
  t.episodes.listVersions.query.mockResolvedValue([]);
  t.clipLibrary.list.query.mockResolvedValue([]);
  t.gallery.browse.query.mockResolvedValue({ items: [], nextCursor: null });
  t.episodes.exportStatus.query.mockResolvedValue({ status: 'queued', progress: 0, warnings: [] });
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('audio mix in Episode Studio', () => {
  it('shows a saved mix as lanes, and starts out saved', async () => {
    t.episodes.get.query.mockResolvedValue(episode({ audioMix: savedMix() }));
    mount();
    await loaded();
    expect(screen.getByText('Voice 1')).toBeInTheDocument();
    expect(screen.getByTitle(/^Narration ·/)).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('an episode saved before the mix existed shows no audio tracks, and stays saved', async () => {
    mount();
    await loaded();
    expect(screen.getByText('Clip audio')).toBeInTheDocument(); // the always-present video strip
    expect(screen.queryByText('Voice 1')).toBeNull();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('adding a track is an unsaved edit that autosaves with the mix', async () => {
    mount();
    await loaded();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Add a Music track' }));
    expect(screen.getByText('Music 1')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await advance(3000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1);
    const sent = lastUpdate();
    expect(sent.audioMix.tracks).toHaveLength(1);
    expect(sent.audioMix.tracks[0]).toMatchObject({ name: 'Music 1', kind: 'music', volume: 1 });
    expect(sent.soundtrack).toBeNull();
  });

  it('mute is saved, and undo brings the page back to saved', async () => {
    t.episodes.get.query.mockResolvedValue(episode({ audioMix: savedMix() }));
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Mute track' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(screen.getByText('All changes saved')).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Mute track' }));
    await advance(3000);
    expect(lastUpdate().audioMix.tracks[0]).toMatchObject({ muted: true, volume: 0.8 });
    expect(lastUpdate().audioMix.tracks[0].clips[0]).toMatchObject({
      label: 'Narration',
      start: 1,
    });
  });

  it('a legacy single soundtrack becomes a "Soundtrack" lane, and saving clears the old field', async () => {
    t.episodes.get.query.mockResolvedValue(
      episode({ soundtrack: { url: 'https://a/bed.mp3', label: 'Theme', volume: 0.4 } })
    );
    mount();
    await loaded();
    expect(screen.getByText('Soundtrack')).toBeInTheDocument();
    expect(screen.getByTitle(/^Theme ·.*looped/)).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Mute track' }));
    await advance(3000);
    const sent = lastUpdate();
    expect(sent.soundtrack).toBeNull(); // server drops the legacy bed…
    expect(sent.audioMix.tracks[0]).toMatchObject({
      name: 'Soundtrack',
      kind: 'music',
      muted: true,
    });
    expect(sent.audioMix.tracks[0].clips[0]).toMatchObject({ loop: true, volume: 0.4 }); // …its sound lives on as a clip
  });

  it('the master fader is part of the saved mix', async () => {
    mount();
    await loaded();
    vi.useFakeTimers();
    const master = screen.getByLabelText('Master level') as HTMLInputElement;
    fireEvent.change(master, { target: { value: '0.5' } });
    fireEvent.pointerUp(master);
    await advance(3000);
    expect(lastUpdate().audioMix.mixer.master).toBe(0.5);
  });
});
