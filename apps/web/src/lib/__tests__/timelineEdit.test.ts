import { describe, expect, it } from 'vitest';
import type { EpisodeClip } from '@/components/episode-studio/EpisodeClipTimeline';
import {
  MIN_CLIP_SEC,
  formatTimecode,
  locate,
  moveClip,
  placeClips,
  removeClips,
  reorderTarget,
  snapPoints,
  snapTime,
  splitClipAt,
  totalDuration,
  trimClipEdge,
  trimEdgeToTime,
  uniqueNodeId,
} from '../timelineEdit';

const clip = (nodeId: string, over: Partial<EpisodeClip> = {}): EpisodeClip => ({
  nodeId,
  label: nodeId,
  videoUrl: `https://v/${nodeId}.mp4`,
  trimStart: 0,
  trimEnd: 0,
  ...over,
});

const DUR = { 'https://v/a.mp4': 10, 'https://v/b.mp4': 6, 'https://v/c.mp4': 4 };

describe('placeClips', () => {
  it('lays clips end to end, using trims for length', () => {
    const placed = placeClips(
      [clip('a', { trimStart: 1, trimEnd: 7 }), clip('b'), clip('c', { trimStart: 1 })],
      DUR
    );
    expect(placed.map((p) => [p.start, p.length])).toEqual([
      [0, 6],
      [6, 6],
      [12, 3],
    ]);
    expect(totalDuration(placed)).toBe(15);
  });

  it('treats trimEnd 0 as the whole file and clamps trims to the source', () => {
    const [p] = placeClips([clip('c', { trimStart: 99, trimEnd: 99 })], DUR);
    expect(p.srcStart).toBe(4);
    expect(p.length).toBe(0);
  });

  it('falls back to a placeholder length until metadata loads', () => {
    const [p] = placeClips([clip('zzz')], {});
    expect(p.length).toBeGreaterThan(0);
  });
});

describe('locate', () => {
  const placed = placeClips([clip('a'), clip('b')], DUR);
  it('maps timeline time to a clip and source time', () => {
    const hit = locate(placed, 12)!;
    expect(hit.placed.clip.nodeId).toBe('b');
    expect(hit.sourceTime).toBe(2);
  });
  it('pins to the last frame past the end and null on an empty track', () => {
    expect(locate(placed, 999)!.sourceTime).toBe(6);
    expect(locate([], 1)).toBeNull();
  });
});

describe('splitClipAt', () => {
  it('cuts a full-length clip into two contiguous halves', () => {
    const out = splitClipAt([clip('a'), clip('b')], DUR, 4)!;
    expect(out.clips.map((c) => c.nodeId)).toEqual(['a', 'a#2', 'b']);
    expect(out.clips[0]).toMatchObject({ trimStart: 0, trimEnd: 4 });
    expect(out.clips[1]).toMatchObject({ trimStart: 4, trimEnd: 0 });
    // Nothing is lost or duplicated: total length unchanged.
    expect(totalDuration(placeClips(out.clips, DUR))).toBe(16);
  });

  it('respects an existing trim and keeps its out-point on the second half', () => {
    const out = splitClipAt([clip('a', { trimStart: 2, trimEnd: 8 })], DUR, 3)!;
    expect(out.clips[0]).toMatchObject({ trimStart: 2, trimEnd: 5 });
    expect(out.clips[1]).toMatchObject({ trimStart: 5, trimEnd: 8 });
  });

  it('cuts the right clip when the playhead is past the first', () => {
    const out = splitClipAt([clip('a'), clip('b')], DUR, 13)!;
    expect(out.index).toBe(1);
    expect(out.clips[1]).toMatchObject({ nodeId: 'b', trimEnd: 3 });
    expect(out.clips[2]).toMatchObject({ nodeId: 'b#2', trimStart: 3 });
  });

  it('refuses cuts on/near an edge or past the end', () => {
    const clips = [clip('a')];
    expect(splitClipAt(clips, DUR, 0)).toBeNull();
    expect(splitClipAt(clips, DUR, MIN_CLIP_SEC / 2)).toBeNull();
    expect(splitClipAt(clips, DUR, 10 - MIN_CLIP_SEC / 2)).toBeNull();
    expect(splitClipAt(clips, DUR, 50)).toBeNull();
  });

  it('generates unique ids when splitting a split', () => {
    const first = splitClipAt([clip('a')], DUR, 4)!.clips;
    const again = splitClipAt(first, DUR, 8)!.clips;
    expect(new Set(again.map((c) => c.nodeId)).size).toBe(again.length);
  });
});

describe('uniqueNodeId', () => {
  it('increments past taken suffixes without stacking them', () => {
    expect(uniqueNodeId([clip('a'), clip('a#2')], 'a#2')).toBe('a#3');
    expect(uniqueNodeId([clip('a')], 'a')).toBe('a#2');
  });
});

describe('trimClipEdge', () => {
  it('drags the in-point later and the out-point earlier', () => {
    const clips = [clip('a')];
    expect(trimClipEdge(clips, DUR, 0, 'start', 2.5)[0]).toMatchObject({ trimStart: 2.5 });
    expect(trimClipEdge(clips, DUR, 0, 'end', -3.5)[0]).toMatchObject({ trimEnd: 6.5 });
  });

  it('is a ripple: later clips move up with the shortened clip', () => {
    const next = trimClipEdge([clip('a'), clip('b')], DUR, 0, 'end', -3.5);
    expect(placeClips(next, DUR)[1].start).toBe(6.5);
  });

  it('clamps to the source and to the minimum length', () => {
    const clips = [clip('a', { trimStart: 2, trimEnd: 4 })];
    expect(trimClipEdge(clips, DUR, 0, 'start', -50)[0].trimStart).toBe(0);
    expect(trimClipEdge(clips, DUR, 0, 'start', 50)[0].trimStart).toBeCloseTo(4 - MIN_CLIP_SEC);
    expect(trimClipEdge(clips, DUR, 0, 'end', 50)[0].trimEnd).toBe(0); // back to "full"
    expect(trimClipEdge(clips, DUR, 0, 'end', -50)[0].trimEnd).toBeCloseTo(2 + MIN_CLIP_SEC);
  });

  it('returns the same array when nothing changes (no history entry)', () => {
    const clips = [clip('a')];
    expect(trimClipEdge(clips, DUR, 0, 'start', 0)).toBe(clips);
    expect(trimClipEdge(clips, DUR, 0, 'end', 5)).toBe(clips);
    expect(trimClipEdge(clips, DUR, 9, 'end', 1)).toBe(clips);
  });
});

describe('trimEdgeToTime (Q / W)', () => {
  const clips = [clip('a'), clip('b')];
  it('W trims the out-point to the playhead', () => {
    const next = trimEdgeToTime(clips, DUR, 4, 'end')!;
    expect(next[0].trimEnd).toBe(4);
  });
  it('Q trims the in-point to the playhead, inside a later clip', () => {
    const next = trimEdgeToTime(clips, DUR, 12, 'start')!;
    expect(next[1].trimStart).toBe(2);
  });
  it('null when there is nothing to do', () => {
    expect(trimEdgeToTime(clips, DUR, 0, 'start')).toBeNull();
    expect(trimEdgeToTime(clips, DUR, 99, 'end')).toBeNull();
  });
});

describe('moveClip / removeClips', () => {
  const clips = [clip('a'), clip('b'), clip('c')];
  it('moves to a final index', () => {
    expect(moveClip(clips, 0, 2).map((c) => c.nodeId)).toEqual(['b', 'c', 'a']);
    expect(moveClip(clips, 2, 0).map((c) => c.nodeId)).toEqual(['c', 'a', 'b']);
  });
  it('is a no-op (same array) for same index / out of range', () => {
    expect(moveClip(clips, 1, 1)).toBe(clips);
    expect(moveClip(clips, 7, 0)).toBe(clips);
  });
  it('removes by id and closes the gap', () => {
    const next = removeClips(clips, new Set(['b']));
    expect(placeClips(next, DUR).map((p) => p.start)).toEqual([0, 10]);
  });
});

describe('reorderTarget', () => {
  const placed = placeClips([clip('a'), clip('b'), clip('c')], DUR); // 0-10, 10-16, 16-20
  it('is stable regardless of where the dragged clip currently sits', () => {
    expect(reorderTarget(placed, 0, 1)).toBe(0);
    expect(reorderTarget(placed, 0, 5)).toBe(1); // past b's midpoint (3) of the others
    expect(reorderTarget(placed, 0, 999)).toBe(2);
    expect(reorderTarget(placed, 2, 2)).toBe(0);
  });
});

describe('snapping', () => {
  const placed = placeClips([clip('a'), clip('b')], DUR);
  it("collects 0, the playhead and other clips' edges but not the excluded clip's own", () => {
    const pts = snapPoints(placed, 3.3, 1);
    expect(pts.sort((x, y) => x - y)).toEqual([0, 3.3, 10]);
  });
  it('snaps to the nearest point within the threshold only', () => {
    expect(snapTime(9.8, [0, 10], 0.3)).toBe(10);
    expect(snapTime(9.5, [0, 10], 0.3)).toBe(9.5);
  });
});

describe('formatTimecode', () => {
  it('formats mm:ss:ff', () => {
    expect(formatTimecode(0)).toBe('00:00:00');
    expect(formatTimecode(65.5)).toBe('01:05:15');
    expect(formatTimecode(-3)).toBe('00:00:00');
  });
  it('never rolls the frame count over to fps', () => {
    expect(formatTimecode(1.9999)).toBe('00:01:29');
  });
});
