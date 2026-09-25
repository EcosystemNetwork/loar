/**
 * Shared ffmpeg clip pipeline — trim + normalize + concat.
 *
 * Extracted from `episodes.routes.ts`'s `runExport` (the original, and
 * still only, caller) so the same tested ffmpeg invocations can be reused
 * by the clip library's standalone "merge" and "trim to a reusable clip"
 * endpoints instead of re-implementing ffmpeg orchestration a second time.
 *
 * Everything here shells out to the `ffmpeg` binary via `execFile` — there
 * is no fluent-ffmpeg dependency in this repo, by convention (see
 * dubbing.routes.ts, video-thumbnail.ts, etc.).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { writeFile, unlink, access } from 'fs/promises';
import { probeAudioChannels, probeHasAudio, probeVideo } from './probe';
import { buildMixdownArgs, isNeutral, resolveMix, type StoredMix } from './audio-mix';
import {
  FONT_CANDIDATES,
  buildClipArgs,
  buildFinalizeArgs,
  exportTarget,
  overlayText,
  type RenderTarget,
  type Soundtrack,
  type TextOverlay,
} from './episode-render';

const execFileAsync = promisify(execFile);

export interface ClipTrimSpec {
  /** Video URL (IPFS, Firebase Storage, or direct). */
  videoUrl: string;
  /** Optional audio overlay URL — replaces the clip's own audio. */
  audioUrl?: string;
  /** Trim start (seconds). */
  trimStart?: number;
  /** Trim end (seconds, 0/undefined = full clip). */
  trimEnd?: number;
  /** Clip audio level, 0–2 (1 = unchanged). */
  volume?: number;
  /** Fade from / to black (and silence) over this many seconds. */
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Downloads one clip (SSRF-validated via `safeFetch`), applies the trim, fades,
 * volume and audio overlay, and re-encodes it to the export frame size
 * (default 1280x720 h264/aac). Every output has both a video and an audio
 * stream — silent sources get generated silence — so the results can be joined
 * with a fast stream-copy concat.
 *
 * Returns the local path to the processed (normalized) file.
 */
export async function downloadAndNormalizeClip(
  spec: ClipTrimSpec,
  workDir: string,
  index: number,
  target: RenderTarget = exportTarget()
): Promise<string> {
  // safeFetch: SSRF validation + IP pinning (no DNS-rebinding window).
  const { safeFetch } = await import('../../lib/url-validator');

  const ext = spec.videoUrl.includes('.webm') ? 'webm' : 'mp4';
  const padded = String(index).padStart(3, '0');
  const clipPath = join(workDir, `clip-${padded}.${ext}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await safeFetch(spec.videoUrl, { signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`Failed to download clip ${index}: HTTP ${res.status}`);
  await writeFile(clipPath, Buffer.from(await res.arrayBuffer()));

  let audioPath: string | undefined;
  if (spec.audioUrl) {
    const candidate = join(workDir, `audio-${padded}.mp3`);
    const audioRes = await safeFetch(spec.audioUrl, { redirect: 'error' });
    if (audioRes.ok) {
      await writeFile(candidate, Buffer.from(await audioRes.arrayBuffer()));
      audioPath = candidate;
    }
  }

  const [hasAudio, probe] = await Promise.all([
    probeHasAudio(clipPath).catch(() => false),
    probeVideo(clipPath).catch(() => null),
  ]);

  const processedPath = join(workDir, `proc-${padded}.mp4`);
  const args = buildClipArgs({
    clipPath,
    audioPath,
    hasAudio,
    trimStart: spec.trimStart ?? 0,
    trimEnd: spec.trimEnd ?? 0,
    sourceDurationSec: probe?.durationSec ?? 0,
    volume: spec.volume,
    fadeIn: spec.fadeIn,
    fadeOut: spec.fadeOut,
    target,
    outputPath: processedPath,
  });

  await execFileAsync('ffmpeg', args, { timeout: 120_000 });
  return processedPath;
}

/**
 * Concatenates already-normalized (same codec/resolution) clips via an
 * ffmpeg concat-demuxer stream-copy — fast because no re-encode is needed.
 * `inputPaths` must be local file paths produced by
 * {@link downloadAndNormalizeClip} (or otherwise already normalized).
 */
export async function concatNormalizedClips(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  const listContent = inputPaths.map((p) => `file '${p}'`).join('\n');
  await writeFile(listPath, listContent);
  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
      { timeout: 300_000 }
    );
  } finally {
    unlink(listPath).catch(() => {});
  }
}

export interface FinalizeOptions {
  overlays?: TextOverlay[];
  soundtrack?: Soundtrack | null;
  /** Multi-track audio: mixed into one final audio track after everything else. */
  mix?: StoredMix | null;
  target: RenderTarget;
}

/** Per-file cap for downloaded audio clips (they're decoded by ffmpeg, not held in a request). */
const MAX_MIX_AUDIO_BYTES = 100 * 1024 * 1024;

async function findFont(): Promise<string | null> {
  for (const candidate of FONT_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

/**
 * Episode-wide second pass: burn in text overlays and mix the soundtrack under
 * the dialogue. A no-op (returns `inputPath`) when there is neither, so plain
 * episodes keep the fast stream-copy path.
 *
 * `warnings` collects anything the creator should hear about but that did not
 * justify failing the export (e.g. no font installed for the captions).
 */
export async function finalizeEpisode(
  inputPath: string,
  outputPath: string,
  workDir: string,
  opts: FinalizeOptions
): Promise<{ path: string; warnings: string[] }> {
  const warnings: string[] = [];
  const overlays = opts.overlays ?? [];
  const fontFile = overlays.length ? await findFont() : null;
  if (overlays.length && !fontFile) {
    warnings.push('Text overlays were skipped: no font is installed on the render server.');
  }

  const overlayTextFiles: string[] = [];
  if (fontFile) {
    for (let i = 0; i < overlays.length; i++) {
      const file = join(workDir, `overlay-${i}.txt`);
      await writeFile(file, overlayText(overlays[i], opts.target));
      overlayTextFiles.push(file);
    }
  }

  let soundtrackPath: string | undefined;
  if (opts.soundtrack?.url) {
    const { safeFetch } = await import('../../lib/url-validator');
    try {
      const res = await safeFetch(opts.soundtrack.url, { redirect: 'error' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      soundtrackPath = join(workDir, 'soundtrack.audio');
      await writeFile(soundtrackPath, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      warnings.push(
        `The soundtrack was skipped: it could not be downloaded (${(err as Error).message}).`
      );
    }
  }

  const args = buildFinalizeArgs({
    inputPath,
    outputPath,
    target: opts.target,
    overlays,
    overlayTextFiles,
    fontFile,
    soundtrackPath,
    soundtrackVolume: opts.soundtrack?.volume,
  });
  let current = inputPath;
  if (args) {
    await execFileAsync('ffmpeg', args, { timeout: 600_000 });
    current = outputPath;
  }

  const mixed = await mixdownAudioTracks(current, workDir, opts.mix, warnings);
  return { path: mixed ?? current, warnings };
}

/**
 * Sum every audio track (and the video's own audio) into ONE final audio
 * track. Returns the new file's path, or null when the mix changes nothing.
 * A clip that can't be fetched or has no audio is skipped with a warning
 * rather than failing the whole export.
 */
async function mixdownAudioTracks(
  inputPath: string,
  workDir: string,
  mix: StoredMix | null | undefined,
  warnings: string[]
): Promise<string | null> {
  if (!mix) return null;
  const resolved = resolveMix(mix);
  if (isNeutral(resolved)) return null;

  const { safeFetch } = await import('../../lib/url-validator');
  // One download per distinct URL — the same music file can back several clips.
  const files = new Map<string, { path: string; channels: number } | null>();
  for (const clip of resolved.clips) {
    if (files.has(clip.url)) continue;
    const label =
      mix.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id)?.label || clip.url;
    try {
      const res = await safeFetch(clip.url, { redirect: 'error' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_MIX_AUDIO_BYTES) throw new Error('file is too large');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_MIX_AUDIO_BYTES) throw new Error('file is too large');
      const path = join(workDir, `mix-${files.size}.audio`);
      await writeFile(path, buf);
      const channels = await probeAudioChannels(path);
      if (channels === 0) throw new Error('it has no audio track');
      files.set(clip.url, { path, channels });
    } catch (err) {
      files.set(clip.url, null);
      warnings.push(`Audio "${label}" was skipped: ${(err as Error).message}.`);
    }
  }

  const clips = resolved.clips.flatMap((clip) => {
    const file = files.get(clip.url);
    return file ? [{ ...clip, path: file.path, channels: file.channels }] : [];
  });
  const outputPath = join(workDir, 'mixed.mp4');
  const args = buildMixdownArgs({
    inputPath,
    outputPath,
    clips,
    videoGain: resolved.videoGain,
    masterGain: resolved.masterGain,
  });
  if (!args) return null;
  await execFileAsync('ffmpeg', args, { timeout: 600_000 });
  return outputPath;
}
