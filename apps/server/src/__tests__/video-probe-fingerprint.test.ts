import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { extractFramePng, parseProbeOutput, probeVideo } from '../services/ffmpeg/probe';
import { LocalPhashProvider } from '../services/fingerprint/phash';

// These run real ffmpeg/ffprobe against clips generated on the fly — no mocks.
function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const haveFfmpeg = hasBinary('ffmpeg') && hasBinary('ffprobe');

function makeClip(path: string, source: string, size: string, seconds: number) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `${source}=size=${size}:rate=10`,
      '-t',
      String(seconds),
      '-pix_fmt',
      'yuv420p',
      path,
    ],
    { stdio: 'ignore' }
  );
}

describe('parseProbeOutput', () => {
  it('reads dimensions and container duration', () => {
    const out = JSON.stringify({
      streams: [{ width: 1080, height: 1920 }],
      format: { duration: '12.5' },
    });
    expect(parseProbeOutput(out)).toEqual({ width: 1080, height: 1920, durationSec: 12.5 });
  });
  it('falls back to stream duration, then 0', () => {
    expect(
      parseProbeOutput(JSON.stringify({ streams: [{ width: 2, height: 2, duration: '3' }] }))
        .durationSec
    ).toBe(3);
    expect(
      parseProbeOutput(JSON.stringify({ streams: [{ width: 2, height: 2 }] })).durationSec
    ).toBe(0);
  });
  it('throws when there is no video stream', () => {
    expect(() => parseProbeOutput(JSON.stringify({ streams: [] }))).toThrow('no video stream');
  });
});

describe('probe input validation', () => {
  it('rejects non-https remote inputs (file:, http:)', async () => {
    await expect(probeVideo('file:///etc/passwd')).rejects.toThrow('https');
    await expect(probeVideo('http://example.com/a.mp4')).rejects.toThrow('https');
    await expect(extractFramePng('concat:/etc/passwd', 0)).rejects.toThrow('https');
  });
});

describe.skipIf(!haveFfmpeg)('real ffmpeg', () => {
  let dir: string;
  let testsrc: string;
  let testsrcAgain: string;
  let mandelbrot: string;
  let portrait: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'probe-test-'));
    testsrc = join(dir, 'a.mp4');
    testsrcAgain = join(dir, 'a2.mp4');
    mandelbrot = join(dir, 'b.mp4');
    portrait = join(dir, 'p.mp4');
    makeClip(testsrc, 'testsrc', '320x240', 4);
    makeClip(testsrcAgain, 'testsrc', '320x240', 4);
    makeClip(mandelbrot, 'mandelbrot', '320x240', 4);
    makeClip(portrait, 'testsrc', '240x426', 2);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('probes real dimensions and duration', async () => {
    const p = await probeVideo(testsrc);
    expect(p.width).toBe(320);
    expect(p.height).toBe(240);
    expect(p.durationSec).toBeCloseTo(4, 0);
    const v = await probeVideo(portrait);
    expect([v.width, v.height]).toEqual([240, 426]);
  });

  it('extracts a PNG frame', async () => {
    const png = await extractFramePng(testsrc, 1);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('fingerprints video deterministically as 3 frame hashes', async () => {
    const provider = new LocalPhashProvider();
    const media = (path: string) => ({
      url: 'https://unused.invalid/x.mp4',
      bytes: readFileSync(path),
      mimeType: 'video/mp4',
      kind: 'video' as const,
    });
    const a = await provider.compute(media(testsrc));
    const a2 = await provider.compute(media(testsrcAgain));
    const b = await provider.compute(media(mandelbrot));
    if (!a.configured || !a2.configured || !b.configured) throw new Error('expected configured');
    expect(a.hash).toHaveLength(48);
    expect(a.hash).toBe(a2.hash);
    expect(b.hash).not.toBe(a.hash);
  });
});
