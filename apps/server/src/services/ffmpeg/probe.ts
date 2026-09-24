/**
 * ffprobe / ffmpeg helpers for reading real facts about a video.
 *
 * Used where callers previously assumed values (e.g. "source is 1920x1080")
 * or skipped work entirely (video fingerprinting). Shells out via `execFile`
 * like the rest of the ffmpeg code — no fluent-ffmpeg dependency.
 *
 * Remote inputs must be https: ffmpeg's default protocol set includes
 * `file:`, `concat:`, `subfile:` etc., which would let a user-controlled URL
 * read local files, so remote reads are pinned with `-protocol_whitelist`.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const REMOTE_PROTOCOLS = 'https,tls,tcp,crypto';

export interface VideoProbe {
  width: number;
  height: number;
  /** Container duration in seconds; 0 when the container doesn't report one. */
  durationSec: number;
}

/** True for a local absolute path; false for a URL. Throws on anything but https URLs. */
function assertProbeInput(input: string): { remote: boolean } {
  if (input.startsWith('/')) return { remote: false };
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('probe input must be an absolute path or https URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('probe input must be an https URL');
  }
  return { remote: true };
}

/** Parse `ffprobe -of json` output for the first video stream + container duration. */
export function parseProbeOutput(stdout: string): VideoProbe {
  const json = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const stream = json.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('no video stream found');
  }
  const rawDuration = Number(json.format?.duration ?? stream?.duration);
  return {
    width,
    height,
    durationSec: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0,
  };
}

export async function probeVideo(input: string, timeoutMs = 30_000): Promise<VideoProbe> {
  const { remote } = assertProbeInput(input);
  const args = [
    '-v',
    'error',
    ...(remote ? ['-protocol_whitelist', REMOTE_PROTOCOLS] : []),
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration:format=duration',
    '-of',
    'json',
    input,
  ];
  const { stdout } = await execFileAsync('ffprobe', args, { timeout: timeoutMs });
  return parseProbeOutput(stdout);
}

/**
 * Decode a single frame at `atSec` and return it as a PNG buffer.
 * `-ss` before `-i` seeks by keyframe, which is plenty for fingerprinting.
 */
export async function extractFramePng(
  input: string,
  atSec: number,
  timeoutMs = 30_000
): Promise<Buffer> {
  const { remote } = assertProbeInput(input);
  const args = [
    '-v',
    'error',
    ...(remote ? ['-protocol_whitelist', REMOTE_PROTOCOLS] : []),
    '-ss',
    String(Math.max(0, atSec)),
    '-i',
    input,
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1',
  ];
  const { stdout } = await execFileAsync('ffmpeg', args, {
    timeout: timeoutMs,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!stdout.length) throw new Error(`no frame decoded at ${atSec}s`);
  return stdout;
}
