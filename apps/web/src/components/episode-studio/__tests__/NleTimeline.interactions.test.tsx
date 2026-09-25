import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NleTimeline } from '../NleTimeline';
import { GUTTER_PX } from '../AudioLanes';
import type { EpisodeClip } from '../EpisodeClipTimeline';
import { CLIP_DRAG_MIME, encodeClipDrag, type TextOverlay } from '@/lib/episodeCut';

const clip = (nodeId: string, over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId,
  label: nodeId.toUpperCase(),
  videoUrl: `https://v/${nodeId}.mp4`,
  trimStart: 0,
  trimEnd: 0,
  ...over,
});
const DUR = { 'https://v/a.mp4': 10, 'https://v/b.mp4': 6 };
const overlay = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'o1',
  text: 'Hello',
  start: 2,
  end: 5,
  position: 'bottom',
  size: 'md',
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof NleTimeline>> = {}) {
  const props = {
    clips: [clip('a'), clip('b')],
    durations: DUR,
    playhead: 0,
    pxPerSec: 20,
    snapping: false,
    follow: false,
    locked: false,
    selectedIds: new Set<string>(),
    onSelectedIdsChange: vi.fn(),
    onPlayhead: vi.fn(),
    onCommit: vi.fn(),
    onPxPerSecChange: vi.fn(),
    onClipAction: vi.fn(),
    onDropClips: vi.fn(),
    onDropFiles: vi.fn(),
    onOverlaysCommit: vi.fn(),
    onOverlayAdd: vi.fn(),
    onSelectOverlay: vi.fn(),
    ...over,
  };
  const utils = render(<NleTimeline {...props} />);
  return { props, ...utils };
}

// jsdom has no PointerEvent; React only reads type/clientX/button/modifiers.
const pointer = (target: Element, type: string, init: MouseEventInit = {}) =>
  fireEvent(target, new MouseEvent(type, { bubbles: true, button: 0, ...init }));

/** jsdom has no DragEvent either: a MouseEvent carries clientX, dataTransfer is attached by hand. */
function drag(
  type: 'dragover' | 'drop' | 'dragleave',
  target: Element,
  init: { clientX?: number; relatedTarget?: EventTarget | null; dataTransfer?: unknown } = {}
) {
  const { dataTransfer, ...mouse } = init;
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...mouse });
  if (dataTransfer) Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  fireEvent(target, ev);
}

const dt = (types: string[], data: Record<string, string> = {}, files: File[] = []) => ({
  dataTransfer: { types, files, getData: (t: string) => data[t] ?? '', dropEffect: '' },
});

afterEach(cleanup);

describe('accessibility', () => {
  it('exposes each clip as a focusable, labelled list item', () => {
    setup({ selectedIds: new Set(['b']) });
    const a = screen.getByRole('listitem', { name: /^A, 10\.0 seconds, clip 1 of 2\./ });
    expect(a).toHaveAttribute('tabindex', '0');
    expect(a).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('listitem', { name: /^B, .*selected/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('list', { name: 'Episode clips' })).toBeInTheDocument();
  });

  it('Enter toggles selection; Alt+arrows ask to move the clip', () => {
    const { props } = setup({ selectedIds: new Set(['a']) });
    const a = screen.getByRole('listitem', { name: /^A,/ });
    fireEvent.keyDown(a, { key: 'Enter' });
    expect(props.onSelectedIdsChange).toHaveBeenLastCalledWith(new Set());
    const b = screen.getByRole('listitem', { name: /^B,/ });
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(props.onSelectedIdsChange).toHaveBeenLastCalledWith(new Set(['a', 'b']));
    fireEvent.keyDown(b, { key: 'ArrowLeft', altKey: true });
    expect(props.onClipAction).toHaveBeenLastCalledWith('move-earlier', 'b', 10);
    fireEvent.keyDown(a, { key: 'ArrowRight', altKey: true });
    expect(props.onClipAction).toHaveBeenLastCalledWith('move-later', 'a', 0);
  });

  it('disables touch scrolling on gesture surfaces so pointer drags work on phones', () => {
    setup();
    expect(screen.getByRole('listitem', { name: /^A,/ }).style.touchAction).toBe('none');
  });
});

describe('context menu', () => {
  it('opens on right-click, selects the clip, and reports the chosen action', async () => {
    const { props } = setup();
    fireEvent.contextMenu(screen.getByRole('listitem', { name: /^B,/ }), { clientX: 300 });
    expect(props.onSelectedIdsChange).toHaveBeenCalledWith(new Set(['b']));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Duplicate/ }));
    expect(props.onClipAction).toHaveBeenCalledWith('duplicate', 'b', expect.any(Number));
  });

  it('disables moves that would fall off either end', async () => {
    setup();
    fireEvent.contextMenu(screen.getByRole('listitem', { name: /^A,/ }));
    expect(await screen.findByRole('menuitem', { name: /Move earlier/ })).toHaveAttribute(
      'data-disabled'
    );
    expect(screen.getByRole('menuitem', { name: /Move later/ })).not.toHaveAttribute(
      'data-disabled'
    );
  });

  it('blocks edit actions while durations are still loading', async () => {
    setup({ locked: true });
    fireEvent.contextMenu(screen.getByRole('listitem', { name: /^A,/ }));
    expect(await screen.findByRole('menuitem', { name: /Split here/ })).toHaveAttribute(
      'data-disabled'
    );
    expect(screen.getByRole('menuitem', { name: /Delete/ })).not.toHaveAttribute('data-disabled');
  });
});

describe('drag and drop', () => {
  const track = () => screen.getByRole('list', { name: 'Episode clips' });

  it('drops library clips into the slot under the cursor', () => {
    const { props } = setup();
    const payload = encodeClipDrag([{ id: 'x', label: 'X', videoUrl: 'https://v/x.mp4' }]);
    // jsdom lays everything out at x=0, so (clientX − GUTTER_PX)/pxPerSec is the timeline time
    // (each row starts with a GUTTER_PX header column).
    drag('drop', track(), {
      clientX: 0,
      ...dt([CLIP_DRAG_MIME], { [CLIP_DRAG_MIME]: payload }),
    });
    expect(props.onDropClips).toHaveBeenLastCalledWith(
      [{ id: 'x', label: 'X', videoUrl: 'https://v/x.mp4' }],
      0
    );
    drag('drop', track(), {
      clientX: GUTTER_PX + 100, // 5s: past A's midpoint → before B
      ...dt([CLIP_DRAG_MIME], { [CLIP_DRAG_MIME]: payload }),
    });
    expect(props.onDropClips).toHaveBeenLastCalledWith(expect.any(Array), 1);
    drag('drop', track(), {
      clientX: 1000, // far right → append
      ...dt([CLIP_DRAG_MIME], { [CLIP_DRAG_MIME]: payload }),
    });
    expect(props.onDropClips).toHaveBeenLastCalledWith(expect.any(Array), 2);
  });

  it('hands dropped video files to onDropFiles and ignores everything else', () => {
    const { props } = setup();
    const video = new File(['x'], 'a.mp4', { type: 'video/mp4' });
    const doc = new File(['x'], 'notes.txt', { type: 'text/plain' });
    drag('drop', track(), { clientX: 0, ...dt(['Files'], {}, [video, doc]) });
    expect(props.onDropFiles).toHaveBeenCalledWith([video], 0);
    vi.mocked(props.onDropFiles).mockClear();
    drag('drop', track(), { clientX: 0, ...dt(['Files'], {}, [doc]) });
    expect(props.onDropFiles).not.toHaveBeenCalled();
  });

  it('rejects a foreign payload without inserting anything', () => {
    const { props } = setup();
    drag('drop', track(), {
      clientX: 0,
      ...dt([CLIP_DRAG_MIME], { [CLIP_DRAG_MIME]: '{"not":"an array"}' }),
    });
    expect(props.onDropClips).not.toHaveBeenCalled();
    expect(props.onDropFiles).not.toHaveBeenCalled();
  });

  it('ignores drags it cannot use (plain text)', () => {
    const { props } = setup();
    drag('drop', track(), { clientX: 0, ...dt(['text/plain']) });
    expect(props.onDropClips).not.toHaveBeenCalled();
  });

  it('shows a drop marker while a clip is dragged over, and clears it on leave', () => {
    const { container } = setup();
    drag('dragover', track(), { clientX: 100, ...dt([CLIP_DRAG_MIME]) });
    expect(container.querySelector('.bg-primary.w-0\\.5')).not.toBeNull();
    drag('dragleave', container.firstChild as Element, { relatedTarget: document.body });
    expect(container.querySelector('.bg-primary.w-0\\.5')).toBeNull();
  });
});

describe('caption lane', () => {
  it('draws each caption where it plays and offers to add one when empty', () => {
    const { unmount } = setup({ overlays: [overlay()] });
    const bar = screen.getByRole('button', { name: 'Caption: Hello' });
    expect(bar.style.left).toBe('40px'); // 2s × 20
    expect(bar.style.width).toBe('60px'); // 3s × 20
    unmount();
    setup();
    expect(screen.getByText(/double-click to add one/i)).toBeInTheDocument();
  });

  it('adds a caption where the lane is double-clicked', () => {
    const { props } = setup();
    fireEvent.doubleClick(screen.getByLabelText('Captions'), { clientX: GUTTER_PX + 60 });
    expect(props.onOverlayAdd).toHaveBeenCalledWith(3);
  });

  it('moves a caption by dragging it and commits once on release', () => {
    const { props } = setup({ overlays: [overlay()] });
    const bar = screen.getByRole('button', { name: 'Caption: Hello' });
    pointer(bar, 'pointerdown', { clientX: 100 });
    expect(props.onSelectOverlay).toHaveBeenCalledWith('o1');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140 })); // +2s
    });
    expect(props.onOverlaysCommit).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 140 }));
    });
    expect(props.onOverlaysCommit).toHaveBeenCalledTimes(1);
    const [next] = vi.mocked(props.onOverlaysCommit).mock.calls[0];
    expect(next[0]).toMatchObject({ id: 'o1', start: 4, end: 7 });
  });

  it('resizes from the right edge but never below the minimum length', () => {
    const { props } = setup({ overlays: [overlay()] });
    const bar = screen.getByRole('button', { name: 'Caption: Hello' });
    const handle = bar.querySelectorAll('[aria-hidden]')[1] as HTMLElement;
    pointer(handle, 'pointerdown', { clientX: 100 });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0 })); // −5s
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0 }));
    });
    const [next] = vi.mocked(props.onOverlaysCommit).mock.calls[0];
    expect(next[0].start).toBe(2);
    expect(next[0].end).toBe(2.5);
  });

  it('does not commit when a caption was only clicked', () => {
    const { props } = setup({ overlays: [overlay()] });
    const bar = screen.getByRole('button', { name: 'Caption: Hello' });
    pointer(bar, 'pointerdown', { clientX: 100 });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100 }));
    });
    expect(props.onOverlaysCommit).not.toHaveBeenCalled();
  });

  it('shows fade ramps and a volume marker on the clips they belong to', () => {
    const { container } = setup({
      clips: [clip('a', { fadeIn: 1, fadeOut: 2, volume: 0.5 }), clip('b')],
    });
    expect(container.querySelector('.bg-gradient-to-r')).not.toBeNull();
    expect(container.querySelector('.bg-gradient-to-l')).not.toBeNull();
  });
});
