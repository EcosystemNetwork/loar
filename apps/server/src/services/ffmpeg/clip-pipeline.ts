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
import { writeFile, unlink } from 'fs/promises';

const execFileAsync = promisify(execFile);

export interface ClipTrimSpec {
  /** Video URL (IPFS, Firebase Storage, or direct). */
  videoUrl: string;
  /** Optional audio overlay URL — replaces/muxes over the clip's own audio. */
  audioUrl?: string;
  /** Trim start (seconds). */
  trimStart?: number;
  /** Trim end (seconds, 0/undefined = full clip). */
  trimEnd?: number;
}

/**
 * Downloads one clip (SSRF-validated via `validateUploadUrl`), applies an
 * optional trim (`-ss`/`-to`) and audio overlay, and re-encodes it to a
 * consistent 1280x720 h264/aac format so it can later be concatenated with
 * other normalized clips via a fast stream-copy concat.
 *
 * Returns the local path to the processed (normalized) file.
 */
export async function downloadAndNormalizeClip(
  spec: ClipTrimSpec,
  workDir: string,
  index: number
): Promise<string> {
  // safeFetch: SSRF validation + IP pinning (no DNS-rebinding window).
  const { safeFetch } = await import('../../lib/url-validator');

  const ext = spec.videoUrl.includes('.webm') ? 'webm' : 'mp4';
  const clipPath = join(workDir, `clip-${String(index).padStart(3, '0')}.${ext}`);

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

  const trimStart = spec.trimStart ?? 0;
  const trimEnd = spec.trimEnd ?? 0;
  // Whether we need a "processing" pass beyond the plain consistency
  // re-encode — mirrors the original runExport branch condition exactly.
  const needsProcessing = trimStart > 0 || trimEnd > 0 || !!spec.audioUrl;

  const processedPath = join(workDir, `proc-${String(index).padStart(3, '0')}.mp4`);
  const args = ['-y', '-i', clipPath];

  if (spec.audioUrl) {
    const audioPath = join(workDir, `audio-${String(index).padStart(3, '0')}.mp3`);
    const audioRes = await safeFetch(spec.audioUrl, { redirect: 'error' });
    if (audioRes.ok) {
      await writeFile(audioPath, Buffer.from(await audioRes.arrayBuffer()));
      args.push('-i', audioPath);
    }
  }

  if (trimStart > 0) args.push('-ss', String(trimStart));
  if (trimEnd > 0) args.push('-to', String(trimEnd));

  args.push(
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2'
  );
  if (needsProcessing) args.push('-shortest');
  args.push(processedPath);

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
