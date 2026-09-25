import { describe, expect, it } from 'vitest';
import { audioMixSchema } from '../routers/episodes/audio-mix.schema';
import { resolveMix } from '../services/ffmpeg/audio-mix';

const clip = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  url: 'https://media.example.com/a.mp3',
  start: 1,
  length: 4,
  ...over,
});
const track = (clips: unknown[], over: Record<string, unknown> = {}) => ({
  id: 't1',
  clips,
  ...over,
});

describe('audioMixSchema', () => {
  it('fills defaults so a minimal payload is a complete, neutral mix', () => {
    const m = audioMixSchema.parse({ tracks: [track([clip()])] });
    expect(m.tracks[0]).toMatchObject({ kind: 'audio', volume: 1, muted: false, solo: false });
    expect(m.tracks[0].clips[0]).toMatchObject({
      trimStart: 0,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      label: '',
    });
    expect(m.mixer).toEqual({ video: { volume: 1, muted: false, solo: false }, master: 1 });
  });

  it('accepts the empty mix (no tracks) and parses into something resolveMix understands', () => {
    const m = audioMixSchema.parse({ tracks: [] });
    expect(resolveMix(m as any).clips).toEqual([]);
  });

  it('rejects out-of-range values instead of clamping silently', () => {
    expect(audioMixSchema.safeParse({ tracks: [track([clip({ volume: 5 })])] }).success).toBe(
      false
    );
    expect(audioMixSchema.safeParse({ tracks: [track([clip({ start: -1 })])] }).success).toBe(
      false
    );
    expect(audioMixSchema.safeParse({ tracks: [track([clip({ length: 0 })])] }).success).toBe(
      false
    );
    expect(audioMixSchema.safeParse({ tracks: [], mixer: { master: 3 } }).success).toBe(false);
  });

  it('rejects non-URLs and unknown track kinds', () => {
    expect(
      audioMixSchema.safeParse({ tracks: [track([clip({ url: 'not a url' })])] }).success
    ).toBe(false);
    expect(audioMixSchema.safeParse({ tracks: [track([], { kind: 'podcast' })] }).success).toBe(
      false
    );
  });

  it('enforces the track, per-track and total clip caps', () => {
    const many = (n: number, over: Record<string, unknown> = {}) =>
      Array.from({ length: n }, (_, i) => track([], { id: `t${i}`, ...over }));
    expect(audioMixSchema.safeParse({ tracks: many(9) }).success).toBe(false);
    expect(audioMixSchema.safeParse({ tracks: many(8) }).success).toBe(true);
    const clips = (n: number) => Array.from({ length: n }, (_, i) => clip({ id: `c${i}` }));
    expect(audioMixSchema.safeParse({ tracks: [track(clips(31))] }).success).toBe(false);
    // 2 tracks × 21 clips = 42 > 40 total
    expect(
      audioMixSchema.safeParse({ tracks: [track(clips(21)), track(clips(21), { id: 't2' })] })
        .success
    ).toBe(false);
    expect(
      audioMixSchema.safeParse({ tracks: [track(clips(20)), track(clips(20), { id: 't2' })] })
        .success
    ).toBe(true);
  });

  it('strips unknown fields', () => {
    const m = audioMixSchema.parse({
      tracks: [track([clip({ evil: 'x' })], { extra: 1 })],
      junk: true,
    });
    expect(m).not.toHaveProperty('junk');
    expect(m.tracks[0]).not.toHaveProperty('extra');
    expect(m.tracks[0].clips[0]).not.toHaveProperty('evil');
  });
});
