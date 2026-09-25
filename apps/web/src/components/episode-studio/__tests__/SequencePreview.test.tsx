import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SequencePreview } from '../SequencePreview';
import { placeClips } from '@/lib/timelineEdit';
import type { EpisodeClip } from '../EpisodeClipTimeline';
import type { TextOverlay } from '@/lib/episodeCut';

const clip = (nodeId: string, over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId,
  label: nodeId,
  videoUrl: `https://v/${nodeId}.mp4`,
  trimStart: 0,
  trimEnd: 0,
  ...over,
});
const DUR = { 'https://v/a.mp4': 10, 'https://v/b.mp4': 6 };
const cap = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'o1',
  text: 'Chapter one',
  start: 1,
  end: 3,
  position: 'bottom',
  size: 'md',
  ...over,
});

function setup(
  clips: EpisodeClip[],
  playhead: number,
  extra: Partial<React.ComponentProps<typeof SequencePreview>> = {}
) {
  const utils = render(
    <SequencePreview
      placed={placeClips(clips, DUR)}
      playhead={playhead}
      playing={false}
      onTick={vi.fn()}
      onEnded={vi.fn()}
      {...extra}
    />
  );
  const videos = Array.from(utils.container.querySelectorAll('video'));
  const audios = Array.from(utils.container.querySelectorAll('audio'));
  return { ...utils, videos, audios };
}

// jsdom doesn't implement media playback; the component only needs these to exist.
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});
afterEach(cleanup);

describe('SequencePreview', () => {
  it('says so when there is nothing to play', () => {
    render(
      <SequencePreview
        placed={[]}
        playhead={0}
        playing={false}
        onTick={vi.fn()}
        onEnded={vi.fn()}
      />
    );
    expect(screen.getByText('No clips on the timeline')).toBeInTheDocument();
  });

  it('shows a caption only while its time range is under the playhead', () => {
    const { rerender } = setup([clip('a')], 2, { overlays: [cap()] });
    expect(screen.getByText('Chapter one')).toBeInTheDocument();
    rerender(
      <SequencePreview
        placed={placeClips([clip('a')], DUR)}
        playhead={3}
        playing={false}
        overlays={[cap()]}
        onTick={vi.fn()}
        onEnded={vi.fn()}
      />
    );
    expect(screen.queryByText('Chapter one')).toBeNull();
  });

  it('positions and sizes captions like the export', () => {
    setup([clip('a')], 2, { overlays: [cap({ position: 'top', size: 'lg' })] });
    const text = screen.getByText('Chapter one');
    expect(text.style.fontSize).toBe('8cqh');
    expect(text.parentElement?.className).toContain('top-[8%]');
  });

  it('frames the monitor for the chosen aspect ratio', () => {
    const wide = setup([clip('a')], 0);
    expect((wide.container.firstChild as HTMLElement).style.aspectRatio).toBe('16 / 9');
    cleanup();
    const tall = setup([clip('a')], 0, { aspect: '9:16' });
    expect((tall.container.firstChild as HTMLElement).style.aspectRatio).toBe('9 / 16');
  });

  it('crops to fill or letterboxes to fit', () => {
    expect(setup([clip('a')], 0).videos[0].className).toContain('object-contain');
    cleanup();
    expect(setup([clip('a')], 0, { framing: 'fill' }).videos[0].className).toContain(
      'object-cover'
    );
  });

  it('dims the picture through a fade-in and applies the clip volume', () => {
    // fade-in 2s, playhead 1s in → half way; volume 0.5 × fade 0.5
    const { videos } = setup([clip('a', { fadeIn: 2, volume: 0.5 })], 1);
    const shown = videos[0];
    expect(Number(shown.style.opacity)).toBeCloseTo(0.5);
    expect(shown.volume).toBeCloseTo(0.25);
  });

  it('is fully visible and at full volume outside any fade', () => {
    const { videos } = setup([clip('a', { fadeIn: 1, fadeOut: 1 })], 5);
    expect(Number(videos[0].style.opacity)).toBe(1);
    expect(videos[0].volume).toBe(1);
  });

  it('fades out at the tail of the clip', () => {
    const { videos } = setup([clip('a', { fadeOut: 2 })], 9); // 1s before the end → 0.5
    expect(Number(videos[0].style.opacity)).toBeCloseTo(0.5);
  });

  it('plays an audio overlay instead of the clip’s own sound, at the clip volume', () => {
    const { videos, audios } = setup([clip('a', { audioUrl: 'https://v/vo.mp3', volume: 0.4 })], 2);
    expect(videos[0].muted).toBe(true);
    expect(audios[0].dataset.src).toBe('https://v/vo.mp3');
    expect(audios[0].volume).toBeCloseTo(0.4);
  });

  it('leaves the clip’s own audio on when it has no overlay', () => {
    const { videos, audios } = setup([clip('a')], 2);
    expect(videos[0].muted).toBe(false);
    expect(audios[0].dataset.src).toBeUndefined();
  });

  it('keeps the inactive slot hidden so the crossfade buffer never shows through', () => {
    const { videos } = setup([clip('a'), clip('b')], 2);
    expect(videos[1].style.opacity).toBe('0');
  });
});
