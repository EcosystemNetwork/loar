import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Downloads are SSRF-guarded (localhost is blocked), so serve fixtures from disk instead.
const served = new Map<string, string>();
vi.mock('../lib/url-validator', () => ({
  safeFetch: async (url: string) => {
    const file = served.get(url);
    if (!file) return new Response('nope', { status: 404 });
    return new Response(new Uint8Array(readFileSync(file)), { status: 200 });
  },
}));

import { finalizeEpisode } from '../services/ffmpeg/clip-pipeline';
import { exportTarget } from '../services/ffmpeg/episode-render';
import type { StoredMix } from '../services/ffmpeg/audio-mix';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const SILENT_DB = -80;
const AUDIBLE_DB = -45;

const clip = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  url: 'https://media.test/tone.wav',
  label: 'Tone',
  start: 1,
  trimStart: 0,
  length: 2,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...over,
});
const mix = (clips: any[], over: Partial<StoredMix['mixer']> = {}): StoredMix => ({
  tracks: [{ id: 't', volume: 1, muted: false, solo: false, clips }],
  mixer: { video: { volume: 1, muted: false, solo: false }, master: 1, ...over },
});

describe.skipIf(!hasFfmpeg)('finalizeEpisode with a multi-track mix', () => {
  let dir: string;
  let work: string;
  const video = () => join(dir, 'video.mp4');
  const run = (m: StoredMix | null) =>
    finalizeEpisode(video(), join(work, 'final.mp4'), work, { target: exportTarget(), mix: m });

  function meanDb(file: string, from: number, to: number): number {
    const r = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        file,
        '-af',
        `atrim=start=${from}:end=${to},volumedetect`,
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' }
    );
    const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
    if (!m) throw new Error(r.stderr);
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'finalize-mix-'));
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:r=30:d=5',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      video(),
    ]);
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-af',
      'volume=4',
      join(dir, 'tone.wav'),
    ]);
    // A file that decodes but has NO audio stream (video only).
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=64x64:r=10:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      join(dir, 'silentvideo.mp4'),
    ]);
    served.set('https://media.test/tone.wav', join(dir, 'tone.wav'));
    served.set('https://media.test/silentvideo.mp4', join(dir, 'silentvideo.mp4'));
  });
  beforeEach(() => {
    work = join(dir, `w-${Math.random().toString(36).slice(2)}`);
    mkdirSync(work);
  });
  afterAll(() => existsSync(dir) && rmSync(dir, { recursive: true, force: true }));

  it('a neutral or missing mix is a no-op: the input file comes back untouched', async () => {
    expect((await run(null)).path).toBe(video());
    expect(
      (
        await run({
          tracks: [],
          mixer: { video: { volume: 1, muted: false, solo: false }, master: 1 },
        })
      ).path
    ).toBe(video());
  });

  it('downloads, mixes and returns a new file with the tone placed at 1–3 s', async () => {
    const r = await run(mix([clip()]));
    expect(r.path).not.toBe(video());
    expect(r.warnings).toEqual([]);
    expect(meanDb(r.path, 0, 0.8)).toBeLessThan(SILENT_DB);
    expect(meanDb(r.path, 1.2, 2.8)).toBeGreaterThan(AUDIBLE_DB);
    expect(meanDb(r.path, 3.3, 4.8)).toBeLessThan(SILENT_DB);
  });

  it('fetches one URL once even when several clips use it', async () => {
    const r = await run(
      mix([clip({ id: 'a', start: 0, length: 1 }), clip({ id: 'b', start: 3, length: 1 })])
    );
    expect(r.warnings).toEqual([]);
    expect(meanDb(r.path, 0.2, 0.8)).toBeGreaterThan(AUDIBLE_DB);
    expect(meanDb(r.path, 1.5, 2.5)).toBeLessThan(SILENT_DB);
    expect(meanDb(r.path, 3.2, 3.8)).toBeGreaterThan(AUDIBLE_DB);
  });

  it('skips an unreachable clip with a warning but still mixes the rest', async () => {
    const r = await run(
      mix([
        clip({ id: 'ok' }),
        clip({ id: 'gone', label: 'Missing song', url: 'https://media.test/404.mp3', start: 0 }),
      ])
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Missing song.*skipped.*HTTP 404/);
    expect(meanDb(r.path, 1.2, 2.8)).toBeGreaterThan(AUDIBLE_DB);
  });

  it('skips a file with no audio track, with a clear warning', async () => {
    const r = await run(
      mix([clip({ id: 'v', label: 'Silent video', url: 'https://media.test/silentvideo.mp4' })])
    );
    expect(r.warnings[0]).toMatch(/Silent video.*no audio track/);
    expect(existsSync(r.path)).toBe(true);
  });

  it('a level change alone (no clips) still renders a new file', async () => {
    const r = await run({
      tracks: [],
      mixer: { video: { volume: 1, muted: false, solo: false }, master: 0.5 },
    });
    expect(r.path).not.toBe(video());
  });

  it('muted / soloed-away tracks are never downloaded or mixed', async () => {
    const m = mix([clip()]);
    m.tracks[0].muted = true;
    const r = await run(m);
    expect(r.warnings).toEqual([]);
    expect(r.path).toBe(video()); // nothing audible, video gain 1, master 1 → neutral
  });
});
