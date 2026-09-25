import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CUT, DEFAULT_EXPORT_SETTINGS } from '../episodeCut';
import { clearDraft, draftIsNewer, loadDraft, saveDraft, type EpisodeDraft } from '../episodeDraft';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const draft = (over: Partial<EpisodeDraft> = {}): EpisodeDraft => ({
  title: 'T',
  description: '',
  cut: EMPTY_CUT,
  settings: DEFAULT_EXPORT_SETTINGS,
  savedAt: 2000,
  ...over,
});

describe('episode draft backup', () => {
  it('round-trips and clears', () => {
    saveDraft('e1', draft());
    expect(loadDraft('e1')?.title).toBe('T');
    expect(loadDraft('other')).toBeNull();
    clearDraft('e1');
    expect(loadDraft('e1')).toBeNull();
  });

  it('ignores corrupt or malformed entries', () => {
    store.set('loar:episode-draft:e1', '{not json');
    expect(loadDraft('e1')).toBeNull();
    store.set('loar:episode-draft:e2', JSON.stringify({ title: 'x' }));
    expect(loadDraft('e2')).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => saveDraft('e1', draft())).not.toThrow();
    expect(loadDraft('e1')).toBeNull();
    expect(() => clearDraft('e1')).not.toThrow();
  });

  it('offers a backup only when it is newer than the server copy and differs', () => {
    const server = { updatedAt: new Date(1000).toISOString() };
    expect(draftIsNewer(draft({ savedAt: 2000 }), server, 'x', 'y')).toBe(true);
    expect(draftIsNewer(draft({ savedAt: 2000 }), server, 'same', 'same')).toBe(false);
    expect(draftIsNewer(draft({ savedAt: 500 }), server, 'x', 'y')).toBe(false);
    expect(draftIsNewer(draft({ savedAt: 1 }), {}, 'x', 'y')).toBe(true);
  });
});
