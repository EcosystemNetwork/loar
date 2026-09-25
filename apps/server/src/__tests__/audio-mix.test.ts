import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  NEUTRAL_MIX,
  buildMixdownArgs,
  clipFilter,
  isDefaultMix,
  isNeutral,
  resolveMix,
  type MixClip,
  type MixTrack,
  type StoredMix,
} from '../services/ffmpeg/audio-mix';
import { probeVideo } from '../services/ffmpeg/probe';

const clip = (over: Partial<MixClip> = {}): MixClip => ({
  id: 'c1',
  url: 'https://a/x.mp3',
  start: 0,
  trimStart: 0,
  length: 4,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...over,
});
const track = (id: string, clips: MixClip[], over: Partial<MixTrack> = {}): MixTrack => ({
  id,
  volume: 1,
  muted: false,
  solo: false,
  clips,
  ...over,
});
const mix = (tracks: MixTrack[], over: Partial<StoredMix['mixer']> = {}): StoredMix => ({
  tracks,
  mixer: { video: { volume: 1, muted: false, solo: false }, master: 1, ...over },
});

describe("resolveMix (must mirror the web app's lib/audioMix.ts rules)", () => {
  it('is neutral for an empty mix and for an empty track', () => {
    expect(isNeutral(resolveMix(NEUTRAL_MIX))).toBe(true);
    expect(isNeutral(resolveMix(mix([track('t', [])])))).toBe(true);
  });

  it('folds clip × track gain and keeps master separate', () => {
    const r = resolveMix(
      mix([track('t', [clip({ volume: 0.8 })], { volume: 0.5 })], { master: 0.9 })
    );
    expect(r.clips[0].gain).toBeCloseTo(0.4);
    expect(r.masterGain).toBe(0.9);
    expect(isNeutral(r)).toBe(false);
  });

  it('drops muted tracks, silent clips and clips that are too short', () => {
    const r = resolveMix(
      mix([
        track('muted', [clip({ id: 'a' })], { muted: true }),
        track('ok', [
          clip({ id: 'b' }),
          clip({ id: 'z', volume: 0 }),
          clip({ id: 's', length: 0.01 }),
        ]),
      ])
    );
    expect(r.clips.map((c) => c.id)).toEqual(['b']);
  });

  it('solo silences every non-soloed channel, including the video audio', () => {
    const r = resolveMix(
      mix([track('a', [clip({ id: 'a' })]), track('b', [clip({ id: 'b' })], { solo: true })])
    );
    expect(r.clips.map((c) => c.id)).toEqual(['b']);
    expect(r.videoGain).toBe(0);
    const v = resolveMix(
      mix([track('a', [clip({ id: 'a' })])], { video: { volume: 1, muted: false, solo: true } })
    );
    expect(v.clips).toEqual([]);
    expect(v.videoGain).toBe(1);
  });

  it('caps gains at 2 and fades at half the clip', () => {
    const r = resolveMix(
      mix([track('t', [clip({ volume: 9, length: 4, fadeIn: 10, fadeOut: 1 })], { volume: 9 })])
    );
    expect(r.clips[0].gain).toBe(4); // 2 × 2
    expect(r.clips[0]).toMatchObject({ fadeIn: 2, fadeOut: 1 });
  });

  it('a looped clip ignores its in-point', () => {
    expect(
      resolveMix(mix([track('t', [clip({ loop: true, trimStart: 5 })])])).clips[0]
    ).toMatchObject({
      loop: true,
      trimStart: 0,
    });
  });
});

describe('isDefaultMix', () => {
  it('is true only for the untouched default (stored as null)', () => {
    expect(isDefaultMix(NEUTRAL_MIX)).toBe(true);
    expect(isDefaultMix(mix([]))).toBe(true);
    // A track that exists — even an empty or muted one — is user data and must be kept.
    expect(isDefaultMix(mix([track('t', [])]))).toBe(false);
    expect(isDefaultMix(mix([], { master: 0.9 }))).toBe(false);
    expect(isDefaultMix(mix([], { video: { volume: 1, muted: true, solo: false } }))).toBe(false);
  });
});

describe('clipFilter', () => {
  const base = {
    id: 'c',
    url: 'u',
    start: 0,
    trimStart: 0,
    length: 10,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    loop: false,
  };
  it('is just the format normalisation for a plain clip at t=0', () => {
    expect(clipFilter(base)).toBe(
      'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo'
    );
  });
  it('duplicates a mono file to both channels at unity before anything else', () => {
    const f = clipFilter({ ...base, channels: 1 });
    expect(f.split(',')[0]).toBe('pan=stereo|c0=c0|c1=c0');
    expect(f).toContain('aformat=');
    // stereo / unknown keep the plain normalisation
    expect(clipFilter({ ...base, channels: 2 })).toBe(clipFilter(base));
  });

  it('adds level, fades and the timeline delay in that order', () => {
    const f = clipFilter({ ...base, gain: 0.5, fadeIn: 1, fadeOut: 2, start: 1.5 });
    expect(f.split(',').slice(1)).toEqual([
      'volume=0.5',
      'afade=t=in:st=0:d=1',
      'afade=t=out:st=8:d=2',
      'adelay=1500|1500',
    ]);
  });
});

describe('buildMixdownArgs', () => {
  const resolved = (o: Partial<Parameters<typeof buildMixdownArgs>[0]['clips'][number]> = {}) => ({
    id: 'c',
    url: 'u',
    start: 2,
    trimStart: 1,
    length: 4,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    loop: false,
    path: '/tmp/a.mp3',
    ...o,
  });
  const spec = (clips = [resolved()], over = {}) => ({
    inputPath: '/tmp/in.mp4',
    outputPath: '/tmp/out.mp4',
    clips,
    videoGain: 1,
    masterGain: 1,
    ...over,
  });

  it('returns null when nothing would change', () => {
    expect(buildMixdownArgs(spec([]))).toBeNull();
  });

  it('seeks and limits on the input, not with a filter', () => {
    const args = buildMixdownArgs(spec())!;
    const i = args.indexOf('/tmp/a.mp3');
    expect(args.slice(i - 5, i + 1)).toEqual(['-ss', '1', '-t', '4', '-i', '/tmp/a.mp3']);
  });

  it('loops with -stream_loop and no -ss', () => {
    const args = buildMixdownArgs(spec([resolved({ loop: true, trimStart: 0, length: 30 })]))!;
    expect(args).toContain('-stream_loop');
    expect(args).not.toContain('-ss');
  });

  it('mixes all clips under the video audio without normalising, then limits', () => {
    const graph = buildMixdownArgs(
      spec([resolved({ id: 'a' }), resolved({ id: 'b', path: '/tmp/b.mp3' })])
    )![
      buildMixdownArgs(spec([resolved(), resolved({ path: '/tmp/b.mp3' })]))!.indexOf(
        '-filter_complex'
      ) + 1
    ];
    expect(graph).toContain(
      '[base][c0][c1]amix=inputs=3:duration=first:dropout_transition=0:normalize=0'
    );
    expect(graph).toContain('alimiter=limit=0.97:level=0');
    expect(graph).toMatch(/\[a\]$/);
  });

  it('copies the video and re-encodes only the audio', () => {
    const args = buildMixdownArgs(spec())!;
    expect(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2)).toEqual(['-c:v', 'copy']);
    expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2)).toEqual(['-c:a', 'aac']);
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4)).toEqual([
      '-map',
      '0:v:0',
      '-map',
      '[a]',
    ]);
  });

  it('with no clips but a changed level, applies it without an amix', () => {
    const args = buildMixdownArgs(spec([], { videoGain: 0.5, masterGain: 0.8 }))!;
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('volume=0.5');
    expect(graph).toContain('volume=0.8');
    expect(graph).not.toContain('amix');
  });
});

// ── Real ffmpeg: measure where the sound actually ends up ───────────────

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.skipIf(!hasFfmpeg)('mixdown with real ffmpeg', () => {
  let dir: string;
  const video = () => join(dir, 'video.mp4');
  const tone = (n: string) => join(dir, `${n}.wav`);

  // AAC "silence" measures around -91 dB; ffmpeg's sine source is quiet (~-30 dB) even at volume=0.5.
  const SILENT_DB = -80;
  const AUDIBLE_DB = -45;

  /** Mean volume (dB) of [from, to) seconds of a file's audio; about -91 for silence. */
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
    if (!m) throw new Error(`no volumedetect output:\n${r.stderr}`);
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  }

  async function run(
    spec: ReturnType<typeof resolveMix>,
    clips: Array<{ path: string; idx: number }>,
    out: string
  ) {
    const args = buildMixdownArgs({
      inputPath: video(),
      outputPath: out,
      videoGain: spec.videoGain,
      masterGain: spec.masterGain,
      clips: spec.clips.map((c, i) => ({
        ...c,
        path: clips[i].path,
        channels: (clips[i] as any).channels,
      })),
    });
    expect(args).not.toBeNull();
    execFileSync(
      'ffmpeg',
      ['-loglevel', 'error', ...args!.filter((a, i) => !(i === 0 && a === '-y'))],
      { timeout: 60_000 }
    );
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'audio-mix-'));
    // 6 s picture with SILENT audio, so anything we hear came from the mix.
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:r=30:d=6',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t',
      '6',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      video(),
    ]);
    // A 3 s tone that is loud enough to measure.
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-af',
      'volume=0.5',
      tone('a'),
    ]);
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:duration=3',
      '-af',
      'volume=0.5',
      tone('b'),
    ]);
  });
  afterAll(() => existsSync(dir) && rmSync(dir, { recursive: true, force: true }));

  it('places a clip at its timeline position and leaves the rest silent; keeps the picture length', async () => {
    const out = join(dir, 'placed.mp4');
    const m = mix([track('t', [clip({ start: 2, length: 2, trimStart: 0 })])]);
    await run(resolveMix(m), [{ path: tone('a'), idx: 0 }], out);
    expect(meanDb(out, 0, 1.5)).toBeLessThan(SILENT_DB); // before the clip
    expect(meanDb(out, 2.2, 3.8)).toBeGreaterThan(AUDIBLE_DB); // during
    expect(meanDb(out, 4.3, 5.9)).toBeLessThan(SILENT_DB); // after
    const probe = await probeVideo(out);
    expect(probe.durationSec).toBeCloseTo(6, 0);
  });

  it("a mono source is duplicated at unity (preview parity), not attenuated 3 dB by ffmpeg's upmix", async () => {
    // The reference is what a browser plays for a mono file: the same signal in both channels.
    const dual = join(dir, 'dual.wav');
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      tone('a'),
      '-af',
      'pan=stereo|c0=c0|c1=c0',
      dual,
    ]);
    const m = resolveMix(mix([track('t', [clip({ start: 0, length: 3 })])]));
    const reference = join(dir, 'ref.mp4');
    const mono = join(dir, 'mono.mp4');
    const legacy = join(dir, 'monoLegacy.mp4');
    await run(m, [{ path: dual, idx: 0, channels: 2 } as any], reference);
    await run(m, [{ path: tone('a'), idx: 0, channels: 1 } as any], mono);
    await run(m, [{ path: tone('a'), idx: 0 } as any], legacy); // channels unknown → ffmpeg's default upmix
    expect(Math.abs(meanDb(mono, 0.5, 2.5) - meanDb(reference, 0.5, 2.5))).toBeLessThan(0.5);
    // …and the default upmix really is the ~3 dB-quieter behaviour this fixes.
    expect(meanDb(reference, 0.5, 2.5) - meanDb(legacy, 0.5, 2.5)).toBeGreaterThan(2);
  });

  it('applies gains: half the track fader is about 6 dB quieter', async () => {
    const loud = join(dir, 'loud.mp4');
    const quiet = join(dir, 'quiet.mp4');
    await run(
      resolveMix(mix([track('t', [clip({ start: 0, length: 3 })])])),
      [{ path: tone('a'), idx: 0 }],
      loud
    );
    await run(
      resolveMix(mix([track('t', [clip({ start: 0, length: 3 })], { volume: 0.5 })])),
      [{ path: tone('a'), idx: 0 }],
      quiet
    );
    const delta = meanDb(loud, 0.5, 2.5) - meanDb(quiet, 0.5, 2.5);
    expect(delta).toBeGreaterThan(5);
    expect(delta).toBeLessThan(7);
  });

  it('sums overlapping tracks instead of averaging them', async () => {
    const one = join(dir, 'one.mp4');
    const two = join(dir, 'two.mp4');
    await run(
      resolveMix(mix([track('a', [clip({ start: 0, length: 3 })])])),
      [{ path: tone('a'), idx: 0 }],
      one
    );
    await run(
      resolveMix(
        mix([
          track('a', [clip({ id: 'a', start: 0, length: 3 })]),
          track('b', [clip({ id: 'b', start: 0, length: 3 })]),
        ])
      ),
      [
        { path: tone('a'), idx: 0 },
        { path: tone('b'), idx: 1 },
      ],
      two
    );
    // Two equal-level, uncorrelated tones sum to ~+3 dB; a normalising amix would be ~-3 dB.
    expect(meanDb(two, 0.5, 2.5)).toBeGreaterThan(meanDb(one, 0.5, 2.5) + 1);
  });

  it('fades: the first quarter second of a 1 s fade-in is much quieter than full level', async () => {
    const out = join(dir, 'fade.mp4');
    await run(
      resolveMix(mix([track('t', [clip({ start: 0, length: 3, fadeIn: 1, fadeOut: 1 })])])),
      [{ path: tone('a'), idx: 0 }],
      out
    );
    expect(meanDb(out, 0, 0.25)).toBeLessThan(meanDb(out, 1.2, 1.8) - 8);
    expect(meanDb(out, 2.75, 3)).toBeLessThan(meanDb(out, 1.2, 1.8) - 8);
  });

  it('loops a short file to fill the clip length', async () => {
    const short = join(dir, 'short.wav');
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-af',
      'volume=0.5',
      short,
    ]);
    const out = join(dir, 'loop.mp4');
    await run(
      resolveMix(mix([track('t', [clip({ start: 0, length: 5, loop: true })])])),
      [{ path: short, idx: 0 }],
      out
    );
    expect(meanDb(out, 3.2, 4.8)).toBeGreaterThan(AUDIBLE_DB); // well past the 1 s source
  });

  it('muting the video channel removes the picture audio but keeps the tracks', async () => {
    // A video WITH audible audio.
    const loudVideo = join(dir, 'loudvideo.mp4');
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:r=30:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=4',
      '-af',
      'volume=0.5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      loudVideo,
    ]);
    const out = join(dir, 'vmuted.mp4');
    const r = resolveMix(
      mix([track('t', [clip({ start: 2, length: 1 })])], {
        video: { volume: 1, muted: true, solo: false },
      })
    );
    const args = buildMixdownArgs({
      inputPath: loudVideo,
      outputPath: out,
      videoGain: r.videoGain,
      masterGain: r.masterGain,
      clips: r.clips.map((c) => ({ ...c, path: tone('a') })),
    })!;
    execFileSync('ffmpeg', ['-loglevel', 'error', ...args.slice(1)], { timeout: 60_000 });
    expect(meanDb(out, 0, 1.5)).toBeLessThan(SILENT_DB); // picture audio gone
    expect(meanDb(out, 2.1, 2.9)).toBeGreaterThan(AUDIBLE_DB); // track still there
  });
});
