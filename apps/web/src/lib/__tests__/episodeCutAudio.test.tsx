import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_CUT, cutFromEpisode, cutSignature, DEFAULT_EXPORT_SETTINGS } from '../episodeCut';
import { clearDraft, loadDraft, saveDraft } from '../episodeDraft';
import { EMPTY_MIX, addClip, newTrack, patchTrack } from '../audioMix';

const clips = [
  { nodeId: 'a', label: 'A', videoUrl: 'https://v/a.mp4', trimStart: 0, trimEnd: 6 },
  { nodeId: 'b', label: 'B', videoUrl: 'https://v/b.mp4', trimStart: 1, trimEnd: 5 },
];

describe('cutFromEpisode with audio', () => {
  it('an episode saved before the audio mix existed gets the empty mix', () => {
    const cut = cutFromEpisode({ clips });
    expect(cut.audioMix).toEqual(EMPTY_MIX);
    expect(cut.soundtrack).toBeNull();
  });

  it('keeps a saved mix, sanitising it', () => {
    const track = newTrack(EMPTY_MIX, 'voice');
    const { mix } = addClip(track, track.tracks[0].id, {
      url: 'https://a/vo.mp3',
      label: 'VO',
      start: 2,
      length: 3,
    });
    const cut = cutFromEpisode({ clips, audioMix: JSON.parse(JSON.stringify(mix)) });
    expect(cut.audioMix).toEqual(mix);

    const junk = cutFromEpisode({
      clips,
      audioMix: {
        tracks: [{ clips: [{ url: '' }, { url: 'u', length: 0.01, volume: 9 }] }],
        mixer: { master: 50 },
      },
    });
    expect(junk.audioMix.mixer.master).toBe(2);
    expect(junk.audioMix.tracks[0].clips).toHaveLength(1);
    expect(junk.audioMix.tracks[0].clips[0].volume).toBe(2);
  });

  it('folds the legacy single soundtrack into a looping music track spanning the cut', () => {
    const cut = cutFromEpisode({
      clips,
      soundtrack: { url: 'https://a/bed.mp3', label: 'Theme', volume: 0.4 },
    });
    expect(cut.soundtrack).toBeNull(); // saving now clears it server-side
    expect(cut.audioMix.tracks).toHaveLength(1);
    expect(cut.audioMix.tracks[0]).toMatchObject({ name: 'Soundtrack', kind: 'music' });
    // trimmed clips are exact: (6 − 0) + (5 − 1) = 10 s
    expect(cut.audioMix.tracks[0].clips[0]).toMatchObject({
      start: 0,
      length: 10,
      volume: 0.4,
      loop: true,
      label: 'Theme',
    });
  });

  it('a legacy soundtrack merges with an existing mix rather than replacing it', () => {
    const track = newTrack(EMPTY_MIX, 'sfx');
    const cut = cutFromEpisode({
      clips,
      audioMix: track,
      soundtrack: { url: 'https://a/bed.mp3', volume: 0.5 },
    });
    expect(cut.audioMix.tracks.map((t) => t.name)).toEqual(['SFX 1', 'Soundtrack']);
  });

  it('ignores an empty soundtrack object', () => {
    expect(cutFromEpisode({ clips, soundtrack: { url: '', volume: 0.5 } }).audioMix).toEqual(
      EMPTY_MIX
    );
  });
});

describe('cutSignature covers the audio mix (so it autosaves and shows as unsaved)', () => {
  const base = { ...EMPTY_CUT, clips };
  const sig = (cut: typeof base) => cutSignature('T', 'D', cut, DEFAULT_EXPORT_SETTINGS);

  it('changes when a track is added, muted or the master moves', () => {
    const withTrack = { ...base, audioMix: newTrack(EMPTY_MIX) };
    expect(sig(withTrack)).not.toBe(sig(base));
    const muted = {
      ...base,
      audioMix: patchTrack(withTrack.audioMix, withTrack.audioMix.tracks[0].id, { muted: true }),
    };
    expect(sig(muted)).not.toBe(sig(withTrack));
    const master = {
      ...base,
      audioMix: { ...EMPTY_MIX, mixer: { ...EMPTY_MIX.mixer, master: 0.5 } },
    };
    expect(sig(master)).not.toBe(sig(base));
  });

  it('is stable for an unchanged cut', () => {
    expect(sig(base)).toBe(sig({ ...base }));
  });
});

describe('local draft backup with audio', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const draft = (cut: unknown) =>
    ({
      title: 'T',
      description: '',
      cut,
      settings: DEFAULT_EXPORT_SETTINGS,
      savedAt: Date.now(),
    }) as any;

  it('round-trips a mix', () => {
    const track = newTrack(EMPTY_MIX, 'music');
    const cut = {
      ...EMPTY_CUT,
      clips,
      audioMix: patchTrack(track, track.tracks[0].id, { volume: 0.5 }),
    };
    saveDraft('ep1', draft(cut));
    expect(loadDraft('ep1')!.cut.audioMix).toEqual(cut.audioMix);
  });

  it('a backup written before the mix existed loads with an empty mix and no undefined fields', () => {
    saveDraft('ep2', draft({ clips, overlays: [], soundtrack: null }));
    const loaded = loadDraft('ep2')!;
    expect(loaded.cut.audioMix).toEqual(EMPTY_MIX);
    expect(loaded.cut.overlays).toEqual([]);
    expect(loaded.cut.soundtrack).toBeNull();
  });

  it('a very old backup with no overlays key still loads', () => {
    saveDraft('ep3', draft({ clips }));
    const loaded = loadDraft('ep3')!;
    expect(loaded.cut.overlays).toEqual([]);
    expect(loaded.cut.audioMix).toEqual(EMPTY_MIX);
  });

  it('rejects a corrupt backup and can be cleared', () => {
    localStorage.setItem('loar:episode-draft:bad', '{not json');
    expect(loadDraft('bad')).toBeNull();
    saveDraft('ep4', draft({ clips }));
    clearDraft('ep4');
    expect(loadDraft('ep4')).toBeNull();
  });
});
