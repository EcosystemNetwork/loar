import { describe, expect, it } from 'vitest';
import { MixEngine, SCHEDULE_LEAD_SEC } from '../mixEngine';
import {
  EMPTY_MIX,
  addClip,
  newTrack,
  patchClip,
  patchTrack,
  patchVideoChannel,
  setMaster,
  type AudioMix,
} from '../audioMix';

/** Records everything the engine asks Web Audio to do. */
function fakeContext() {
  const gains: any[] = [];
  const sources: Array<{
    buffer: { duration: number };
    loop: boolean;
    startArgs: number[] | null;
    stopped: boolean;
    gainNode: { sets: Array<[number, number]>; ramps: Array<[number, number]> };
  }> = [];
  const param = () => ({ value: 1 });
  const ctx = {
    currentTime: 10,
    destination: {},
    createGain() {
      const sets: Array<[number, number]> = [];
      const ramps: Array<[number, number]> = [];
      const node = {
        gain: {
          value: 1,
          setValueAtTime: (v: number, t: number) => sets.push([v, t]),
          linearRampToValueAtTime: (v: number, t: number) => ramps.push([v, t]),
        },
        connect: () => {},
        disconnect: () => {},
        _sets: sets,
        _ramps: ramps,
      };
      gains.push(node);
      return node;
    },
    createDynamicsCompressor: () => ({
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
      connect: () => {},
      disconnect: () => {},
    }),
    createBufferSource() {
      let connectedTo: any = null;
      const src: any = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        startArgs: null as number[] | null,
        stopped: false,
        connect: (n: any) => {
          connectedTo = n;
        },
        disconnect: () => {},
        start: (...a: number[]) => {
          src.startArgs = a;
        },
        stop: () => {
          src.stopped = true;
        },
        get gainNode() {
          return { sets: connectedTo?._sets ?? [], ramps: connectedTo?._ramps ?? [] };
        },
      };
      sources.push(src);
      return src;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources, gains, raw: ctx };
}

const buf = (duration: number) => ({ duration }) as AudioBuffer;
const LEAD = SCHEDULE_LEAD_SEC;

function twoTrackMix(): {
  mix: AudioMix;
  ids: { music: string; voice: string; m: string; v: string };
} {
  let mix = newTrack(newTrack(EMPTY_MIX, 'music'), 'voice');
  const [music, voice] = mix.tracks.map((t) => t.id);
  const a = addClip(mix, music, { url: 'music', label: 'M', start: 2, length: 10, trimStart: 1 });
  const b = addClip(a.mix, voice, { url: 'voice', label: 'V', start: 5, length: 3 });
  return { mix: b.mix, ids: { music, voice, m: a.clipId!, v: b.clipId! } };
}
const lookup = (m: Record<string, number>) => (url: string) => (url in m ? buf(m[url]) : undefined);

describe('MixEngine scheduling', () => {
  it('starts each clip at its timeline position, with its in-point and length', () => {
    const { ctx, sources } = fakeContext();
    const { mix } = twoTrackMix();
    new MixEngine(ctx, lookup({ music: 30, voice: 8 })).play(mix, 0);

    // music: start 2 → 2s after play begins, offset = trimStart 1, plays 10 s
    expect(sources[0].startArgs).toEqual([10 + LEAD + 2, 1, 10]);
    // voice: start 5, no in-point, 3 s
    expect(sources[1].startArgs).toEqual([10 + LEAD + 5, 0, 3]);
  });

  it('starting mid-timeline: clips already underway resume at the right offset', () => {
    const { ctx, sources } = fakeContext();
    const { mix } = twoTrackMix();
    new MixEngine(ctx, lookup({ music: 30, voice: 8 })).play(mix, 6);

    // music began at 2, so 4 s in → offset 1 + 4, 6 s left, starts immediately
    expect(sources[0].startArgs).toEqual([10 + LEAD, 5, 6]);
    // voice began at 5, 1 s in
    expect(sources[1].startArgs).toEqual([10 + LEAD, 1, 2]);
  });

  it('skips clips that have already finished', () => {
    const { ctx, sources } = fakeContext();
    const { mix } = twoTrackMix();
    new MixEngine(ctx, lookup({ music: 30, voice: 8 })).play(mix, 9); // voice ended at 8
    expect(sources).toHaveLength(1);
  });

  it('respects mute, solo and clips whose audio is not loaded', () => {
    const { mix, ids } = twoTrackMix();
    let f = fakeContext();
    new MixEngine(f.ctx, lookup({ music: 30, voice: 8 })).play(
      patchTrack(mix, ids.music, { muted: true }),
      0
    );
    expect(f.sources).toHaveLength(1);

    f = fakeContext();
    new MixEngine(f.ctx, lookup({ music: 30, voice: 8 })).play(
      patchTrack(mix, ids.voice, { solo: true }),
      0
    );
    expect(f.sources).toHaveLength(1);

    f = fakeContext();
    new MixEngine(f.ctx, lookup({ music: 30 })).play(mix, 0); // voice not decoded yet
    expect(f.sources).toHaveLength(1);
  });

  it('loops a looped clip and resumes inside the loop', () => {
    const { ctx, sources } = fakeContext();
    let mix = newTrack(EMPTY_MIX);
    mix = addClip(mix, mix.tracks[0].id, {
      url: 'bed',
      label: '',
      start: 0,
      length: 20,
      loop: true,
    }).mix;
    new MixEngine(ctx, lookup({ bed: 4 })).play(mix, 9);
    expect(sources[0].loop).toBe(true);
    // 9 s in on a 4 s file → 1 s into the loop; 11 s left to play
    expect(sources[0].startArgs).toEqual([10 + LEAD, 1, 11]);
  });

  it('automates fades with linear ramps and applies clip × track gain', () => {
    const { ctx, sources } = fakeContext();
    let { mix, ids } = twoTrackMix();
    mix = patchTrack(mix, ids.voice, { volume: 0.5 });
    mix = patchClip(mix, ids.v, { volume: 0.8, fadeIn: 1, fadeOut: 1 });
    new MixEngine(ctx, lookup({ music: 30, voice: 8 })).play(mix, 0);
    const g = sources[1].gainNode;
    const when = 10 + LEAD + 5;
    expect(g.sets).toEqual([[0, when]]); // starts silent (fade-in)
    expect(g.ramps[0][0]).toBeCloseTo(0.4); // 0.8 × 0.5 at the end of the fade-in
    expect(g.ramps[0][1]).toBeCloseTo(when + 1);
    expect(g.ramps[g.ramps.length - 1]).toEqual([0, when + 3]); // back to silence at the clip's end
  });

  it('sets the master gain from the mixer', () => {
    const f = fakeContext();
    const engine = new MixEngine(f.ctx, lookup({}));
    engine.play(setMaster(EMPTY_MIX, 0.6), 0);
    // the engine's first gain node is the master bus
    expect(f.gains[0].gain.value).toBe(0.6);
    expect(engine.isPlaying).toBe(true);
  });

  it('stop() stops every source and clears state; play() restarts cleanly', () => {
    const { ctx, sources } = fakeContext();
    const { mix } = twoTrackMix();
    const engine = new MixEngine(ctx, lookup({ music: 30, voice: 8 }));
    engine.play(mix, 0);
    engine.stop();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(engine.isPlaying).toBe(false);
    expect(engine.position()).toBeNull();
    engine.play(mix, 3);
    expect(sources).toHaveLength(4);
    expect(sources[2].stopped).toBe(false);
  });

  it('position() follows the audio clock from the start point', () => {
    const f = fakeContext();
    const engine = new MixEngine(f.ctx, lookup({}));
    engine.play(EMPTY_MIX, 7);
    expect(engine.position()).toBe(7); // clock hasn't reached the scheduled start yet
    f.raw.currentTime = 10 + LEAD + 2.5;
    expect(engine.position()).toBeCloseTo(9.5);
  });

  it('never routes the video channel through the engine (caller sets element volume)', () => {
    const { ctx, sources } = fakeContext();
    new MixEngine(ctx, lookup({})).play(patchVideoChannel(EMPTY_MIX, { muted: true }), 0);
    expect(sources).toHaveLength(0);
  });
});
