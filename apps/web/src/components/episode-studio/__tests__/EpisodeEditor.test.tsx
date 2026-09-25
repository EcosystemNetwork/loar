import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useClipDurations', () => ({
  useClipDurations: () => ({
    durations: { 'https://v/a.mp4': 10, 'https://v/b.mp4': 6 },
    pending: false,
  }),
}));

import { EpisodeEditor } from '../EpisodeEditor';
import type { EpisodeClip } from '../EpisodeClipTimeline';
import { DEFAULT_EXPORT_SETTINGS, type TextOverlay } from '@/lib/episodeCut';

const clip = (nodeId: string, over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId,
  label: nodeId.toUpperCase(),
  videoUrl: `https://v/${nodeId}.mp4`,
  trimStart: 0,
  trimEnd: 0,
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof EpisodeEditor>> = {}) {
  const props = {
    clips: [clip('a'), clip('b')],
    onChange: vi.fn(),
    overlays: [],
    onOverlaysChange: vi.fn(),
    aspect: DEFAULT_EXPORT_SETTINGS.aspect,
    framing: DEFAULT_EXPORT_SETTINGS.framing,
    onDropClips: vi.fn(),
    onDropFiles: vi.fn(),
    onDownloadClip: vi.fn(),
    selectedIds: new Set<string>(),
    onSelectedIdsChange: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    ...over,
  };
  render(<EpisodeEditor {...props} />);
  return props;
}

/** Overlays are owned by the page; this stands in for it so added captions actually appear. */
function StatefulEditor({ onOverlays }: { onOverlays: (o: TextOverlay[]) => void }) {
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  return (
    <EpisodeEditor
      clips={[clip('a'), clip('b')]}
      onChange={vi.fn()}
      overlays={overlays}
      onOverlaysChange={(o) => {
        setOverlays(o);
        onOverlays(o);
      }}
      aspect="16:9"
      framing="fit"
      onDropClips={vi.fn()}
      onDropFiles={vi.fn()}
      onDownloadClip={vi.fn()}
      selectedIds={new Set()}
      onSelectedIdsChange={vi.fn()}
      undo={vi.fn()}
      redo={vi.fn()}
      canUndo={false}
      canRedo={false}
    />
  );
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: k, ...init });

beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('EpisodeEditor keyboard', () => {
  it('S splits the clip under the playhead', () => {
    const props = setup();
    key('ArrowRight', { shiftKey: true }); // playhead → 1s
    key('s');
    const [next] = vi.mocked(props.onChange).mock.calls[0];
    expect(next.map((c: EpisodeClip) => c.nodeId)).toEqual(['a', 'a#2', 'b']);
    expect(next[0].trimEnd).toBe(1);
  });

  it('Delete removes the selection; with none it does nothing', () => {
    const props = setup();
    key('Delete');
    expect(props.onChange).not.toHaveBeenCalled();
    cleanup();
    const withSel = setup({ selectedIds: new Set(['a']) });
    key('Delete');
    expect(vi.mocked(withSel.onChange).mock.calls[0][0].map((c: EpisodeClip) => c.nodeId)).toEqual([
      'b',
    ]);
    expect(withSel.onSelectedIdsChange).toHaveBeenCalledWith(new Set());
  });

  it('Ctrl+D duplicates the selected clip next to itself', () => {
    const props = setup({ selectedIds: new Set(['b']) });
    key('d', { ctrlKey: true });
    expect(vi.mocked(props.onChange).mock.calls[0][0].map((c: EpisodeClip) => c.nodeId)).toEqual([
      'a',
      'b',
      'b#2',
    ]);
  });

  it('C drops a caption at the playhead and opens its editor', () => {
    const onOverlays = vi.fn();
    render(<StatefulEditor onOverlays={onOverlays} />);
    key('c');
    const [overlays] = onOverlays.mock.calls[0];
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ start: 0, end: 3, position: 'bottom' });
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
  });

  it('? opens the shortcuts list', () => {
    setup();
    key('?');
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });

  it('Space toggles playback', () => {
    setup();
    expect(screen.getByRole('button', { name: /Play \(Space\)/ })).toBeInTheDocument();
    key(' ');
    expect(screen.getByRole('button', { name: /Pause \(Space\)/ })).toBeInTheDocument();
  });

  it('undo / redo shortcuts', () => {
    const props = setup();
    key('z', { ctrlKey: true });
    expect(props.undo).toHaveBeenCalledTimes(1);
    key('z', { ctrlKey: true, shiftKey: true });
    key('y', { ctrlKey: true });
    expect(props.redo).toHaveBeenCalledTimes(2);
  });

  it('ignores shortcuts while typing in a field', () => {
    const onOverlays = vi.fn();
    render(<StatefulEditor onOverlays={onOverlays} />);
    key('c'); // opens the caption editor, giving us a textarea
    const box = screen.getByLabelText('Text');
    onOverlays.mockClear();
    fireEvent.keyDown(box, { key: 'c', bubbles: true }); // would add another caption
    fireEvent.keyDown(box, { key: 'Delete', bubbles: true }); // would delete this one
    expect(onOverlays).not.toHaveBeenCalled();
  });

  it('Delete removes the selected caption when no clip is selected', () => {
    const overlay = {
      id: 'o1',
      text: 'Hi',
      start: 1,
      end: 3,
      position: 'bottom',
      size: 'md',
    } as const;
    const props = setup({ overlays: [overlay] });
    fireEvent.click(screen.getByRole('button', { name: 'Caption: Hi' })); // no-op click
    fireEvent(
      screen.getByRole('button', { name: 'Caption: Hi' }),
      new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    );
    fireEvent(window, new MouseEvent('pointerup'));
    key('Delete');
    expect(props.onOverlaysChange).toHaveBeenLastCalledWith([]);
  });
});

describe('EpisodeEditor context actions', () => {
  it('move-later via Alt+→ on a focused clip reorders through onChange', () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole('listitem', { name: /^A,/ }), {
      key: 'ArrowRight',
      altKey: true,
    });
    expect(vi.mocked(props.onChange).mock.calls[0][0].map((c: EpisodeClip) => c.nodeId)).toEqual([
      'b',
      'a',
    ]);
  });

  it('will not move the last clip later', () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole('listitem', { name: /^B,/ }), {
      key: 'ArrowRight',
      altKey: true,
    });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('context-menu Download hands the clip to the page', async () => {
    const props = setup();
    fireEvent.contextMenu(screen.getByRole('listitem', { name: /^B,/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Download source/ }));
    expect(props.onDownloadClip).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'b' }));
  });

  it('context-menu Delete on an unselected clip removes just that clip', async () => {
    const props = setup({ selectedIds: new Set(['a']) });
    fireEvent.contextMenu(screen.getByRole('listitem', { name: /^B,/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    expect(vi.mocked(props.onChange).mock.calls[0][0].map((c: EpisodeClip) => c.nodeId)).toEqual([
      'a',
    ]);
  });
});

describe('EpisodeEditor inspector', () => {
  it('appears for a selection and patches every selected clip', () => {
    const props = setup({ selectedIds: new Set(['a', 'b']) });
    fireEvent.click(screen.getByRole('button', { name: /^(Un)?mute$/i }));
    const next = vi.mocked(props.onChange).mock.calls[0][0] as EpisodeClip[];
    expect(next.map((c) => c.volume)).toEqual([0, 0]);
  });

  it('is absent with nothing selected', () => {
    setup();
    expect(screen.queryByText('Audio & fades')).toBeNull();
  });
});

describe('EpisodeEditor onboarding', () => {
  it('shows the hint once and remembers it was dismissed', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText('New to the editor?')).toBeNull();
    expect(localStorage.getItem('loar:episode-studio-hint-dismissed')).toBe('1');
    cleanup();
    setup();
    expect(screen.queryByText('New to the editor?')).toBeNull();
  });

  it('announces edits to screen readers', () => {
    setup({ selectedIds: new Set(['b']) });
    key('d', { ctrlKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('Clip duplicated');
  });
});
