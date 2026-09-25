import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  audioFilter,
  buildClipArgs,
  buildFinalizeArgs,
  clipLengthSec,
  drawtextFilter,
  escapeFilterValue,
  exportTarget,
  overlayText,
  videoFilter,
  wrapText,
  type TextOverlay,
} from '../services/ffmpeg/episode-render';
import { probeHasAudio, probeVideo } from '../services/ffmpeg/probe';

const target = exportTarget();
const overlay: TextOverlay = {
  id: 'o1',
  text: 'Hello',
  start: 1,
  end: 2.5,
  position: 'bottom',
  size: 'md',
};

describe('exportTarget', () => {
  it('maps every aspect/resolution to even dimensions', () => {
    expect(exportTarget()).toEqual({ width: 1280, height: 720, framing: 'fit' });
    expect(exportTarget({ resolution: '1080p' })).toMatchObject({ width: 1920, height: 1080 });
    expect(exportTarget({ aspect: '9:16' })).toMatchObject({ width: 720, height: 1280 });
    expect(exportTarget({ aspect: '9:16', resolution: '1080p' })).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(exportTarget({ aspect: '1:1', framing: 'fill' })).toEqual({
      width: 720,
      height: 720,
      framing: 'fill',
    });
  });
});

describe('clip filters', () => {
  it('letterboxes for fit and crops for fill', () => {
    expect(videoFilter(target, { lengthSec: 4, fadeIn: 0, fadeOut: 0 })).toContain('pad=1280:720');
    expect(
      videoFilter({ ...target, framing: 'fill' }, { lengthSec: 4, fadeIn: 0, fadeOut: 0 })
    ).toContain('crop=1280:720');
  });

  it('places the fade-out at the tail of the clip', () => {
    const vf = videoFilter(target, { lengthSec: 4, fadeIn: 0.5, fadeOut: 1 });
    expect(vf).toContain('fade=t=in:st=0:d=0.5');
    expect(vf).toContain('fade=t=out:st=3:d=1');
    expect(audioFilter(1, { lengthSec: 4, fadeIn: 0, fadeOut: 1 })).toBe('afade=t=out:st=3:d=1');
  });

  it('emits no audio filter for an untouched clip', () => {
    expect(audioFilter(1, { lengthSec: 4, fadeIn: 0, fadeOut: 0 })).toBeNull();
    expect(audioFilter(0.5, { lengthSec: 4, fadeIn: 0, fadeOut: 0 })).toBe('volume=0.5');
  });

  it('measures the trimmed length', () => {
    expect(clipLengthSec({ trimStart: 1, trimEnd: 3, sourceDurationSec: 10 })).toBe(2);
    expect(clipLengthSec({ trimStart: 2, trimEnd: 0, sourceDurationSec: 10 })).toBe(8);
    expect(clipLengthSec({ trimStart: 2, trimEnd: 0, sourceDurationSec: 0 })).toBe(0);
  });
});

describe('buildClipArgs', () => {
  const base = {
    clipPath: '/w/c.mp4',
    hasAudio: true,
    trimStart: 0,
    trimEnd: 0,
    sourceDurationSec: 6,
    target,
    outputPath: '/w/o.mp4',
  };

  it('uses the clip’s own audio when there is no overlay', () => {
    const args = buildClipArgs(base);
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4)).toEqual([
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
    ]);
    expect(args).not.toContain('-ss');
  });

  it('generates silence for a clip with no audio track', () => {
    const args = buildClipArgs({ ...base, hasAudio: false });
    expect(args.join(' ')).toContain('anullsrc');
    expect(args).toContain('1:a:0');
  });

  it('prefers the audio overlay and passes the trim window through', () => {
    const args = buildClipArgs({ ...base, audioPath: '/w/a.mp3', trimStart: 1, trimEnd: 4 });
    expect(args).toContain('/w/a.mp3');
    expect(args[args.indexOf('-ss') + 1]).toBe('1');
    expect(args[args.indexOf('-to') + 1]).toBe('4');
    expect(args).toContain('1:a:0');
  });

  it('caps a fade at half the clip so in and out cannot overlap', () => {
    const args = buildClipArgs({ ...base, trimStart: 0, trimEnd: 2, fadeIn: 5, fadeOut: 5 });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('fade=t=in:st=0:d=1');
    expect(vf).toContain('fade=t=out:st=1:d=1');
  });
});

describe('text overlays', () => {
  it('wraps long captions and keeps explicit line breaks', () => {
    expect(wrapText('one two three four', 9)).toBe('one two\nthree\nfour');
    expect(wrapText('a\nb', 40)).toBe('a\nb');
  });

  it('escapes filtergraph-significant characters', () => {
    expect(escapeFilterValue("a:b'c\\d")).toBe("a\\:b\\'c\\\\d");
  });

  it('builds a timed drawtext filter from a text file, never inline text', () => {
    const f = drawtextFilter(overlay, target, '/w/o.txt', '/f.ttf');
    expect(f).toContain('textfile=/w/o.txt');
    expect(f).not.toContain('text=Hello');
    expect(f).toContain("enable='between(t,1,2.5)'");
    expect(f).toContain('y=h-text_h-');
  });

  it('sizes and wraps for the frame', () => {
    const narrow = exportTarget({ aspect: '9:16' });
    const long = 'word '.repeat(30).trim();
    const lines = overlayText({ ...overlay, text: long }, narrow).split('\n');
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('buildFinalizeArgs', () => {
  const spec = {
    inputPath: '/w/in.mp4',
    outputPath: '/w/out.mp4',
    target,
    overlays: [] as TextOverlay[],
    overlayTextFiles: [] as string[],
    fontFile: '/f.ttf' as string | null,
  };

  it('is a no-op with nothing to add', () => {
    expect(buildFinalizeArgs(spec)).toBeNull();
  });

  it('skips overlays when there is no font, without failing', () => {
    expect(
      buildFinalizeArgs({
        ...spec,
        overlays: [overlay],
        overlayTextFiles: ['/w/o.txt'],
        fontFile: null,
      })
    ).toBeNull();
  });

  it('copies video when only a soundtrack is mixed', () => {
    const args = buildFinalizeArgs({ ...spec, soundtrackPath: '/w/s.mp3', soundtrackVolume: 0.3 })!;
    expect(args.join(' ')).toContain('-c:v copy');
    expect(args.join(' ')).toContain('volume=0.3');
    expect(args.join(' ')).toContain('normalize=0');
    expect(args).toContain('-stream_loop');
  });

  it('re-encodes video and copies audio when only captions are burned in', () => {
    const args = buildFinalizeArgs({
      ...spec,
      overlays: [overlay],
      overlayTextFiles: ['/w/o.txt'],
    })!;
    expect(args.join(' ')).toContain('-c:v libx264');
    expect(args.join(' ')).toContain('-c:a copy');
  });
});

// ── Real ffmpeg ─────────────────────────────────────────────────────────

function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const haveFfmpeg = hasBinary('ffmpeg') && hasBinary('ffprobe');
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find((f) => existsSync(f));

const run = (args: string[]) =>
  execFileSync('ffmpeg', ['-v', 'error', ...args], { stdio: 'ignore' });

describe.skipIf(!haveFfmpeg)('render pipeline against real ffmpeg', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'episode-render-'));
    // 3s 640x360 clip with a tone, and a 2s vertical clip with no audio at all.
    run([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '3',
      '-pix_fmt',
      'yuv420p',
      '-shortest',
      join(dir, 'a.mp4'),
    ]);
    run([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=360x640:rate=25',
      '-t',
      '2',
      '-pix_fmt',
      'yuv420p',
      join(dir, 'b.mp4'),
    ]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '1', join(dir, 'bed.mp3')]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function normalize(name: string, extra: Record<string, unknown> = {}) {
    const clipPath = join(dir, `${name}.mp4`);
    const out = join(dir, `${name}.norm.mp4`);
    const probe = await probeVideo(clipPath);
    const args = buildClipArgs({
      clipPath,
      hasAudio: await probeHasAudio(clipPath),
      trimStart: 0,
      trimEnd: 0,
      sourceDurationSec: probe.durationSec,
      target,
      outputPath: out,
      ...extra,
    });
    run(args);
    return out;
  }

  it('normalizes a silent vertical clip to the frame size with audio present', async () => {
    const out = await normalize('b');
    const p = await probeVideo(out);
    expect([p.width, p.height]).toEqual([1280, 720]);
    expect(await probeHasAudio(out)).toBe(true);
    expect(p.durationSec).toBeGreaterThan(1.8);
    expect(p.durationSec).toBeLessThan(2.3);
  });

  it('honours a trim window and a fade', async () => {
    const out = await normalize('a', { trimStart: 1, trimEnd: 2.5, fadeOut: 0.5 });
    const p = await probeVideo(out);
    expect(p.durationSec).toBeGreaterThan(1.3);
    expect(p.durationSec).toBeLessThan(1.8);
  });

  it('renders a 9:16 export and joins mixed silent/voiced clips', async () => {
    const vertical = exportTarget({ aspect: '9:16', framing: 'fill' });
    const a = join(dir, 'a.v.mp4');
    const b = join(dir, 'b.v.mp4');
    for (const [name, out] of [
      ['a', a],
      ['b', b],
    ] as const) {
      const clipPath = join(dir, `${name}.mp4`);
      run(
        buildClipArgs({
          clipPath,
          hasAudio: await probeHasAudio(clipPath),
          trimStart: 0,
          trimEnd: 0,
          sourceDurationSec: 3,
          target: vertical,
          outputPath: out,
        })
      );
    }
    const list = join(dir, 'list.txt');
    writeFileSync(list, `file '${a}'\nfile '${b}'`);
    const joined = join(dir, 'joined.mp4');
    run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    const p = await probeVideo(joined);
    expect([p.width, p.height]).toEqual([720, 1280]);
    expect(await probeHasAudio(joined)).toBe(true);
    expect(p.durationSec).toBeGreaterThan(4.5);

    // Soundtrack (looped from a 1s bed) + a caption, in one finalize pass.
    const textFile = join(dir, 'o.txt');
    writeFileSync(textFile, 'Hello world');
    const out = join(dir, 'final.mp4');
    const args = buildFinalizeArgs({
      inputPath: joined,
      outputPath: out,
      target: vertical,
      overlays: FONT ? [overlay] : [],
      overlayTextFiles: FONT ? [textFile] : [],
      fontFile: FONT ?? null,
      soundtrackPath: join(dir, 'bed.mp3'),
      soundtrackVolume: 0.4,
    })!;
    run(args);
    const fp = await probeVideo(out);
    expect([fp.width, fp.height]).toEqual([720, 1280]);
    expect(await probeHasAudio(out)).toBe(true);
    // -shortest against a looped bed must still end with the video, not run forever.
    expect(fp.durationSec).toBeGreaterThan(4.5);
    expect(fp.durationSec).toBeLessThan(5.6);
  }, 60_000);
});
