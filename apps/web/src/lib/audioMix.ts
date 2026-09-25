/**
 * Multi-track audio model for Episode Studio, and every calculation the lanes,
 * the live preview and the export share.
 *
 * The episode's picture is one video track (its clips carry their own audio).
 * On top of that sit N audio tracks, each holding audio clips placed at any
 * timeline position, and a small mixer: the video track's audio, every audio
 * track, and a master. Everything is summed into ONE final audio track — the
 * server does this at export (`services/ffmpeg/audio-mix.ts`, which mirrors the
 * gain rules below), and `mixEngine.ts` does it live for the preview.
 *
 * Nothing here touches the DOM or the network, so it is all unit-tested.
 */

export type TrackKind = 'music' | 'voice' | 'sfx' | 'audio';

export const TRACK_KIND_LABEL: Record<TrackKind, string> = {
  music: 'Music',
  voice: 'Voice',
  sfx: 'SFX',
  audio: 'Audio',
};

export interface AudioClip {
  id: string;
  /** Audio (or video) file whose audio is used. */
  url: string;
  label: string;
  /** Where the clip starts on the timeline (seconds). */
  start: number;
  /** In-point inside the source file (seconds). Ignored (0) while `loop` is on. */
  trimStart: number;
  /** How long it plays on the timeline (seconds). */
  length: number;
  /** Clip level, 0–2 (1 = unchanged). */
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** Repeat the file to fill `length` — for music beds shorter than the scene. */
  loop?: boolean;
  /** Length of the source file, once known (caps trims). */
  sourceDuration?: number;
}

export interface AudioTrack {
  id: string;
  name: string;
  kind: TrackKind;
  /** Track fader, 0–2. */
  volume: number;
  muted: boolean;
  solo: boolean;
  clips: AudioClip[];
}

export interface ChannelState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface Mixer {
  /** The video track's own audio. */
  video: ChannelState;
  /** Applied to the sum of everything, 0–2. */
  master: number;
}

export interface AudioMix {
  tracks: AudioTrack[];
  mixer: Mixer;
}

export const DEFAULT_CHANNEL: ChannelState = { volume: 1, muted: false, solo: false };
export const EMPTY_MIX: AudioMix = { tracks: [], mixer: { video: DEFAULT_CHANNEL, master: 1 } };

export const MAX_TRACKS = 8;
export const MAX_CLIPS_PER_TRACK = 30;
/** ffmpeg opens one input per clip; keep the export graph bounded. */
export const MAX_TOTAL_CLIPS = 40;
export const MIN_AUDIO_CLIP_SEC = 0.1;
export const MAX_GAIN = 2;
export const MAX_FADE_SEC = 30;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const finite = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;

// ── Ids ─────────────────────────────────────────────────────────────────

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}`;
}

// ── Lookup ──────────────────────────────────────────────────────────────

export function clipEnd(clip: AudioClip): number {
  return clip.start + clip.length;
}

export function totalClipCount(mix: AudioMix): number {
  return mix.tracks.reduce((n, t) => n + t.clips.length, 0);
}

export function findClip(
  mix: AudioMix,
  clipId: string
): { track: AudioTrack; clip: AudioClip; trackIndex: number } | null {
  for (let i = 0; i < mix.tracks.length; i++) {
    const clip = mix.tracks[i].clips.find((c) => c.id === clipId);
    if (clip) return { track: mix.tracks[i], clip, trackIndex: i };
  }
  return null;
}

/** Where the last audio clip ends — the episode must be at least this long to hear it all. */
export function mixDuration(mix: AudioMix): number {
  let end = 0;
  for (const t of mix.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

// ── Mixer rules (mirrored by the server's audio-mix.ts) ─────────────────

/** Is any channel soloed? Then only soloed channels are heard. */
export function anySolo(mix: AudioMix): boolean {
  return mix.mixer.video.solo || mix.tracks.some((t) => t.solo);
}

export function isTrackAudible(mix: AudioMix, track: AudioTrack): boolean {
  return anySolo(mix) ? track.solo : !track.muted;
}

export function isVideoAudible(mix: AudioMix): boolean {
  return anySolo(mix) ? mix.mixer.video.solo : !mix.mixer.video.muted;
}

/** Linear gain applied to the video track's audio (0 when muted / not soloed). */
export function videoAudioGain(mix: AudioMix): number {
  return isVideoAudible(mix) ? clamp(mix.mixer.video.volume, 0, MAX_GAIN) : 0;
}

/**
 * Steady-state gain of an audio clip in the mix: clip × track (× master is
 * applied once on the sum, not per clip). 0 when its track is muted or another
 * channel is soloed.
 */
export function effectiveClipGain(mix: AudioMix, track: AudioTrack, clip: AudioClip): number {
  if (!isTrackAudible(mix, track)) return 0;
  return clamp(clip.volume, 0, MAX_GAIN) * clamp(track.volume, 0, MAX_GAIN);
}

/** True when the mix changes nothing about the video audio — export can skip the mix pass. */
export function isMixNeutral(mix: AudioMix): boolean {
  return (
    totalClipCount(mix) === 0 &&
    videoAudioGain(mix) === 1 &&
    clamp(mix.mixer.master, 0, MAX_GAIN) === 1
  );
}

// ── Fades ───────────────────────────────────────────────────────────────

/** Effective fades: neither may exceed half the clip, so in/out never overlap. */
export function clipFades(clip: AudioClip): { fadeIn: number; fadeOut: number } {
  const cap = clip.length / 2;
  return {
    fadeIn: clamp(clip.fadeIn, 0, cap),
    fadeOut: clamp(clip.fadeOut, 0, cap),
  };
}

/** 0–1 fade level `localT` seconds into the clip. */
export function fadeLevelAt(clip: AudioClip, localT: number): number {
  const { fadeIn, fadeOut } = clipFades(clip);
  let level = 1;
  if (fadeIn > 0 && localT < fadeIn) level = Math.min(level, localT / fadeIn);
  if (fadeOut > 0 && localT > clip.length - fadeOut) {
    level = Math.min(level, (clip.length - localT) / fadeOut);
  }
  return clamp(level, 0, 1);
}

export interface GainKeyframe {
  /** Seconds from the moment playback of this clip begins. */
  at: number;
  value: number;
}

/**
 * Gain automation for playing a clip from `fromLocal` seconds into it, as
 * linear-ramp keyframes (first one is an immediate set). Pure so the preview's
 * envelope can be tested against `fadeLevelAt`.
 */
export function gainKeyframes(clip: AudioClip, gain: number, fromLocal: number): GainKeyframe[] {
  const { fadeIn, fadeOut } = clipFades(clip);
  const remaining = clip.length - fromLocal;
  if (remaining <= 0) return [];

  const frames: GainKeyframe[] = [{ at: 0, value: gain * fadeLevelAt(clip, fromLocal) }];
  const pushAt = (local: number, level: number) => {
    const at = local - fromLocal;
    if (at > 0 && at <= remaining) frames.push({ at: round3(at), value: gain * level });
  };
  if (fadeIn > 0 && fromLocal < fadeIn) pushAt(fadeIn, 1);
  if (fadeOut > 0) {
    const outStart = clip.length - fadeOut;
    if (fromLocal < outStart) pushAt(outStart, 1);
    pushAt(clip.length, 0);
  }
  return frames;
}

// ── Tracks ──────────────────────────────────────────────────────────────

export function newTrack(mix: AudioMix, kind: TrackKind = 'audio'): AudioMix {
  if (mix.tracks.length >= MAX_TRACKS) return mix;
  const sameKind = mix.tracks.filter((t) => t.kind === kind).length;
  const track: AudioTrack = {
    id: newId('trk'),
    name: `${TRACK_KIND_LABEL[kind]} ${sameKind + 1}`,
    kind,
    volume: 1,
    muted: false,
    solo: false,
    clips: [],
  };
  return { ...mix, tracks: [...mix.tracks, track] };
}

export function patchTrack(
  mix: AudioMix,
  trackId: string,
  patch: Partial<Pick<AudioTrack, 'name' | 'kind' | 'volume' | 'muted' | 'solo'>>
): AudioMix {
  let hit = false;
  const tracks = mix.tracks.map((t) => {
    if (t.id !== trackId) return t;
    hit = true;
    return {
      ...t,
      ...patch,
      ...(patch.volume !== undefined ? { volume: clamp(patch.volume, 0, MAX_GAIN) } : {}),
    };
  });
  return hit ? { ...mix, tracks } : mix;
}

export function removeTrack(mix: AudioMix, trackId: string): AudioMix {
  const tracks = mix.tracks.filter((t) => t.id !== trackId);
  return tracks.length === mix.tracks.length ? mix : { ...mix, tracks };
}

export function patchVideoChannel(mix: AudioMix, patch: Partial<ChannelState>): AudioMix {
  const video = { ...mix.mixer.video, ...patch };
  video.volume = clamp(video.volume, 0, MAX_GAIN);
  return { ...mix, mixer: { ...mix.mixer, video } };
}

export function setMaster(mix: AudioMix, master: number): AudioMix {
  return { ...mix, mixer: { ...mix.mixer, master: clamp(master, 0, MAX_GAIN) } };
}

// ── Clips ───────────────────────────────────────────────────────────────

export interface NewAudioClip {
  url: string;
  label: string;
  start: number;
  length: number;
  trimStart?: number;
  sourceDuration?: number;
  volume?: number;
  loop?: boolean;
}

/** Add a clip to a track. Returns the new mix and the clip's id (null if a limit blocked it). */
export function addClip(
  mix: AudioMix,
  trackId: string,
  input: NewAudioClip
): { mix: AudioMix; clipId: string | null } {
  const track = mix.tracks.find((t) => t.id === trackId);
  if (!track) return { mix, clipId: null };
  if (track.clips.length >= MAX_CLIPS_PER_TRACK || totalClipCount(mix) >= MAX_TOTAL_CLIPS) {
    return { mix, clipId: null };
  }
  const clip: AudioClip = {
    id: newId('aud'),
    url: input.url,
    label: input.label,
    start: Math.max(0, round3(input.start)),
    trimStart: input.loop ? 0 : Math.max(0, round3(input.trimStart ?? 0)),
    length: Math.max(MIN_AUDIO_CLIP_SEC, round3(input.length)),
    volume: clamp(input.volume ?? 1, 0, MAX_GAIN),
    fadeIn: 0,
    fadeOut: 0,
    ...(input.loop ? { loop: true } : {}),
    ...(input.sourceDuration ? { sourceDuration: input.sourceDuration } : {}),
  };
  const tracks = mix.tracks.map((t) =>
    t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
  );
  return { mix: { ...mix, tracks }, clipId: clip.id };
}

function mapClip(mix: AudioMix, clipId: string, fn: (c: AudioClip) => AudioClip): AudioMix {
  const found = findClip(mix, clipId);
  if (!found) return mix;
  const next = fn(found.clip);
  if (next === found.clip) return mix;
  const tracks = mix.tracks.map((t) =>
    t.id === found.track.id ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? next : c)) } : t
  );
  return { ...mix, tracks };
}

/** Edit a clip's level / fades / label / loop, clamping everything into range. */
export function patchClip(
  mix: AudioMix,
  clipId: string,
  patch: Partial<Pick<AudioClip, 'label' | 'volume' | 'fadeIn' | 'fadeOut' | 'loop'>>
): AudioMix {
  return mapClip(mix, clipId, (c) => {
    const next: AudioClip = { ...c, ...patch };
    next.volume = clamp(finite(next.volume, 1), 0, MAX_GAIN);
    next.fadeIn = clamp(finite(next.fadeIn, 0), 0, Math.min(MAX_FADE_SEC, c.length / 2));
    next.fadeOut = clamp(finite(next.fadeOut, 0), 0, Math.min(MAX_FADE_SEC, c.length / 2));
    if (patch.loop === true) next.trimStart = 0;
    if (patch.loop === false) delete next.loop;
    return next;
  });
}

/**
 * Move a clip to `start` on the timeline, optionally onto another track.
 * Clips may overlap freely (that's what a mix is) — nothing ripples.
 */
export function moveAudioClip(
  mix: AudioMix,
  clipId: string,
  start: number,
  toTrackId?: string
): AudioMix {
  const found = findClip(mix, clipId);
  if (!found) return mix;
  const nextStart = Math.max(0, round3(start));
  const destId = toTrackId ?? found.track.id;
  if (nextStart === found.clip.start && destId === found.track.id) return mix;

  if (destId === found.track.id) return mapClip(mix, clipId, (c) => ({ ...c, start: nextStart }));

  const dest = mix.tracks.find((t) => t.id === destId);
  if (!dest || dest.clips.length >= MAX_CLIPS_PER_TRACK) return mix;
  const moved = { ...found.clip, start: nextStart };
  return {
    ...mix,
    tracks: mix.tracks.map((t) => {
      if (t.id === found.track.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
      if (t.id === destId) return { ...t, clips: [...t.clips, moved] };
      return t;
    }),
  };
}

/**
 * Trim one edge of a clip by `deltaSec` (positive = later). Unlike the video
 * track this is NOT a ripple: trimming the head moves the clip's start so the
 * audio that remains stays exactly where it was on the timeline.
 */
export function trimAudioClipEdge(
  mix: AudioMix,
  clipId: string,
  edge: 'start' | 'end',
  deltaSec: number
): AudioMix {
  return mapClip(mix, clipId, (c) => {
    if (edge === 'start') {
      // Looped clips have no in-point to move — trimming the head just shortens them.
      const minDelta = c.loop ? -c.start : -Math.min(c.trimStart, c.start);
      const d = clamp(deltaSec, minDelta, c.length - MIN_AUDIO_CLIP_SEC);
      if (d === 0) return c;
      return {
        ...c,
        start: round3(c.start + d),
        trimStart: c.loop ? 0 : round3(c.trimStart + d),
        length: round3(c.length - d),
      };
    }
    const cap =
      c.loop || !c.sourceDuration
        ? Infinity
        : Math.max(MIN_AUDIO_CLIP_SEC, c.sourceDuration - c.trimStart);
    const length = clamp(c.length + deltaSec, MIN_AUDIO_CLIP_SEC, cap);
    return length === c.length ? c : { ...c, length: round3(length) };
  });
}

/** Razor: cut a clip in two at timeline time `t`. Null when a half would be too short. */
export function splitAudioClipAt(
  mix: AudioMix,
  clipId: string,
  t: number
): { mix: AudioMix; rightId: string } | null {
  const found = findClip(mix, clipId);
  if (!found) return null;
  const { clip, track } = found;
  const offset = t - clip.start;
  if (offset < MIN_AUDIO_CLIP_SEC || clip.length - offset < MIN_AUDIO_CLIP_SEC) return null;
  if (track.clips.length >= MAX_CLIPS_PER_TRACK || totalClipCount(mix) >= MAX_TOTAL_CLIPS) {
    return null;
  }

  const rightId = newId('aud');
  const left: AudioClip = { ...clip, length: round3(offset), fadeOut: 0 };
  const right: AudioClip = {
    ...clip,
    id: rightId,
    start: round3(clip.start + offset),
    // A looped clip restarts its loop on the right half, like re-triggering the bed.
    trimStart: clip.loop ? 0 : round3(clip.trimStart + offset),
    length: round3(clip.length - offset),
    fadeIn: 0,
  };
  const tracks = mix.tracks.map((tr) =>
    tr.id === track.id
      ? { ...tr, clips: tr.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])) }
      : tr
  );
  return { mix: { ...mix, tracks }, rightId };
}

export function removeAudioClips(mix: AudioMix, ids: Set<string>): AudioMix {
  if (ids.size === 0) return mix;
  let changed = false;
  const tracks = mix.tracks.map((t) => {
    const clips = t.clips.filter((c) => !ids.has(c.id));
    if (clips.length !== t.clips.length) changed = true;
    return clips.length === t.clips.length ? t : { ...t, clips };
  });
  return changed ? { ...mix, tracks } : mix;
}

/** Clips sounding at timeline time `t`, across all tracks. */
export function activeAudioClips(
  mix: AudioMix,
  t: number
): Array<{ track: AudioTrack; clip: AudioClip }> {
  const out: Array<{ track: AudioTrack; clip: AudioClip }> = [];
  for (const track of mix.tracks) {
    for (const clip of track.clips) {
      if (t >= clip.start && t < clipEnd(clip)) out.push({ track, clip });
    }
  }
  return out;
}

/** Times worth snapping audio clips to: 0, the playhead, every clip edge (except `excludeId`'s). */
export function audioSnapPoints(mix: AudioMix, playhead: number, excludeId?: string): number[] {
  const points = new Set<number>([0, playhead]);
  for (const t of mix.tracks) {
    for (const c of t.clips) {
      if (c.id === excludeId) continue;
      points.add(c.start);
      points.add(clipEnd(c));
    }
  }
  return [...points];
}

// ── Persistence ─────────────────────────────────────────────────────────

function sanitizeChannel(raw: any): ChannelState {
  return {
    volume: clamp(finite(raw?.volume, 1), 0, MAX_GAIN),
    muted: !!raw?.muted,
    solo: !!raw?.solo,
  };
}

function sanitizeClip(raw: any): AudioClip | null {
  if (!raw || typeof raw.url !== 'string' || !raw.url) return null;
  const loop = raw.loop === true;
  const length = Math.max(MIN_AUDIO_CLIP_SEC, finite(raw.length, 0));
  const clip: AudioClip = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('aud'),
    url: raw.url,
    label: typeof raw.label === 'string' ? raw.label : '',
    start: Math.max(0, finite(raw.start, 0)),
    trimStart: loop ? 0 : Math.max(0, finite(raw.trimStart, 0)),
    length,
    volume: clamp(finite(raw.volume, 1), 0, MAX_GAIN),
    fadeIn: clamp(finite(raw.fadeIn, 0), 0, Math.min(MAX_FADE_SEC, length / 2)),
    fadeOut: clamp(finite(raw.fadeOut, 0), 0, Math.min(MAX_FADE_SEC, length / 2)),
  };
  if (loop) clip.loop = true;
  const src = finite(raw.sourceDuration, 0);
  if (src > 0) clip.sourceDuration = src;
  return clip;
}

/** Turn whatever the server returned (or an old episode without a mix) into a valid AudioMix. */
export function normalizeMix(raw: unknown): AudioMix {
  const r = raw as any;
  if (!r || typeof r !== 'object') return EMPTY_MIX;
  const rawTracks: any[] = Array.isArray(r.tracks) ? r.tracks.slice(0, MAX_TRACKS) : [];
  let budget = MAX_TOTAL_CLIPS;
  const tracks: AudioTrack[] = rawTracks.map((t, i) => {
    const kind: TrackKind = ['music', 'voice', 'sfx', 'audio'].includes(t?.kind) ? t.kind : 'audio';
    const clips = (Array.isArray(t?.clips) ? t.clips : [])
      .slice(0, Math.min(MAX_CLIPS_PER_TRACK, budget))
      .map(sanitizeClip)
      .filter((c: AudioClip | null): c is AudioClip => !!c);
    budget -= clips.length;
    return {
      id: typeof t?.id === 'string' && t.id ? t.id : newId('trk'),
      name: typeof t?.name === 'string' && t.name ? t.name : `${TRACK_KIND_LABEL[kind]} ${i + 1}`,
      kind,
      volume: clamp(finite(t?.volume, 1), 0, MAX_GAIN),
      muted: !!t?.muted,
      solo: !!t?.solo,
      clips,
    };
  });
  return {
    tracks,
    mixer: {
      video: sanitizeChannel(r.mixer?.video),
      master: clamp(finite(r.mixer?.master, 1), 0, MAX_GAIN),
    },
  };
}

/**
 * The legacy single soundtrack bed becomes a normal looping music track, so
 * old episodes keep sounding the same and the bed is editable like any clip.
 * (`sourceDuration` unknown here: the bed loops to fill the whole episode.)
 */
export function soundtrackToMix(
  mix: AudioMix,
  soundtrack: { url: string; label?: string; volume: number },
  episodeLength: number
): AudioMix {
  const withTrack = newTrack(mix, 'music');
  const track = withTrack.tracks[withTrack.tracks.length - 1];
  if (!track) return mix;
  const named = patchTrack(withTrack, track.id, { name: 'Soundtrack' });
  const { mix: out } = addClip(named, track.id, {
    url: soundtrack.url,
    label: soundtrack.label || 'Soundtrack',
    start: 0,
    length: Math.max(MIN_AUDIO_CLIP_SEC, episodeLength),
    volume: clamp(soundtrack.volume, 0, 1),
    loop: true,
  });
  return out;
}

// ── Waveform peaks ──────────────────────────────────────────────────────

/** How many peak samples we keep per second of audio (enough for a sharp lane at any zoom). */
export const PEAKS_PER_SEC = 50;

/**
 * Collapse channel data to `binsPerSec` max-abs peaks per second. Pure over
 * plain arrays so it can be tested without an AudioBuffer.
 */
export function computePeaks(
  channels: Float32Array[],
  sampleRate: number,
  binsPerSec = PEAKS_PER_SEC
): Float32Array {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return new Float32Array(0);
  const binSize = Math.max(1, Math.floor(sampleRate / binsPerSec));
  const bins = Math.ceil(length / binSize);
  const peaks = new Float32Array(bins);
  for (const data of channels) {
    for (let b = 0; b < bins; b++) {
      const from = b * binSize;
      const to = Math.min(length, from + binSize);
      let max = 0;
      for (let i = from; i < to; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      if (max > peaks[b]) peaks[b] = max;
    }
  }
  return peaks;
}

/**
 * Peak values for a window of the source, resampled to `width` columns — what a
 * lane draws for a clip trimmed to [srcStart, srcStart+srcLength).
 */
export function peaksWindow(
  peaks: Float32Array,
  binsPerSec: number,
  srcStart: number,
  srcLength: number,
  width: number
): Float32Array {
  const out = new Float32Array(Math.max(0, width));
  if (peaks.length === 0 || width <= 0 || srcLength <= 0) return out;
  const first = srcStart * binsPerSec;
  const span = srcLength * binsPerSec;
  for (let x = 0; x < width; x++) {
    const a = Math.floor(first + (x / width) * span);
    const b = Math.max(a + 1, Math.floor(first + ((x + 1) / width) * span));
    let max = 0;
    for (let i = a; i < b && i < peaks.length; i++) if (i >= 0 && peaks[i] > max) max = peaks[i];
    out[x] = max;
  }
  return out;
}
