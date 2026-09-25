/**
 * Multi-track audio mixdown for the Episode Studio export.
 *
 * The finished episode video already has ONE audio track (its clips' own audio,
 * plus the legacy soundtrack bed if any). This pass sums that with every audio
 * clip on every audio track into a single new final audio track, applying
 * per-clip / per-track / video-channel / master gains, mute + solo, timing,
 * fades and looping. The video stream is copied untouched.
 *
 * `resolveMix` mirrors the rules in the web app's `lib/audioMix.ts`
 * (`effectiveClipGain`, `videoAudioGain`, `clipFades`) — the live preview and
 * the export must sound the same, so change both together. Everything here is
 * pure (no I/O) so it can be unit-tested; `finalizeEpisode` does the downloads.
 */

export const MAX_GAIN = 2;
export const MAX_TRACKS = 8;
export const MAX_CLIPS_PER_TRACK = 30;
export const MAX_TOTAL_CLIPS = 40;
export const MIN_CLIP_SEC = 0.1;

export interface MixClip {
  id: string;
  url: string;
  label?: string;
  /** Timeline start (seconds). */
  start: number;
  /** In-point in the source file (seconds); ignored when `loop`. */
  trimStart: number;
  /** Playing length on the timeline (seconds). */
  length: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop?: boolean;
  sourceDuration?: number;
}

export interface MixTrack {
  id: string;
  name?: string;
  kind?: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  clips: MixClip[];
}

export interface MixChannel {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface StoredMix {
  tracks: MixTrack[];
  mixer: { video: MixChannel; master: number };
}

export const NEUTRAL_MIX: StoredMix = {
  tracks: [],
  mixer: { video: { volume: 1, muted: false, solo: false }, master: 1 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const num = (n: number) => String(Math.round(n * 1000) / 1000);

// ── Rules ───────────────────────────────────────────────────────────────

/** A clip after mute/solo/faders are folded in, ready to become an ffmpeg input. */
export interface ResolvedClip {
  id: string;
  url: string;
  start: number;
  trimStart: number;
  length: number;
  /** Clip × track gain (master is applied once on the sum). */
  gain: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
}

export interface ResolvedMix {
  clips: ResolvedClip[];
  videoGain: number;
  masterGain: number;
}

export function resolveMix(mix: StoredMix): ResolvedMix {
  const anySolo = mix.mixer.video.solo || mix.tracks.some((t) => t.solo);
  const videoAudible = anySolo ? mix.mixer.video.solo : !mix.mixer.video.muted;
  const videoGain = videoAudible ? clamp(mix.mixer.video.volume, 0, MAX_GAIN) : 0;

  const clips: ResolvedClip[] = [];
  for (const track of mix.tracks) {
    const audible = anySolo ? track.solo : !track.muted;
    if (!audible) continue;
    for (const clip of track.clips) {
      const gain = clamp(clip.volume, 0, MAX_GAIN) * clamp(track.volume, 0, MAX_GAIN);
      const length = Math.max(0, clip.length);
      if (gain <= 0 || length < MIN_CLIP_SEC) continue;
      // Neither fade may exceed half the clip, so in/out never overlap.
      const cap = length / 2;
      clips.push({
        id: clip.id,
        url: clip.url,
        start: Math.max(0, clip.start),
        trimStart: clip.loop ? 0 : Math.max(0, clip.trimStart),
        length,
        gain,
        fadeIn: clamp(clip.fadeIn, 0, cap),
        fadeOut: clamp(clip.fadeOut, 0, cap),
        loop: !!clip.loop,
      });
    }
  }
  return { clips, videoGain, masterGain: clamp(mix.mixer.master, 0, MAX_GAIN) };
}

/**
 * Is this the untouched default (no tracks, unity mixer)? Stored as null so an
 * episode nobody has mixed stays byte-identical to one saved before this feature,
 * and autosaving it doesn't look like an edit.
 */
export function isDefaultMix(mix: StoredMix): boolean {
  const { video, master } = mix.mixer;
  return (
    mix.tracks.length === 0 && video.volume === 1 && !video.muted && !video.solo && master === 1
  );
}

/** True when the mix wouldn't change the video's audio at all — the export can skip this pass. */
export function isNeutral(resolved: ResolvedMix): boolean {
  return resolved.clips.length === 0 && resolved.videoGain === 1 && resolved.masterGain === 1;
}

// ── Filtergraph ─────────────────────────────────────────────────────────

const NORMALIZE = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';

export interface MixdownClipInput extends ResolvedClip {
  /** Local path of the downloaded audio. */
  path: string;
  /**
   * Channel count of the file. Mono is duplicated to both channels at unity —
   * what browsers do, so the preview and the export are equally loud. (ffmpeg's own
   * mono→stereo upmix attenuates by 3 dB.) Unknown is treated as stereo.
   */
  channels?: number;
}

export interface MixdownSpec {
  /** The finished video (with overlays / legacy soundtrack already applied). */
  inputPath: string;
  outputPath: string;
  clips: MixdownClipInput[];
  videoGain: number;
  masterGain: number;
}

/** Filter chain for one clip: level, fades, then delay to its timeline position. */
export function clipFilter(clip: ResolvedClip & { channels?: number }): string {
  const parts = clip.channels === 1 ? ['pan=stereo|c0=c0|c1=c0', NORMALIZE] : [NORMALIZE];
  if (Math.abs(clip.gain - 1) > 0.001) parts.push(`volume=${num(clip.gain)}`);
  if (clip.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${num(clip.fadeIn)}`);
  if (clip.fadeOut > 0) {
    parts.push(
      `afade=t=out:st=${num(Math.max(0, clip.length - clip.fadeOut))}:d=${num(clip.fadeOut)}`
    );
  }
  const delayMs = Math.round(clip.start * 1000);
  if (delayMs > 0) parts.push(`adelay=${delayMs}|${delayMs}`);
  return parts.join(',');
}

/**
 * ffmpeg argv that mixes every clip under the video's audio into one track.
 * Returns null when there is nothing to do (no clips, unity gains).
 */
export function buildMixdownArgs(spec: MixdownSpec): string[] | null {
  if (spec.clips.length === 0 && spec.videoGain === 1 && spec.masterGain === 1) return null;

  const args = ['-y', '-i', spec.inputPath];
  spec.clips.forEach((clip) => {
    // Seek/limit on the INPUT so a long music file isn't decoded end to end.
    if (clip.loop) args.push('-stream_loop', '-1', '-t', num(clip.length));
    else args.push('-ss', num(clip.trimStart), '-t', num(clip.length));
    args.push('-i', clip.path);
  });

  const graph: string[] = [];
  const base = [NORMALIZE];
  if (Math.abs(spec.videoGain - 1) > 0.001) base.push(`volume=${num(spec.videoGain)}`);
  graph.push(`[0:a]${base.join(',')}[base]`);
  spec.clips.forEach((clip, i) => graph.push(`[${i + 1}:a]${clipFilter(clip)}[c${i}]`));

  const tail: string[] = [];
  if (Math.abs(spec.masterGain - 1) > 0.001) tail.push(`volume=${num(spec.masterGain)}`);
  // Summing tracks can exceed full scale; a limiter keeps the export from clipping.
  // level=0: don't let the limiter re-normalize a quiet mix back up to 0 dB.
  tail.push('alimiter=limit=0.97:level=0');

  if (spec.clips.length === 0) {
    graph.push(`[base]${tail.join(',')}[a]`);
  } else {
    const inputs = ['[base]', ...spec.clips.map((_, i) => `[c${i}]`)].join('');
    graph.push(
      // normalize=0 keeps every track at its own level instead of dividing by the count;
      // duration=first ends the mix with the video.
      `${inputs}amix=inputs=${spec.clips.length + 1}:duration=first:dropout_transition=0:normalize=0,${tail.join(',')}[a]`
    );
  }

  args.push(
    '-filter_complex',
    graph.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    spec.outputPath
  );
  return args;
}
