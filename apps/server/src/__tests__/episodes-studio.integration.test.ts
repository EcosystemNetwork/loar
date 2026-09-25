/**
 * Episode Studio server paths against a REAL Firestore emulator and REAL
 * ffmpeg: episodes.update / versions / export, end to end through the router.
 *
 * Needs `firebase emulators:start --only firestore --project loar-db` and
 * ffmpeg; skips itself when either is missing.
 */
import './_real-firebase';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';

// Downloads are SSRF-guarded (localhost blocked): serve fixtures from disk.
const served = new Map<string, string>();
vi.mock('../lib/url-validator', () => ({
  safeFetch: async (url: string) => {
    const file = served.get(url);
    if (!file) return new Response('nope', { status: 404 });
    return new Response(new Uint8Array(readFileSync(file)), { status: 200 });
  },
  validateUploadUrl: async () => {},
}));
const uploaded: Array<{ buffer: Buffer; name: string }> = [];
vi.mock('../services/firebase-storage', () => ({
  firebaseStorageService: {
    upload: async (buffer: Buffer, name: string) => {
      uploaded.push({ buffer, name });
      return name;
    },
    getPublicUrl: (key: string) => `https://cdn.test/${key}`,
  },
}));

import { createAuthCaller } from './helpers';
import { db } from '../lib/firebase';
import { probeHasAudio, probeVideo } from '../services/ffmpeg/probe';

const emulatorUp = await new Promise<boolean>((resolve) => {
  const s = net.connect(8080, '127.0.0.1');
  s.once('connect', () => (s.destroy(), resolve(true)));
  s.once('error', () => resolve(false));
});
const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const FONT = existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');

const creator = () => createAuthCaller({ uid: 'studio-creator', address: '0xaaaa' });
const stranger = () => createAuthCaller({ uid: 'studio-stranger', address: '0xbbbb' });

const clip = (over: Record<string, unknown> = {}) => ({
  nodeId: 'a',
  label: 'A',
  videoUrl: 'https://media.test/a.mp4',
  trimStart: 0,
  trimEnd: 0,
  ...over,
});
const settings = { aspect: '16:9', resolution: '720p', framing: 'fit' } as const;

async function newEpisode(clips = [clip()]) {
  const { id } = await creator().episodes.create({ universeId: 'u1', title: 'Pilot', clips });
  return id;
}
const versionDocs = (id: string) => db!.collection('episodes').doc(id).collection('versions');

describe.skipIf(!emulatorUp)('episodes.update / versions (Firestore emulator)', () => {
  it('stores overlays, soundtrack, settings and per-clip audio, and returns them', async () => {
    const id = await newEpisode();
    await creator().episodes.update({
      episodeId: id,
      clips: [clip({ volume: 0.5, fadeIn: 1, fadeOut: 2 })],
      overlays: [{ id: 'o1', text: 'Hello', start: 1, end: 3, position: 'top', size: 'lg' }],
      soundtrack: { url: 'https://media.test/bed.mp3', volume: 0.3 },
      exportSettings: { aspect: '9:16', resolution: '1080p', framing: 'fill' },
    });
    const ep: any = await creator().episodes.get({ episodeId: id });
    expect(ep.clips[0]).toMatchObject({ volume: 0.5, fadeIn: 1, fadeOut: 2 });
    expect(ep.overlays[0]).toMatchObject({ text: 'Hello', position: 'top', size: 'lg' });
    expect(ep.soundtrack).toMatchObject({ volume: 0.3 });
    expect(ep.exportSettings).toEqual({ aspect: '9:16', resolution: '1080p', framing: 'fill' });
  });

  it('rejects malformed studio input', async () => {
    const id = await newEpisode();
    const bad = (input: Record<string, unknown>) =>
      creator().episodes.update({ episodeId: id, ...input } as any);
    await expect(
      bad({ overlays: [{ id: 'o', text: 'x', start: 3, end: 3, position: 'top', size: 'md' }] })
    ).rejects.toThrow();
    await expect(bad({ clips: [clip({ volume: 3 })] })).rejects.toThrow();
    await expect(bad({ clips: [clip({ fadeIn: -1 })] })).rejects.toThrow();
    await expect(bad({ soundtrack: { url: 'not a url', volume: 0.5 } })).rejects.toThrow();
    await expect(bad({ exportSettings: { ...settings, aspect: '4:3' } })).rejects.toThrow();
  });

  it('only the creator can update or read history', async () => {
    const id = await newEpisode();
    await expect(
      stranger().episodes.update({ episodeId: id, title: 'Mine' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(stranger().episodes.listVersions({ episodeId: id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      stranger().episodes.getVersion({ episodeId: id, versionId: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps a finished export unless something it renders actually changed', async () => {
    const id = await newEpisode();
    const ref = db!.collection('episodes').doc(id);
    const stamp = async () => ref.update({ exportUrl: 'https://cdn.test/old.mp4' });
    const url = async () => (await ref.get()).data()!.exportUrl;

    await stamp();
    await creator().episodes.update({ episodeId: id, title: 'Renamed', description: 'new words' });
    expect(await url()).toBe('https://cdn.test/old.mp4'); // metadata isn't rendered

    await creator().episodes.update({ episodeId: id, clips: [clip()] }); // identical cut
    expect(await url()).toBe('https://cdn.test/old.mp4');

    await creator().episodes.update({ episodeId: id, clips: [clip({ volume: 0.5 })] });
    expect(await url()).toBeNull(); // audible change → stale

    await stamp();
    await creator().episodes.update({
      episodeId: id,
      overlays: [{ id: 'o', text: 'x', start: 0, end: 2, position: 'top', size: 'sm' }],
    });
    expect(await url()).toBeNull();

    await stamp();
    await creator().episodes.update({
      episodeId: id,
      exportSettings: { ...settings, aspect: '1:1' },
    });
    expect(await url()).toBeNull();

    await stamp();
    await creator().episodes.update({ episodeId: id, soundtrack: null }); // already null
    expect(await url()).toBe('https://cdn.test/old.mp4');
  });

  it('records restore points per the rules, newest first, and returns full content', async () => {
    const id = await newEpisode();
    const up = (input: Record<string, unknown>) =>
      creator().episodes.update({ episodeId: id, ...input } as any);

    await up({ title: 'v1', clips: [clip()], versionKind: 'manual' });
    await up({ title: 'v1', clips: [clip()], versionKind: 'manual' }); // identical → no dup
    await up({ title: 'v2', clips: [clip({ volume: 0.5 })], versionKind: 'auto' }); // within 10 min → skipped
    await up({ title: 'v3', clips: [clip({ volume: 0.7 })], versionKind: 'manual' });
    await up({ title: 'no snapshot requested', clips: [clip({ volume: 0.9 })] });

    const list = await creator().episodes.listVersions({ episodeId: id });
    expect(list.map((v) => v.title)).toEqual(['v3', 'v1']);
    expect(list.map((v) => v.kind)).toEqual(['manual', 'manual']);
    expect(list[0].clipCount).toBe(1);

    const full = await creator().episodes.getVersion({ episodeId: id, versionId: list[1].id });
    expect(full.title).toBe('v1');
    expect(full.clips[0].volume).toBeUndefined();
    await expect(
      creator().episodes.getVersion({ episodeId: id, versionId: 'missing' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps only the newest 30 restore points', async () => {
    const id = await newEpisode();
    for (let i = 0; i < 33; i++) {
      await creator().episodes.update({
        episodeId: id,
        title: `t${i}`,
        clips: [clip({ volume: i / 40 })],
        versionKind: 'manual',
      });
    }
    const snap = await versionDocs(id).get();
    expect(snap.size).toBe(30);
    const titles = (await creator().episodes.listVersions({ episodeId: id })).map((v) => v.title);
    expect(titles[0]).toBe('t32');
    expect(titles).not.toContain('t0');
  }, 60_000);
});

describe.skipIf(!emulatorUp || !haveFfmpeg || !FONT)(
  'episodes.export (emulator + real ffmpeg)',
  () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'studio-export-'));
      const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
      ff([
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
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=360x640:rate=25',
        '-t',
        '2',
        '-pix_fmt',
        'yuv420p',
        join(dir, 'b.mp4'),
      ]);
      ff(['-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '1', join(dir, 'bed.mp3')]);
      served.set('https://media.test/a.mp4', join(dir, 'a.mp4'));
      served.set('https://media.test/b.mp4', join(dir, 'b.mp4'));
      served.set('https://media.test/bed.mp3', join(dir, 'bed.mp3'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    async function runExport(id: string) {
      const { jobId } = await creator().episodes.export({ episodeId: id });
      for (let i = 0; i < 120; i++) {
        const s = await creator().episodes.exportStatus({ jobId });
        if (s.status === 'completed' || s.status === 'failed') return s;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('export timed out');
    }

    it('renders a 9:16 episode with fades, a caption and a soundtrack through the real route', async () => {
      const id = await newEpisode([
        clip({ trimStart: 0.5, volume: 0.8, fadeIn: 0.5, fadeOut: 0.5 }), // 2.5s
        clip({ nodeId: 'b', label: 'B', videoUrl: 'https://media.test/b.mp4' }), // 2s, silent, vertical
      ]);
      await creator().episodes.update({
        episodeId: id,
        overlays: [
          {
            id: 'o',
            text: 'Chapter one: a caption long enough to wrap',
            start: 0.5,
            end: 3,
            position: 'bottom',
            size: 'md',
          },
        ],
        soundtrack: { url: 'https://media.test/bed.mp3', volume: 0.4 },
        exportSettings: { aspect: '9:16', resolution: '720p', framing: 'fill' },
      });

      const before = uploaded.length;
      const status = await runExport(id);
      expect(status.error).toBeUndefined();
      expect(status.status).toBe('completed');
      expect(status.warnings).toEqual([]);
      expect(status.outputUrl).toMatch(/^https:\/\/cdn\.test\/episode-/);

      const out = join(dir, 'exported.mp4');
      writeFileSync(out, uploaded[before].buffer);
      const p = await probeVideo(out);
      expect([p.width, p.height]).toEqual([720, 1280]);
      expect(await probeHasAudio(out)).toBe(true);
      expect(p.durationSec).toBeGreaterThan(4.2);
      expect(p.durationSec).toBeLessThan(5.2);

      const ep: any = await creator().episodes.get({ episodeId: id });
      expect(ep.exportUrl).toBe(status.outputUrl);
    }, 90_000);

    it('a plain episode still exports on the fast path at the default size', async () => {
      const id = await newEpisode([
        clip(),
        clip({ nodeId: 'b', videoUrl: 'https://media.test/b.mp4' }),
      ]);
      const before = uploaded.length;
      const status = await runExport(id);
      expect(status.status).toBe('completed');
      const out = join(dir, 'plain.mp4');
      writeFileSync(out, uploaded[before].buffer);
      const p = await probeVideo(out);
      expect([p.width, p.height]).toEqual([1280, 720]);
      expect(await probeHasAudio(out)).toBe(true); // silent clip was padded, not dropped
    }, 90_000);

    it('reports a skipped soundtrack as a warning instead of failing the export', async () => {
      const id = await newEpisode();
      await creator().episodes.update({
        episodeId: id,
        soundtrack: { url: 'https://media.test/does-not-exist.mp3', volume: 0.5 },
      });
      const status = await runExport(id);
      expect(status.status).toBe('completed');
      expect(status.warnings.join(' ')).toMatch(/soundtrack was skipped/i);
    }, 90_000);

    it('an export job belongs to its creator', async () => {
      const id = await newEpisode();
      const { jobId } = await creator().episodes.export({ episodeId: id });
      await expect(stranger().episodes.exportStatus({ jobId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(stranger().episodes.export({ episodeId: id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      // let the background render finish before the test tears down its fixtures
      for (let i = 0; i < 60; i++) {
        const s = await creator().episodes.exportStatus({ jobId });
        if (s.status === 'completed' || s.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }, 90_000);
  }
);
