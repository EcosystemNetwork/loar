/**
 * Page-level tests for Episode Studio: what the creator sees and what reaches
 * the server. The network (tRPC), router and toasts are mocked; everything
 * else — autosave, draft recovery, export, undo — is the real code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { EMPTY_CUT, DEFAULT_EXPORT_SETTINGS } from '@/lib/episodeCut';
import { saveDraft } from '@/lib/episodeDraft';

const Page = (Route as unknown as { component: React.ComponentType }).component;

const clip = (over = {}) => ({
  nodeId: 'a',
  label: 'Opening',
  videoUrl: 'https://v/a.mp4',
  trimStart: 0,
  trimEnd: 0,
  ...over,
});
const episode = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  universeId: 'u1',
  title: 'Pilot',
  description: 'First episode',
  clips: [clip()],
  overlays: [],
  soundtrack: null,
  isCanon: false,
  exportUrl: null,
  updatedAt: new Date(1_000).toISOString(),
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

/** The clip-count badge in the page header (the lanes below also mention clips). */
const headerBadge = () =>
  within(screen.getByRole('heading', { name: 'Episode Studio' }).parentElement as HTMLElement);

const loaded = () => screen.findByDisplayValue('Pilot');
const typeTitle = (value: string) =>
  fireEvent.change(screen.getByLabelText('Title'), { target: { value } });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  t.episodes.get.query.mockResolvedValue(episode());
  t.episodes.update.mutate.mockResolvedValue({ ok: true });
  t.episodes.listVersions.query.mockResolvedValue([]);
  t.clipLibrary.list.query.mockResolvedValue([]);
  t.gallery.browse.query.mockResolvedValue({ items: [], nextCursor: null });
  t.episodes.exportStatus.query.mockResolvedValue({ status: 'queued', progress: 0, warnings: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Episode Studio page', () => {
  it('loads the episode and starts out saved', async () => {
    mount();
    await loaded();
    expect(screen.getByDisplayValue('First episode')).toBeInTheDocument();
    expect(headerBadge().getByText('1 clips')).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('autosaves an edit after a pause, as an auto restore point, with the whole cut', async () => {
    mount();
    await loaded();
    vi.useFakeTimers();
    typeTitle('Pilot v2');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await advance(2000);
    expect(t.episodes.update.mutate).not.toHaveBeenCalled();
    await advance(1000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1);
    expect(t.episodes.update.mutate).toHaveBeenCalledWith({
      episodeId: 'e1',
      title: 'Pilot v2',
      description: 'First episode',
      clips: [clip()],
      overlays: [],
      soundtrack: null,
      audioMix: expect.anything(),
      exportSettings: DEFAULT_EXPORT_SETTINGS,
      versionKind: 'auto',
    });
    expect(screen.getByText(/^Saved /)).toBeInTheDocument();
    await advance(10_000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1); // clean → no more saves
  });

  it('coalesces a burst of typing into one save', async () => {
    mount();
    await loaded();
    vi.useFakeTimers();
    for (const v of ['P', 'Pi', 'Pil', 'Pilo', 'Pilot!']) {
      typeTitle(v);
      await advance(500);
    }
    await advance(3000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1);
    expect(t.episodes.update.mutate.mock.calls[0][0].title).toBe('Pilot!');
  });

  it('the Save button saves immediately as a manual restore point', async () => {
    mount();
    await loaded();
    typeTitle('Pilot v2');
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1));
    expect(t.episodes.update.mutate.mock.calls[0][0].versionKind).toBe('manual');
    await waitFor(() => expect(t.toast.success).toHaveBeenCalledWith('Episode saved'));
  });

  it('⌘S saves instead of opening the browser dialog', async () => {
    mount();
    await loaded();
    typeTitle('Pilot v2');
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() => expect(t.episodes.update.mutate).toHaveBeenCalled());
  });

  it('does not retry a failing save in a loop, and says so', async () => {
    t.episodes.update.mutate.mockRejectedValue(new Error('offline'));
    mount();
    await loaded();
    vi.useFakeTimers();
    typeTitle('Pilot v2');
    await advance(3000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Couldn’t save')).toBeInTheDocument();
    await advance(30_000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1);
    // the next edit tries again
    typeTitle('Pilot v3');
    await advance(3000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(2);
  });

  it('turns read-only when the server says the user is not the creator', async () => {
    t.episodes.update.mutate.mockRejectedValue({ data: { code: 'FORBIDDEN' } });
    mount();
    await loaded();
    vi.useFakeTimers();
    typeTitle('Mine now');
    await advance(3000);
    expect(screen.getAllByText(/creator/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    await advance(30_000);
    expect(t.episodes.update.mutate).toHaveBeenCalledTimes(1);
  });

  it('backs edits up locally and clears the backup once the server has them', async () => {
    mount();
    await loaded();
    vi.useFakeTimers();
    typeTitle('Pilot v2');
    await advance(900);
    expect(localStorage.getItem('loar:episode-draft:e1')).toContain('Pilot v2');
    await advance(3000);
    expect(localStorage.getItem('loar:episode-draft:e1')).toBeNull();
  });

  it('offers to restore a newer unsaved local draft, and applies it', async () => {
    saveDraft('e1', {
      title: 'Recovered title',
      description: 'd',
      cut: { ...EMPTY_CUT, clips: [clip()] },
      settings: DEFAULT_EXPORT_SETTINGS,
      savedAt: 5_000,
    });
    mount();
    await loaded();
    expect(screen.getByText(/Unsaved changes found/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore them' }));
    expect(screen.getByDisplayValue('Recovered title')).toBeInTheDocument();
    expect(screen.queryByText(/Unsaved changes found/)).toBeNull();
  });

  it('can discard the local draft', async () => {
    saveDraft('e1', {
      title: 'Recovered title',
      description: 'd',
      cut: { ...EMPTY_CUT, clips: [clip()] },
      settings: DEFAULT_EXPORT_SETTINGS,
      savedAt: 5_000,
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByDisplayValue('Pilot')).toBeInTheDocument();
    expect(localStorage.getItem('loar:episode-draft:e1')).toBeNull();
  });

  it('ignores a local draft that is older than, or identical to, the server copy', async () => {
    saveDraft('e1', {
      title: 'Old',
      description: 'd',
      cut: { ...EMPTY_CUT, clips: [clip()] },
      settings: DEFAULT_EXPORT_SETTINGS,
      savedAt: 10, // before the server's updatedAt (1000)
    });
    mount();
    await loaded();
    expect(screen.queryByText(/Unsaved changes found/)).toBeNull();
  });

  it('exports: saves first, starts the job, remembers it, and shows progress', async () => {
    t.episodes.export.mutate.mockResolvedValue({ jobId: 'job1', credits: 0 });
    t.episodes.exportStatus.query.mockResolvedValue({
      status: 'downloading',
      progress: 35,
      warnings: [],
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Export episode/ }));
    await waitFor(() => expect(t.episodes.export.mutate).toHaveBeenCalledWith({ episodeId: 'e1' }));
    // the render must read what is on screen: a manual restore point goes first
    expect(t.episodes.update.mutate.mock.invocationCallOrder[0]).toBeLessThan(
      t.episodes.export.mutate.mock.invocationCallOrder[0]
    );
    expect(t.episodes.update.mutate.mock.calls[0][0].versionKind).toBe('manual');
    expect(localStorage.getItem('loar:episode-export-job:e1')).toBe('job1');
    expect(await screen.findByRole('progressbar', { name: 'Export progress' })).toHaveAttribute(
      'aria-valuenow',
      '35'
    );
    expect(screen.getByText('Preparing clips…')).toBeInTheDocument();
  });

  it('does not start an export if the pre-export save fails', async () => {
    t.episodes.update.mutate.mockRejectedValue(new Error('offline'));
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Export episode/ }));
    await waitFor(() => expect(t.toast.error).toHaveBeenCalled());
    expect(t.episodes.export.mutate).not.toHaveBeenCalled();
  });

  it('resumes an export that was running when the creator left', async () => {
    localStorage.setItem('loar:episode-export-job:e1', 'jobX');
    t.episodes.exportStatus.query.mockResolvedValue({
      status: 'uploading',
      progress: 90,
      warnings: [],
    });
    mount();
    await loaded();
    expect(await screen.findByText('Uploading your episode…')).toBeInTheDocument();
    expect(t.episodes.exportStatus.query).toHaveBeenCalledWith({ jobId: 'jobX' });
  });

  it('announces completion and forgets the job', async () => {
    localStorage.setItem('loar:episode-export-job:e1', 'jobX');
    t.episodes.exportStatus.query.mockResolvedValue({
      status: 'completed',
      progress: 100,
      outputUrl: 'https://cdn/out.mp4',
      warnings: ['The soundtrack was skipped: HTTP 404'],
    });
    mount();
    await loaded();
    await waitFor(() => expect(t.toast.success).toHaveBeenCalledWith('Episode exported'));
    expect(localStorage.getItem('loar:episode-export-job:e1')).toBeNull();
    expect(await screen.findByText('Your episode is ready')).toBeInTheDocument();
    expect(screen.getByText(/soundtrack was skipped/)).toBeInTheDocument();
  });

  it('drops a remembered job the server no longer knows about', async () => {
    localStorage.setItem('loar:episode-export-job:e1', 'gone');
    t.episodes.exportStatus.query.mockRejectedValue(new Error('NOT_FOUND'));
    mount();
    await loaded();
    await waitFor(() => expect(localStorage.getItem('loar:episode-export-job:e1')).toBeNull());
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('opens version history and restores a version as an undoable edit', async () => {
    t.episodes.listVersions.query.mockResolvedValue([
      {
        id: 'v1',
        createdAt: new Date(2_000).toISOString(),
        kind: 'manual',
        title: 'Older',
        clipCount: 2,
      },
    ]);
    t.episodes.getVersion.query.mockResolvedValue({
      id: 'v1',
      createdAt: new Date(2_000).toISOString(),
      title: 'Older cut',
      description: 'old',
      clips: [clip(), clip({ nodeId: 'b', label: 'B' })],
      overlays: [],
      soundtrack: null,
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByDisplayValue('Older cut')).toBeInTheDocument());
    expect(headerBadge().getByText('2 clips')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument(); // it will autosave next
  });

  it('shows the not-found state for a missing episode', async () => {
    t.episodes.get.query.mockResolvedValue(null);
    mount();
    expect(await screen.findByText('Episode not found.')).toBeInTheDocument();
  });
});
