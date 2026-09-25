import { describe, expect, it } from 'vitest';
import {
  EMPTY_MIX,
  MAX_CLIPS_PER_TRACK,
  MAX_TOTAL_CLIPS,
  MAX_TRACKS,
  MIN_AUDIO_CLIP_SEC,
  activeAudioClips,
  addClip,
  audioSnapPoints,
  clipPeakColumns,
  computePeaks,
  effectiveClipGain,
  fadeLevelAt,
  findClip,
  gainKeyframes,
  isMixNeutral,
  mixDuration,
  moveAudioClip,
  newTrack,
  normalizeMix,
  patchClip,
  patchTrack,
  patchVideoChannel,
  peaksWindow,
  previewVideoVolume,
  removeAudioClips,
  removeTrack,
  setMaster,
  soundtrackToMix,
  splitAudioClipAt,
  trimAudioClipEdge,
  videoAudioGain,
  type AudioClip,
  type AudioMix,
} from '../audioMix';

/** A mix with a Music and a Voice track, one clip each. */
function fixture(): { mix: AudioMix; music: string; voice: string; mClip: string; vClip: string } {
  let mix = newTrack(EMPTY_MIX, 'music');
  mix = newTrack(mix, 'voice');
  const [music, voice] = mix.tracks.map((t) => t.id);
  const a = addClip(mix, music, {
    url: 'https://a/music.mp3',
    label: 'Bed',
    start: 2,
    length: 10,
    trimStart: 1,
    sourceDuration: 30,
  });
  const b = addClip(a.mix, voice, { url: 'https://a/vo.mp3', label: 'VO', start: 5, length: 3 });
  return { mix: b.mix, music, voice, mClip: a.clipId!, vClip: b.clipId! };
}

describe('tracks', () => {
  it('names tracks by kind and count, and caps the track count', () => {
    let mix = newTrack(EMPTY_MIX, 'music');
    mix = newTrack(mix, 'music');
    expect(mix.tracks.map((t) => t.name)).toEqual(['Music 1', 'Music 2']);
    for (let i = 0; i < 20; i++) mix = newTrack(mix);
    expect(mix.tracks).toHaveLength(MAX_TRACKS);
  });

  it('patches and removes tracks, clamping the fader', () => {
    const { mix, music } = fixture();
    expect(patchTrack(mix, music, { volume: 9 }).tracks[0].volume).toBe(2);
    expect(patchTrack(mix, 'nope', { muted: true })).toBe(mix);
    expect(removeTrack(mix, music).tracks).toHaveLength(1);
    expect(removeTrack(mix, 'nope')).toBe(mix);
  });
});

describe('mixer gain rules', () => {
  it('clip × track gain, and muted tracks are silent', () => {
    const { mix, music } = fixture();
    let m = patchTrack(mix, music, { volume: 0.5 });
    m = patchClip(m, findClip(m, m.tracks[0].clips[0].id)!.clip.id, { volume: 0.8 });
    const t = m.tracks[0];
    expect(effectiveClipGain(m, t, t.clips[0])).toBeCloseTo(0.4);
    const muted = patchTrack(m, music, { muted: true });
    expect(effectiveClipGain(muted, muted.tracks[0], muted.tracks[0].clips[0])).toBe(0);
  });

  it('solo silences everything not soloed — including the video audio', () => {
    const { mix, voice } = fixture();
    const soloed = patchTrack(mix, voice, { solo: true });
    const [music, vo] = soloed.tracks;
    expect(effectiveClipGain(soloed, music, music.clips[0])).toBe(0);
    expect(effectiveClipGain(soloed, vo, vo.clips[0])).toBe(1);
    expect(videoAudioGain(soloed)).toBe(0);
    // Soloing the video channel silences the tracks instead.
    const videoSolo = patchVideoChannel(mix, { solo: true });
    expect(videoAudioGain(videoSolo)).toBe(1);
    expect(effectiveClipGain(videoSolo, videoSolo.tracks[1], videoSolo.tracks[1].clips[0])).toBe(0);
  });

  it('solo wins over mute on the same track', () => {
    const { mix, voice } = fixture();
    const m = patchTrack(patchTrack(mix, voice, { muted: true }), voice, { solo: true });
    expect(effectiveClipGain(m, m.tracks[1], m.tracks[1].clips[0])).toBe(1);
  });

  it('video audio follows its own fader and mute', () => {
    expect(videoAudioGain(EMPTY_MIX)).toBe(1);
    expect(videoAudioGain(patchVideoChannel(EMPTY_MIX, { volume: 0.3 }))).toBeCloseTo(0.3);
    expect(videoAudioGain(patchVideoChannel(EMPTY_MIX, { muted: true }))).toBe(0);
    expect(videoAudioGain(patchVideoChannel(EMPTY_MIX, { volume: 99 }))).toBe(2);
  });

  it('a default mix is neutral; any track, gain or master change is not', () => {
    expect(isMixNeutral(EMPTY_MIX)).toBe(true);
    expect(isMixNeutral(fixture().mix)).toBe(false);
    expect(isMixNeutral(setMaster(EMPTY_MIX, 0.8))).toBe(false);
    expect(isMixNeutral(patchVideoChannel(EMPTY_MIX, { muted: true }))).toBe(false);
    expect(isMixNeutral(newTrack(EMPTY_MIX))).toBe(true); // an empty track changes nothing
  });
});

describe('fades', () => {
  const clip: AudioClip = {
    id: 'c',
    url: 'u',
    label: '',
    start: 0,
    trimStart: 0,
    length: 10,
    volume: 1,
    fadeIn: 2,
    fadeOut: 4,
  };
  it('ramps in and out and holds full level between', () => {
    expect(fadeLevelAt(clip, 0)).toBe(0);
    expect(fadeLevelAt(clip, 1)).toBeCloseTo(0.5);
    expect(fadeLevelAt(clip, 3)).toBe(1);
    expect(fadeLevelAt(clip, 8)).toBeCloseTo(0.5);
    expect(fadeLevelAt(clip, 10)).toBe(0);
  });

  it('caps each fade at half the clip so they never overlap', () => {
    const short = { ...clip, length: 4, fadeIn: 5, fadeOut: 5 };
    expect(fadeLevelAt(short, 2)).toBe(1); // both fades meet at the midpoint
    expect(fadeLevelAt(short, 1)).toBeCloseTo(0.5);
  });

  it('keyframes reproduce the envelope from the start', () => {
    expect(gainKeyframes(clip, 0.5, 0)).toEqual([
      { at: 0, value: 0 },
      { at: 2, value: 0.5 },
      { at: 6, value: 0.5 },
      { at: 10, value: 0 },
    ]);
  });

  it('keyframes resume mid-fade and mid-clip correctly', () => {
    // 1s in: halfway up the fade-in, so start at half gain and ramp to full at 2s.
    expect(gainKeyframes(clip, 1, 1)).toEqual([
      { at: 0, value: 0.5 },
      { at: 1, value: 1 },
      { at: 5, value: 1 },
      { at: 9, value: 0 },
    ]);
    // Past the fade-out start: begin already ramping down.
    const late = gainKeyframes(clip, 1, 8);
    expect(late[0]).toEqual({ at: 0, value: 0.5 });
    expect(late[late.length - 1]).toEqual({ at: 2, value: 0 });
    expect(gainKeyframes(clip, 1, 10)).toEqual([]);
  });
});

describe('addClip', () => {
  it('places a clip, rounds times, clamps volume and honours the limits', () => {
    const { mix, music } = fixture();
    const before = mix.tracks[0].clips.length;
    const r = addClip(mix, music, { url: 'u', label: 'x', start: -3, length: 0, volume: 9 });
    const c = findClip(r.mix, r.clipId!)!.clip;
    expect(c).toMatchObject({
      start: 0,
      length: MIN_AUDIO_CLIP_SEC,
      volume: 2,
      fadeIn: 0,
      fadeOut: 0,
    });
    expect(r.mix.tracks[0].clips).toHaveLength(before + 1);
    expect(addClip(mix, 'missing', { url: 'u', label: '', start: 0, length: 1 }).clipId).toBeNull();
  });

  it('refuses past the per-track and total caps', () => {
    let mix = newTrack(EMPTY_MIX);
    const id = mix.tracks[0].id;
    for (let i = 0; i < MAX_CLIPS_PER_TRACK + 5; i++) {
      mix = addClip(mix, id, { url: 'u', label: '', start: i, length: 1 }).mix;
    }
    expect(mix.tracks[0].clips).toHaveLength(MAX_CLIPS_PER_TRACK);

    let many = EMPTY_MIX;
    for (let i = 0; i < MAX_TRACKS; i++) many = newTrack(many);
    let added = 0;
    for (const t of many.tracks) {
      for (let i = 0; i < 20; i++) {
        const r = addClip(many, t.id, { url: 'u', label: '', start: i, length: 1 });
        if (r.clipId) added++;
        many = r.mix;
      }
    }
    expect(added).toBe(MAX_TOTAL_CLIPS);
  });

  it('a looped clip has no in-point', () => {
    const mix = newTrack(EMPTY_MIX);
    const r = addClip(mix, mix.tracks[0].id, {
      url: 'u',
      label: '',
      start: 0,
      length: 8,
      trimStart: 3,
      loop: true,
    });
    expect(findClip(r.mix, r.clipId!)!.clip).toMatchObject({ trimStart: 0, loop: true });
  });
});

describe('moveAudioClip', () => {
  it('moves in time without touching other clips, clamped at 0', () => {
    const { mix, mClip, vClip } = fixture();
    const moved = moveAudioClip(mix, mClip, 7.25);
    expect(findClip(moved, mClip)!.clip.start).toBe(7.25);
    expect(findClip(moved, vClip)!.clip.start).toBe(5);
    expect(findClip(moveAudioClip(mix, mClip, -4), mClip)!.clip.start).toBe(0);
    expect(moveAudioClip(mix, mClip, 2)).toBe(mix); // no-op keeps identity (no undo entry)
  });

  it('moves across tracks', () => {
    const { mix, mClip, voice } = fixture();
    const moved = moveAudioClip(mix, mClip, 4, voice);
    expect(findClip(moved, mClip)!.track.id).toBe(voice);
    expect(moved.tracks[0].clips).toHaveLength(0);
    expect(moved.tracks[1].clips).toHaveLength(2);
    expect(moveAudioClip(mix, mClip, 4, 'nope')).toBe(mix);
  });
});

describe('trimAudioClipEdge', () => {
  // music clip: start 2, trimStart 1, length 10, source 30
  it('trimming the head keeps the remaining audio where it was on the timeline', () => {
    const { mix, mClip } = fixture();
    const c = findClip(trimAudioClipEdge(mix, mClip, 'start', 3), mClip)!.clip;
    expect(c).toMatchObject({ start: 5, trimStart: 4, length: 7 });
    // Source-time 0 still sits at timeline 1 (start 2 − trimStart 1): the audio didn't slide.
    expect(c.start - c.trimStart).toBe(1);
  });

  it('extending the head reveals earlier source, limited by the in-point and timeline 0', () => {
    const { mix, mClip } = fixture();
    const c = findClip(trimAudioClipEdge(mix, mClip, 'start', -50), mClip)!.clip;
    expect(c).toMatchObject({ start: 1, trimStart: 0, length: 11 });
  });

  it('the tail is limited by the source length and a minimum length', () => {
    const { mix, mClip } = fixture();
    expect(findClip(trimAudioClipEdge(mix, mClip, 'end', 100), mClip)!.clip.length).toBe(29); // 30 − trimStart 1
    expect(findClip(trimAudioClipEdge(mix, mClip, 'end', -100), mClip)!.clip.length).toBe(
      MIN_AUDIO_CLIP_SEC
    );
    expect(findClip(trimAudioClipEdge(mix, mClip, 'end', -2), mClip)!.clip.length).toBe(8);
  });

  it('a looped clip can be stretched indefinitely and has no head in-point', () => {
    const t = newTrack(EMPTY_MIX);
    const r = addClip(t, t.tracks[0].id, {
      url: 'u',
      label: '',
      start: 4,
      length: 5,
      loop: true,
      sourceDuration: 2,
    });
    const id = r.clipId!;
    expect(findClip(trimAudioClipEdge(r.mix, id, 'end', 60), id)!.clip.length).toBe(65);
    const head = findClip(trimAudioClipEdge(r.mix, id, 'start', 1), id)!.clip;
    expect(head).toMatchObject({ start: 5, trimStart: 0, length: 4 });
  });

  it('is a no-op (same object) when nothing changes', () => {
    const { mix, mClip } = fixture();
    expect(trimAudioClipEdge(mix, mClip, 'end', 0)).toBe(mix);
    expect(trimAudioClipEdge(mix, 'nope', 'end', 1)).toBe(mix);
  });
});

describe('splitAudioClipAt', () => {
  it('cuts into two contiguous halves that play the same audio', () => {
    const { mix, mClip } = fixture(); // start 2, trimStart 1, length 10
    const r = splitAudioClipAt(mix, mClip, 6)!; // 4s in
    const left = findClip(r.mix, mClip)!.clip;
    const right = findClip(r.mix, r.rightId)!.clip;
    expect(left).toMatchObject({ start: 2, trimStart: 1, length: 4 });
    expect(right).toMatchObject({ start: 6, trimStart: 5, length: 6 });
    expect(right.id).not.toBe(left.id);
    // Same track, in order, total sounding time preserved.
    expect(r.mix.tracks[0].clips.map((c) => c.id)).toEqual([mClip, r.rightId]);
    expect(left.length + right.length).toBe(10);
  });

  it('splits fades sensibly: fade-in stays left, fade-out goes right', () => {
    const { mix, mClip } = fixture();
    const faded = patchClip(mix, mClip, { fadeIn: 1, fadeOut: 2 });
    const r = splitAudioClipAt(faded, mClip, 6)!;
    expect(findClip(r.mix, mClip)!.clip).toMatchObject({ fadeIn: 1, fadeOut: 0 });
    expect(findClip(r.mix, r.rightId)!.clip).toMatchObject({ fadeIn: 0, fadeOut: 2 });
  });

  it('refuses cuts too close to an edge or outside the clip', () => {
    const { mix, mClip } = fixture();
    expect(splitAudioClipAt(mix, mClip, 2)).toBeNull();
    expect(splitAudioClipAt(mix, mClip, 2 + MIN_AUDIO_CLIP_SEC / 2)).toBeNull();
    expect(splitAudioClipAt(mix, mClip, 12)).toBeNull();
    expect(splitAudioClipAt(mix, mClip, 99)).toBeNull();
    expect(splitAudioClipAt(mix, 'nope', 5)).toBeNull();
  });
});

describe('patchClip / removeAudioClips', () => {
  it('clamps levels and fades, and turning loop on drops the in-point', () => {
    const { mix, mClip } = fixture();
    const c = findClip(patchClip(mix, mClip, { volume: 5, fadeIn: 99, fadeOut: -1 }), mClip)!.clip;
    expect(c).toMatchObject({ volume: 2, fadeIn: 5, fadeOut: 0 });
    expect(findClip(patchClip(mix, mClip, { loop: true }), mClip)!.clip).toMatchObject({
      loop: true,
      trimStart: 0,
    });
  });

  it('removes clips by id and leaves the mix identical when none match', () => {
    const { mix, mClip } = fixture();
    expect(removeAudioClips(mix, new Set([mClip])).tracks[0].clips).toHaveLength(0);
    expect(removeAudioClips(mix, new Set(['nope']))).toBe(mix);
    expect(removeAudioClips(mix, new Set())).toBe(mix);
  });
});

describe('queries', () => {
  it('mixDuration is where the last clip ends', () => {
    expect(mixDuration(EMPTY_MIX)).toBe(0);
    expect(mixDuration(fixture().mix)).toBe(12);
  });

  it('activeAudioClips returns overlapping clips across tracks', () => {
    const { mix } = fixture(); // music 2–12, voice 5–8
    expect(
      activeAudioClips(mix, 6)
        .map((a) => a.clip.label)
        .sort()
    ).toEqual(['Bed', 'VO']);
    expect(activeAudioClips(mix, 3).map((a) => a.clip.label)).toEqual(['Bed']);
    expect(activeAudioClips(mix, 12)).toEqual([]);
  });

  it("snap points cover 0, the playhead and other clips' edges only", () => {
    const { mix, mClip } = fixture();
    expect(audioSnapPoints(mix, 9, mClip).sort((a, b) => a - b)).toEqual([0, 5, 8, 9]);
  });
});

describe('normalizeMix', () => {
  it('returns an empty mix for junk and fills defaults', () => {
    expect(normalizeMix(null)).toEqual(EMPTY_MIX);
    expect(normalizeMix('x')).toEqual(EMPTY_MIX);
    const m = normalizeMix({ tracks: [{ clips: [{ url: 'https://a/x.mp3', length: 3 }] }] });
    expect(m.tracks[0]).toMatchObject({ kind: 'audio', name: 'Audio 1', volume: 1, muted: false });
    expect(m.tracks[0].clips[0]).toMatchObject({ start: 0, trimStart: 0, length: 3, volume: 1 });
    expect(m.mixer).toEqual({ video: { volume: 1, muted: false, solo: false }, master: 1 });
  });

  it('drops clips without a url and clamps out-of-range values', () => {
    const m = normalizeMix({
      mixer: { master: 50, video: { volume: -3 } },
      tracks: [
        {
          volume: 9,
          kind: 'weird',
          clips: [{ url: '' }, { url: 'u', length: 0.01, volume: 7, fadeIn: 100, start: -5 }],
        },
      ],
    });
    expect(m.mixer.master).toBe(2);
    expect(m.mixer.video.volume).toBe(0);
    expect(m.tracks[0]).toMatchObject({ kind: 'audio', volume: 2 });
    expect(m.tracks[0].clips).toHaveLength(1);
    expect(m.tracks[0].clips[0]).toMatchObject({ length: MIN_AUDIO_CLIP_SEC, volume: 2, start: 0 });
    expect(m.tracks[0].clips[0].fadeIn).toBeLessThanOrEqual(MIN_AUDIO_CLIP_SEC / 2);
  });

  it('enforces the track and clip caps on load', () => {
    const many = {
      tracks: Array.from({ length: 20 }, () => ({
        clips: Array.from({ length: 60 }, () => ({ url: 'u', length: 1 })),
      })),
    };
    const m = normalizeMix(many);
    expect(m.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
    expect(m.tracks.reduce((n, t) => n + t.clips.length, 0)).toBeLessThanOrEqual(MAX_TOTAL_CLIPS);
  });

  it('round-trips a real mix unchanged', () => {
    const { mix } = fixture();
    expect(normalizeMix(JSON.parse(JSON.stringify(mix)))).toEqual(mix);
  });
});

describe('soundtrackToMix', () => {
  it('migrates the legacy bed into a looping music track spanning the episode', () => {
    const m = soundtrackToMix(
      EMPTY_MIX,
      { url: 'https://a/bed.mp3', label: 'Theme', volume: 0.4 },
      42
    );
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0]).toMatchObject({ name: 'Soundtrack', kind: 'music' });
    expect(m.tracks[0].clips[0]).toMatchObject({
      start: 0,
      length: 42,
      volume: 0.4,
      loop: true,
      label: 'Theme',
    });
  });
});

describe('peaks', () => {
  it('computePeaks takes the per-bin max over all channels', () => {
    const l = new Float32Array([0.1, -0.5, 0.2, 0.2]);
    const r = new Float32Array([0.9, 0, 0, -0.3]);
    const p = computePeaks([l, r], 4, 2); // 2 bins/sec at 4 Hz → bins of 2 samples
    expect(Array.from(p)).toEqual([0.9, 0.3].map((v) => Math.fround(v)));
  });

  it('computePeaks handles empty input', () => {
    expect(computePeaks([], 44100).length).toBe(0);
    expect(computePeaks([new Float32Array(0)], 44100).length).toBe(0);
  });

  it('peaksWindow resamples the trimmed window to the drawn width', () => {
    const peaks = Float32Array.from([0, 0.2, 0.4, 0.6, 0.8, 1.0]); // 1 bin/sec, 6s
    // window = seconds 2..6 → bins 2..5, drawn in 2 columns
    expect(Array.from(peaksWindow(peaks, 1, 2, 4, 2)).map((v) => Math.fround(v))).toEqual(
      [0.6, 1.0].map((v) => Math.fround(v))
    );
    expect(peaksWindow(new Float32Array(0), 1, 0, 1, 5)).toEqual(new Float32Array(5));
  });
});

describe('clipPeakColumns', () => {
  const peaks = Float32Array.from([0.1, 0.1, 0.9, 0.9]); // 1 bin/sec, 4 s: quiet then loud
  const base: AudioClip = {
    id: 'c',
    url: 'u',
    label: '',
    start: 0,
    trimStart: 0,
    length: 4,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
  };

  it('shows the trimmed source window, one value per pixel', () => {
    const cols = clipPeakColumns({ ...base, trimStart: 2, length: 2 }, peaks, 4, 4, 1);
    expect(Array.from(cols).map((v) => Math.fround(v))).toEqual(
      [0.9, 0.9, 0.9, 0.9].map((v) => Math.fround(v))
    );
  });

  it('tiles a looped clip across its length', () => {
    // 2 s source (quiet 1 s, loud 1 s) looped to 4 s → quiet, loud, quiet, loud
    const short = Float32Array.from([0.1, 0.9]);
    const cols = clipPeakColumns({ ...base, loop: true, length: 4 }, short, 2, 8, 1);
    const q = (v: number) => (v < 0.5 ? 'q' : 'L');
    expect(Array.from(cols).map(q).join('')).toBe('qqLLqqLL');
  });
});

describe('previewVideoVolume', () => {
  it('follows the video channel and master, capped at 1 (elements cannot boost)', () => {
    expect(previewVideoVolume(EMPTY_MIX)).toBe(1);
    expect(previewVideoVolume(patchVideoChannel(EMPTY_MIX, { volume: 0.5 }))).toBe(0.5);
    expect(previewVideoVolume(setMaster(patchVideoChannel(EMPTY_MIX, { volume: 0.5 }), 0.5))).toBe(
      0.25
    );
    expect(previewVideoVolume(patchVideoChannel(EMPTY_MIX, { volume: 2 }))).toBe(1);
    expect(previewVideoVolume(patchVideoChannel(EMPTY_MIX, { muted: true }))).toBe(0);
  });

  it('is silent when another channel is soloed', () => {
    const mix = newTrack(EMPTY_MIX);
    expect(previewVideoVolume(patchTrack(mix, mix.tracks[0].id, { solo: true }))).toBe(0);
  });
});
