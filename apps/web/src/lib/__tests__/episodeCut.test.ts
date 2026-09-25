import { describe, expect, it } from 'vitest';
import type { EpisodeClip } from '@/components/episode-studio/EpisodeClipTimeline';
import { placeClips } from '@/lib/timelineEdit';
import {
  activeOverlays,
  clipGain,
  clipFromDragged,
  cutFromEpisode,
  encodeClipDrag,
  parseClipDrag,
  cutSignature,
  DEFAULT_EXPORT_SETTINGS,
  duplicateClip,
  EMPTY_CUT,
  fadeLevel,
  formatSavedAt,
  insertClipsAt,
  insertIndexAtTime,
  newOverlay,
  normalizeOverlay,
  patchClip,
  patchOverlay,
  withFreshIds,
} from '../episodeCut';

const clip = (nodeId: string, over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId,
  label: nodeId,
  videoUrl: `https://v/${nodeId}.mp4`,
  trimStart: 0,
  trimEnd: 0,
  ...over,
});
const DUR = { 'https://v/a.mp4': 4, 'https://v/b.mp4': 6, 'https://v/c.mp4': 2 };

describe('clip helpers', () => {
  it('patches one clip and returns the same array when nothing matches', () => {
    const clips = [clip('a'), clip('b')];
    expect(patchClip(clips, 'b', { volume: 0.5 })[1].volume).toBe(0.5);
    expect(patchClip(clips, 'zzz', { volume: 0.5 })).toBe(clips);
  });

  it('duplicates a clip right after itself with a unique id', () => {
    const next = duplicateClip([clip('a'), clip('b')], 'a');
    expect(next.map((c) => c.nodeId)).toEqual(['a', 'a#2', 'b']);
    expect(duplicateClip(next, 'a').map((c) => c.nodeId)).toEqual(['a', 'a#3', 'a#2', 'b']);
  });

  it('gives inserted clips fresh ids when they clash', () => {
    const out = withFreshIds([clip('a')], [clip('a'), clip('a')]);
    expect(out.map((c) => c.nodeId)).toEqual(['a#2', 'a#3']);
    const inserted = insertClipsAt([clip('a'), clip('b')], [clip('a')], 1);
    expect(inserted.map((c) => c.nodeId)).toEqual(['a', 'a#2', 'b']);
  });

  it('clamps the insert index and ignores an empty drop', () => {
    const clips = [clip('a')];
    expect(insertClipsAt(clips, [clip('x')], 99).map((c) => c.nodeId)).toEqual(['a', 'x']);
    expect(insertClipsAt(clips, [clip('x')], -5).map((c) => c.nodeId)).toEqual(['x', 'a']);
    expect(insertClipsAt(clips, [], 0)).toBe(clips);
  });
});

describe('insertIndexAtTime', () => {
  const placed = placeClips([clip('a'), clip('b'), clip('c')], DUR); // 0–4, 4–10, 10–12
  it('lands before the clip whose midpoint is still ahead', () => {
    expect(insertIndexAtTime(placed, 0)).toBe(0);
    expect(insertIndexAtTime(placed, 1.9)).toBe(0);
    expect(insertIndexAtTime(placed, 2.1)).toBe(1);
    expect(insertIndexAtTime(placed, 7.1)).toBe(2);
    expect(insertIndexAtTime(placed, 11.5)).toBe(3);
    expect(insertIndexAtTime(placed, 99)).toBe(3);
  });
  it('is 0 on an empty timeline', () => {
    expect(insertIndexAtTime([], 5)).toBe(0);
  });
});

describe('fades and gain', () => {
  const c = clip('a', { fadeIn: 1, fadeOut: 2, volume: 0.5 });
  it('ramps in, holds, and ramps out', () => {
    expect(fadeLevel(c, 10, 0)).toBe(0);
    expect(fadeLevel(c, 10, 0.5)).toBeCloseTo(0.5);
    expect(fadeLevel(c, 10, 5)).toBe(1);
    expect(fadeLevel(c, 10, 9)).toBeCloseTo(0.5);
    expect(fadeLevel(c, 10, 10)).toBe(0);
  });
  it('caps each fade at half the clip so they cannot overlap', () => {
    const long = clip('a', { fadeIn: 9, fadeOut: 9 });
    expect(fadeLevel(long, 4, 2)).toBe(1); // both capped to 2s → full at the midpoint
    expect(fadeLevel(long, 4, 1)).toBeCloseTo(0.5);
  });
  it('multiplies volume by the fade and never exceeds 1', () => {
    expect(clipGain(c, 10, 5)).toBe(0.5);
    expect(clipGain(clip('a', { volume: 2 }), 10, 5)).toBe(1);
    expect(clipGain(clip('a'), 10, 5)).toBe(1);
  });
});

describe('overlays', () => {
  it('starts a caption at the playhead and keeps it inside the episode', () => {
    const o = newOverlay(4, 10);
    expect([o.start, o.end]).toEqual([4, 7]);
    const late = newOverlay(9.5, 10);
    expect([late.start, late.end]).toEqual([7, 10]);
    const tiny = newOverlay(0, 1);
    expect(tiny.end - tiny.start).toBe(1);
  });
  it('gives every caption a distinct id', () => {
    expect(newOverlay(0, 10).id).not.toBe(newOverlay(0, 10).id);
  });
  it('enforces a minimum length and non-negative start', () => {
    const o = normalizeOverlay({ ...newOverlay(0, 10), start: -3, end: -2.9 });
    expect(o.start).toBe(0);
    expect(o.end).toBeGreaterThanOrEqual(0.5);
  });
  it('patches by id and re-normalizes', () => {
    const o = newOverlay(0, 10);
    const next = patchOverlay([o], o.id, { end: o.start });
    expect(next[0].end).toBeGreaterThan(next[0].start);
    expect(patchOverlay([o], 'nope', { text: 'x' })[0]).toBe(o);
  });
  it('finds the captions on screen at a time (end exclusive)', () => {
    const o = { ...newOverlay(0, 10), start: 1, end: 2 };
    expect(activeOverlays([o], 1)).toHaveLength(1);
    expect(activeOverlays([o], 2)).toHaveLength(0);
    expect(activeOverlays([o], 0.5)).toHaveLength(0);
  });
});

describe('hydration and signature', () => {
  it('tolerates episodes saved before overlays / soundtrack existed', () => {
    expect(cutFromEpisode({})).toEqual(EMPTY_CUT);
    expect(cutFromEpisode({ clips: [clip('a')] }).clips).toHaveLength(1);
    expect(cutFromEpisode({ soundtrack: { url: '', volume: 1 } }).soundtrack).toBeNull();
  });
  it('changes signature when anything saved changes, and only then', () => {
    const cut = { ...EMPTY_CUT, clips: [clip('a')] };
    const base = cutSignature('t', 'd', cut, DEFAULT_EXPORT_SETTINGS);
    expect(cutSignature('t', 'd', { ...cut }, { ...DEFAULT_EXPORT_SETTINGS })).toBe(base);
    expect(cutSignature('t2', 'd', cut, DEFAULT_EXPORT_SETTINGS)).not.toBe(base);
    expect(cutSignature('t', 'd', cut, { ...DEFAULT_EXPORT_SETTINGS, aspect: '9:16' })).not.toBe(
      base
    );
    expect(
      cutSignature(
        't',
        'd',
        { ...cut, soundtrack: { url: 'https://x/a.mp3', volume: 0.5 } },
        DEFAULT_EXPORT_SETTINGS
      )
    ).not.toBe(base);
  });
});

describe('formatSavedAt', () => {
  const now = 1_000_000_000_000;
  it('reads naturally', () => {
    expect(formatSavedAt(null, now)).toBe('');
    expect(formatSavedAt(now - 3_000, now)).toBe('just now');
    expect(formatSavedAt(now - 30_000, now)).toBe('30s ago');
    expect(formatSavedAt(now - 5 * 60_000, now)).toBe('5 min ago');
  });
});

describe('clip drag payload', () => {
  it('round-trips library clips', () => {
    const payload = encodeClipDrag([{ id: 'x', label: 'Shot', videoUrl: 'https://v/x.mp4' }]);
    expect(parseClipDrag(payload)).toEqual([
      { id: 'x', label: 'Shot', videoUrl: 'https://v/x.mp4' },
    ]);
  });
  it('rejects garbage, non-arrays and non-http urls', () => {
    expect(parseClipDrag(null)).toEqual([]);
    expect(parseClipDrag('nope')).toEqual([]);
    expect(parseClipDrag('{"id":"x"}')).toEqual([]);
    expect(
      parseClipDrag(JSON.stringify([{ id: 'x', label: 'l', videoUrl: 'javascript:alert(1)' }]))
    ).toEqual([]);
    expect(parseClipDrag(JSON.stringify([{ id: 1, videoUrl: 'https://a/b.mp4' }]))).toEqual([]);
  });
  it('builds an untrimmed clip from a dragged asset', () => {
    expect(clipFromDragged({ id: 'x', label: 'Shot', videoUrl: 'https://v/x.mp4' })).toEqual({
      nodeId: 'clip:x',
      label: 'Shot',
      videoUrl: 'https://v/x.mp4',
      trimStart: 0,
      trimEnd: 0,
    });
  });
});
