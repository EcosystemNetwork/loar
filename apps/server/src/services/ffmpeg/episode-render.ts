/**
 * Pure builders for the Episode Studio export — everything that decides WHAT
 * ffmpeg is asked to do, kept free of I/O so it can be unit-tested.
 *
 * Two stages, mirroring `clip-pipeline.ts`:
 *   1. per clip   — trim, frame to the export size, fades, volume, silent-audio
 *                   padding (so every clip has the same streams and the
 *                   stream-copy concat stays valid)
 *   2. per episode — burn text overlays and mix a soundtrack under the result
 */

// ── Export presets ──────────────────────────────────────────────────────

export type ExportAspect = '16:9' | '9:16' | '1:1';
export type ExportResolution = '720p' | '1080p';
/** `fit` letterboxes; `fill` crops to cover the frame. */
export type ExportFraming = 'fit' | 'fill';

export interface ExportSettings {
  aspect: ExportAspect;
  resolution: ExportResolution;
  framing: ExportFraming;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  aspect: '16:9',
  resolution: '720p',
  framing: 'fit',
};

export interface RenderTarget {
  width: number;
  height: number;
  framing: ExportFraming;
}

export const OUTPUT_FPS = 30;

/** Short edge in pixels for a resolution label (H.264 wants even dimensions). */
const SHORT_EDGE: Record<ExportResolution, number> = { '720p': 720, '1080p': 1080 };

export function exportTarget(settings: Partial<ExportSettings> = {}): RenderTarget {
  const { aspect, resolution, framing } = { ...DEFAULT_EXPORT_SETTINGS, ...settings };
  const short = SHORT_EDGE[resolution] ?? 720;
  const long = Math.round((short * 16) / 9 / 2) * 2;
  if (aspect === '9:16') return { width: short, height: long, framing };
  if (aspect === '1:1') return { width: short, height: short, framing };
  return { width: long, height: short, framing };
}

// ── Stage 1: one clip ───────────────────────────────────────────────────

export interface ClipRenderSpec {
  /** Local path of the downloaded video. */
  clipPath: string;
  /** Local path of a downloaded audio overlay (replaces the clip's own audio). */
  audioPath?: string;
  /** Does the video file itself carry an audio stream? */
  hasAudio: boolean;
  trimStart: number;
  /** 0 = to the end of the file. */
  trimEnd: number;
  /** Length of the source file in seconds (0 when unknown). */
  sourceDurationSec: number;
  /** 0–2, 1 = unchanged. */
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  target: RenderTarget;
  outputPath: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Seconds the clip plays for once trimmed, or 0 if it can't be known. */
export function clipLengthSec(spec: {
  trimStart: number;
  trimEnd: number;
  sourceDurationSec: number;
}): number {
  const end = spec.trimEnd > 0 ? spec.trimEnd : spec.sourceDurationSec;
  return Math.max(0, end - spec.trimStart);
}

export function videoFilter(
  target: RenderTarget,
  fades: { lengthSec: number; fadeIn: number; fadeOut: number }
): string {
  const { width: w, height: h } = target;
  const frame =
    target.framing === 'fill'
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const parts = [frame, 'setsar=1', `fps=${OUTPUT_FPS}`];
  if (fades.fadeIn > 0) parts.push(`fade=t=in:st=0:d=${num(fades.fadeIn)}`);
  if (fades.fadeOut > 0) {
    parts.push(
      `fade=t=out:st=${num(Math.max(0, fades.lengthSec - fades.fadeOut))}:d=${num(fades.fadeOut)}`
    );
  }
  return parts.join(',');
}

export function audioFilter(
  volume: number,
  fades: { lengthSec: number; fadeIn: number; fadeOut: number }
): string | null {
  const parts: string[] = [];
  if (Math.abs(volume - 1) > 0.001) parts.push(`volume=${num(volume)}`);
  if (fades.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${num(fades.fadeIn)}`);
  if (fades.fadeOut > 0) {
    parts.push(
      `afade=t=out:st=${num(Math.max(0, fades.lengthSec - fades.fadeOut))}:d=${num(fades.fadeOut)}`
    );
  }
  return parts.length ? parts.join(',') : null;
}

/** ffmpeg argv that normalizes one clip to `target` (see stage 1 above). */
export function buildClipArgs(spec: ClipRenderSpec): string[] {
  const lengthSec = clipLengthSec(spec);
  // A fade can't be longer than half the clip, or the in/out would overlap.
  const cap = lengthSec > 0 ? lengthSec / 2 : Infinity;
  const fades = {
    lengthSec,
    fadeIn: clamp(spec.fadeIn ?? 0, 0, cap),
    fadeOut: clamp(spec.fadeOut ?? 0, 0, cap),
  };

  const args = ['-y', '-i', spec.clipPath];
  // Audio source: the overlay if there is one, else the clip's own track, else
  // generated silence — so every normalized clip has a video AND an audio stream.
  let audioMap: string;
  if (spec.audioPath) {
    args.push('-i', spec.audioPath);
    audioMap = '1:a:0';
  } else if (spec.hasAudio) {
    audioMap = '0:a:0';
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    audioMap = '1:a:0';
  }

  if (spec.trimStart > 0) args.push('-ss', num(spec.trimStart));
  if (spec.trimEnd > 0) args.push('-to', num(spec.trimEnd));

  args.push('-map', '0:v:0', '-map', audioMap);
  args.push('-vf', videoFilter(spec.target, fades));
  const af = audioFilter(clamp(spec.volume ?? 1, 0, 2), fades);
  if (af) args.push('-af', af);
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    // The generated-silence and overlay inputs may outlast the video.
    '-shortest',
    spec.outputPath
  );
  return args;
}

// ── Stage 2: whole episode ──────────────────────────────────────────────

export type OverlayPosition = 'top' | 'center' | 'bottom';
export type OverlaySize = 'sm' | 'md' | 'lg';

export interface TextOverlay {
  id: string;
  text: string;
  /** Timeline seconds. */
  start: number;
  end: number;
  position: OverlayPosition;
  size: OverlaySize;
}

export interface Soundtrack {
  url: string;
  label?: string;
  /** 0–1 */
  volume: number;
}

const FONT_HEIGHT_FRACTION: Record<OverlaySize, number> = { sm: 0.04, md: 0.055, lg: 0.08 };

export function overlayFontSize(size: OverlaySize, frameHeight: number): number {
  return Math.max(12, Math.round(frameHeight * (FONT_HEIGHT_FRACTION[size] ?? 0.055)));
}

/** Greedy word wrap — drawtext doesn't wrap, and long lines would run off-frame. */
export function wrapText(text: string, maxChars: number): string {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Escape a value for use inside a filtergraph option (`key=value`). */
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Text wrapped to fit the frame at this overlay's size. */
export function overlayText(o: TextOverlay, target: RenderTarget): string {
  const fontSize = overlayFontSize(o.size, target.height);
  // ~0.55em average glyph width, leaving a 10% margin each side.
  const maxChars = Math.max(8, Math.floor((target.width * 0.8) / (fontSize * 0.55)));
  return wrapText(o.text.trim(), maxChars);
}

export function drawtextFilter(
  o: TextOverlay,
  target: RenderTarget,
  textFile: string,
  fontFile: string
): string {
  const fontSize = overlayFontSize(o.size, target.height);
  const margin = Math.round(target.height * 0.08);
  const y =
    o.position === 'top'
      ? String(margin)
      : o.position === 'center'
        ? '(h-text_h)/2'
        : `h-text_h-${margin}`;
  return [
    'drawtext',
    [
      `fontfile=${escapeFilterValue(fontFile)}`,
      `textfile=${escapeFilterValue(textFile)}`,
      `fontsize=${fontSize}`,
      'fontcolor=white',
      'box=1',
      'boxcolor=black@0.55',
      `boxborderw=${Math.round(fontSize * 0.3)}`,
      'line_spacing=6',
      'x=(w-text_w)/2',
      `y=${y}`,
      `enable='between(t,${num(o.start)},${num(o.end)})'`,
    ].join(':'),
  ].join('=');
}

export interface FinalizeSpec {
  inputPath: string;
  outputPath: string;
  target: RenderTarget;
  overlays: TextOverlay[];
  /** Local file for each overlay, index-aligned with `overlays`. */
  overlayTextFiles: string[];
  fontFile: string | null;
  soundtrackPath?: string;
  soundtrackVolume?: number;
}

/**
 * The episode-wide pass. Returns null when there is nothing to do, so the
 * caller can skip a full re-encode and ship the stream-copy concat as is.
 */
export function buildFinalizeArgs(spec: FinalizeSpec): string[] | null {
  const drawn = spec.fontFile ? spec.overlays : [];
  if (drawn.length === 0 && !spec.soundtrackPath) return null;

  const args = ['-y', '-i', spec.inputPath];
  if (spec.soundtrackPath) args.push('-stream_loop', '-1', '-i', spec.soundtrackPath);

  const graph: string[] = [];
  if (drawn.length) {
    const chain = drawn.map((o, i) =>
      drawtextFilter(o, spec.target, spec.overlayTextFiles[i], spec.fontFile as string)
    );
    graph.push(`[0:v]${chain.join(',')}[v]`);
  }
  if (spec.soundtrackPath) {
    const vol = clamp(spec.soundtrackVolume ?? 0.5, 0, 1);
    graph.push(
      `[1:a]volume=${num(vol)}[bed]`,
      // normalize=0 keeps the dialogue at its own level instead of halving it.
      '[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]'
    );
  }

  args.push('-filter_complex', graph.join(';'));
  args.push('-map', drawn.length ? '[v]' : '0:v:0');
  args.push('-map', spec.soundtrackPath ? '[a]' : '0:a:0');
  if (drawn.length) {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }
  if (spec.soundtrackPath) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2');
  else args.push('-c:a', 'copy');
  args.push('-shortest', spec.outputPath);
  return args;
}

/** Font candidates by distro — Alpine (the server image), Debian, macOS. */
export const FONT_CANDIDATES = [
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];
