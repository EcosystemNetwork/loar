/**
 * Pure editing maths for the Episode Studio timeline (the NLE surface).
 *
 * The episode is a sequence of clips on one video track, exactly what the
 * server's `episodes.export` concatenates: each clip is a slice of a source
 * file, `[trimStart, trimEnd)` in SECONDS, where `trimEnd === 0` means "to the
 * end of the file". Because the sequence is gapless, every edit here is a
 * ripple edit — changing a clip's length shifts everything after it.
 *
 * Nothing in here touches the DOM, so all of it is unit-tested.
 */
import type { EpisodeClip } from '@/components/episode-studio/EpisodeClipTimeline';

/** No clip may be edited shorter than this (seconds). */
export const MIN_CLIP_SEC = 0.1;

/** Assumed source length until the real file's metadata has loaded. */
export const FALLBACK_SOURCE_SEC = 5;

/** Source durations in seconds, keyed by `videoUrl`. */
export type DurationMap = Record<string, number>;

export interface PlacedClip {
  clip: EpisodeClip;
  index: number;
  /** Where the clip starts on the timeline (seconds). */
  start: number;
  /** How long it plays on the timeline (seconds). */
  length: number;
  /** In-point within the source file (seconds). */
  srcStart: number;
  /** Out-point within the source file (seconds). */
  srcEnd: number;
  /** Full length of the source file (seconds). */
  srcDuration: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function sourceDuration(clip: EpisodeClip, durations: DurationMap): number {
  const known = durations[clip.videoUrl];
  if (known && Number.isFinite(known) && known > 0) return known;
  // Episodes seeded outside the studio can lack trimStart/trimEnd entirely;
  // `undefined + 1` is NaN, which would poison every position downstream.
  return clip.trimEnd > 0 ? clip.trimEnd : Math.max(FALLBACK_SOURCE_SEC, (clip.trimStart || 0) + 1);
}

export function clipRange(
  clip: EpisodeClip,
  srcDuration: number
): { srcStart: number; srcEnd: number } {
  const srcStart = clamp(clip.trimStart || 0, 0, srcDuration);
  const srcEnd = clip.trimEnd > 0 ? Math.min(clip.trimEnd, srcDuration) : srcDuration;
  return { srcStart, srcEnd: Math.max(srcEnd, srcStart) };
}

export function placeClips(clips: EpisodeClip[], durations: DurationMap): PlacedClip[] {
  let cursor = 0;
  return clips.map((clip, index) => {
    const srcDuration = sourceDuration(clip, durations);
    const { srcStart, srcEnd } = clipRange(clip, srcDuration);
    const length = srcEnd - srcStart;
    const placed: PlacedClip = {
      clip,
      index,
      start: cursor,
      length,
      srcStart,
      srcEnd,
      srcDuration,
    };
    cursor += length;
    return placed;
  });
}

export function totalDuration(placed: PlacedClip[]): number {
  const last = placed[placed.length - 1];
  return last ? last.start + last.length : 0;
}

/** The clip under timeline time `t`, and the matching time inside its source. */
export function locate(
  placed: PlacedClip[],
  t: number
): { placed: PlacedClip; sourceTime: number } | null {
  if (placed.length === 0) return null;
  const time = Math.max(0, t);
  const hit =
    placed.find((p) => time >= p.start && time < p.start + p.length) ??
    // Past the end → pin to the last frame of the last clip.
    placed[placed.length - 1];
  return { placed: hit, sourceTime: hit.srcStart + clamp(time - hit.start, 0, hit.length) };
}

/** `Clip#2`, `Clip#3`… — nodeId is the React key and selection handle, so it must stay unique. */
export function uniqueNodeId(clips: EpisodeClip[], base: string): string {
  const root = base.replace(/#\d+$/, '');
  const taken = new Set(clips.map((c) => c.nodeId));
  let n = 2;
  while (taken.has(`${root}#${n}`)) n++;
  return `${root}#${n}`;
}

/**
 * Razor: cut the clip under `t` in two. Returns null when `t` is too close to
 * an edge (or past the end) to leave two clips of at least `MIN_CLIP_SEC`.
 */
export function splitClipAt(
  clips: EpisodeClip[],
  durations: DurationMap,
  t: number
): { clips: EpisodeClip[]; index: number } | null {
  const placed = placeClips(clips, durations);
  const hit = placed.find((p) => t >= p.start && t < p.start + p.length);
  if (!hit) return null;
  if (t - hit.start < MIN_CLIP_SEC || hit.start + hit.length - t < MIN_CLIP_SEC) return null;

  const cutAt = round3(hit.srcStart + (t - hit.start));
  // A fade belongs to the clip's outer edge: the in-fade stays with the first
  // half and the out-fade with the second, so the cut itself is a clean join.
  const { fadeIn: _fadeIn, fadeOut: _fadeOut, ...bare } = hit.clip;
  const first: EpisodeClip = { ...bare, trimEnd: cutAt };
  if (hit.clip.fadeIn) first.fadeIn = hit.clip.fadeIn;
  const second: EpisodeClip = {
    ...bare,
    nodeId: uniqueNodeId(clips, hit.clip.nodeId),
    trimStart: cutAt,
  };
  if (hit.clip.fadeOut) second.fadeOut = hit.clip.fadeOut;
  const next = [...clips];
  next.splice(hit.index, 1, first, second);
  return { clips: next, index: hit.index };
}

/**
 * Ripple-trim one edge of a clip by `deltaSec` (positive = later in the
 * source). Both edges clamp to the source and to `MIN_CLIP_SEC`.
 */
export function trimClipEdge(
  clips: EpisodeClip[],
  durations: DurationMap,
  index: number,
  edge: 'start' | 'end',
  deltaSec: number
): EpisodeClip[] {
  const clip = clips[index];
  if (!clip) return clips;
  const srcDuration = sourceDuration(clip, durations);
  const { srcStart, srcEnd } = clipRange(clip, srcDuration);

  let patch: Partial<EpisodeClip>;
  if (edge === 'start') {
    const next = clamp(srcStart + deltaSec, 0, Math.max(0, srcEnd - MIN_CLIP_SEC));
    patch = { trimStart: round3(next) };
  } else {
    const next = clamp(srcEnd + deltaSec, srcStart + MIN_CLIP_SEC, srcDuration);
    // Back at the very end of the file → return to the implicit "0 = full" form.
    patch = { trimEnd: next >= srcDuration - 0.001 ? 0 : round3(next) };
  }
  if (
    (patch.trimStart === undefined || patch.trimStart === clip.trimStart) &&
    (patch.trimEnd === undefined || patch.trimEnd === clip.trimEnd)
  ) {
    return clips;
  }
  const next = [...clips];
  next[index] = { ...clip, ...patch };
  return next;
}

/** Premiere's Q / W: trim the clip under `t` so its in/out point lands on `t`. */
export function trimEdgeToTime(
  clips: EpisodeClip[],
  durations: DurationMap,
  t: number,
  edge: 'start' | 'end'
): EpisodeClip[] | null {
  const placed = placeClips(clips, durations);
  const hit = placed.find((p) => t >= p.start && t < p.start + p.length);
  if (!hit) return null;
  const delta = edge === 'start' ? t - hit.start : t - (hit.start + hit.length);
  const next = trimClipEdge(clips, durations, hit.index, edge, delta);
  return next === clips ? null : next;
}

export function moveClip(clips: EpisodeClip[], from: number, to: number): EpisodeClip[] {
  if (from === to || from < 0 || from >= clips.length) return clips;
  const target = clamp(to, 0, clips.length - 1);
  const next = [...clips];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Ripple delete — the gap closes because the track is gapless. */
export function removeClips(clips: EpisodeClip[], nodeIds: Set<string>): EpisodeClip[] {
  return clips.filter((c) => !nodeIds.has(c.nodeId));
}

/**
 * Where a dragged clip lands: the index it should occupy after the move, given
 * the timeline time of its centre. Computed against the layout WITHOUT the
 * dragged clip so the answer doesn't flicker as the live preview reorders.
 */
export function reorderTarget(placed: PlacedClip[], dragIndex: number, centerTime: number): number {
  let cursor = 0;
  let target = 0;
  for (const p of placed) {
    if (p.index === dragIndex) continue;
    if (centerTime > cursor + p.length / 2) target++;
    cursor += p.length;
  }
  return target;
}

/** Times worth snapping to: 0, every clip edge (minus `excludeIndex`'s own), and the playhead. */
export function snapPoints(
  placed: PlacedClip[],
  playhead: number,
  excludeIndex?: number
): number[] {
  const points = new Set<number>([0, playhead]);
  for (const p of placed) {
    if (p.index === excludeIndex) continue;
    points.add(p.start);
    points.add(p.start + p.length);
  }
  return [...points];
}

/** Nearest snap point within `threshold` seconds, else `t` unchanged. */
export function snapTime(t: number, points: number[], threshold: number): number {
  let best = t;
  let bestDist = threshold;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** `mm:ss:ff` at `fps` (default 30), the timecode format editors expect. */
export function formatTimecode(sec: number, fps = 30): string {
  const total = Math.max(0, sec);
  const whole = Math.floor(total);
  const frames = Math.min(fps - 1, Math.floor((total - whole) * fps + 1e-6));
  const mm = Math.floor(whole / 60);
  const ss = whole % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(mm)}:${pad(ss)}:${pad(frames)}`;
}
