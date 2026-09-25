import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NleTimeline } from '../NleTimeline';
import type { EpisodeClip } from '../EpisodeClipTimeline';

const clip = (nodeId: string, over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId,
  label: nodeId.toUpperCase(),
  videoUrl: `https://v/${nodeId}.mp4`,
  trimStart: 0,
  trimEnd: 0,
  ...over,
});

const DUR = { 'https://v/a.mp4': 10, 'https://v/b.mp4': 6 };

function setup(over: Partial<React.ComponentProps<typeof NleTimeline>> = {}) {
  const props = {
    clips: [clip('a'), clip('b', { trimStart: 1, trimEnd: 4 })],
    durations: DUR,
    playhead: 0,
    pxPerSec: 20,
    snapping: true,
    follow: false,
    locked: false,
    selectedIds: new Set<string>(),
    onSelectedIdsChange: vi.fn(),
    onPlayhead: vi.fn(),
    onCommit: vi.fn(),
    onPxPerSecChange: vi.fn(),
    ...over,
  };
  render(<NleTimeline {...props} />);
  return props;
}

afterEach(cleanup);

describe('NleTimeline', () => {
  it('sizes each clip block by its trimmed length and lays them end to end', () => {
    setup();
    const a = screen.getByTitle(/^A · 10\.00s/);
    const b = screen.getByTitle(/^B · 3\.00s/);
    expect(a.style.left).toBe('0px');
    expect(a.style.width).toBe('198px'); // 10s × 20px − 2px gutter
    expect(b.style.left).toBe('200px');
    expect(b.style.width).toBe('58px'); // (4−1)s × 20px − 2px
  });

  it('shows the trimmed-clip marker only on trimmed clips', () => {
    setup();
    expect(screen.getByTitle(/^B ·/).querySelector('svg')).not.toBeNull();
    expect(screen.getByTitle(/^A ·/).querySelector('svg')).toBeNull();
  });

  it('selects a clicked clip, and shift-click adds to the selection', () => {
    const props = setup({ selectedIds: new Set(['a']) });
    fireEvent.pointerDown(screen.getByTitle(/^B ·/), { button: 0 });
    expect(props.onSelectedIdsChange).toHaveBeenLastCalledWith(new Set(['b']));
    fireEvent.pointerDown(screen.getByTitle(/^B ·/), { button: 0, shiftKey: true });
    expect(props.onSelectedIdsChange).toHaveBeenLastCalledWith(new Set(['a', 'b']));
  });

  it('does not start edits while locked (durations still loading), but still selects', () => {
    const props = setup({ locked: true });
    fireEvent.pointerDown(screen.getByTitle(/^A ·/), { button: 0 });
    fireEvent.pointerUp(window);
    expect(props.onSelectedIdsChange).toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('draws the playhead at playhead × zoom', () => {
    const { container } = render(
      <NleTimeline
        clips={[clip('a')]}
        durations={DUR}
        playhead={2.5}
        pxPerSec={20}
        snapping
        follow={false}
        locked={false}
        selectedIds={new Set()}
        onSelectedIdsChange={() => {}}
        onPlayhead={() => {}}
        onCommit={() => {}}
        onPxPerSecChange={() => {}}
      />
    );
    const head = container.querySelector('.bg-red-500') as HTMLElement;
    expect(head.style.left).toBe('50px');
  });

  it('shows an empty-state prompt with no clips', () => {
    setup({ clips: [] });
    expect(screen.getByText(/add clips from your library/i)).toBeInTheDocument();
  });
});
