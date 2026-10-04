import { describe, expect, it } from 'vitest';
import {
  localDayNumber,
  pickFeatured,
  recentlyAdded,
  shelfEntities,
  splitMetadata,
  toMillis,
} from './frontPage';
import type { WikiEntity } from './types';

const LONG = 'x'.repeat(150);

function ent(id: string, over: Partial<WikiEntity> = {}): WikiEntity {
  return {
    id,
    name: id,
    description: '',
    kind: 'person',
    imageUrl: null,
    universeAddress: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('toMillis', () => {
  it('reads serialized Firestore timestamps, ISO strings and bad input', () => {
    expect(toMillis({ _seconds: 10, _nanoseconds: 0 })).toBe(10_000);
    expect(toMillis('1970-01-01T00:00:01Z')).toBe(1000);
    expect(toMillis('not a date')).toBe(0);
    expect(toMillis(undefined)).toBe(0);
  });
});

describe('pickFeatured', () => {
  it('prefers entries with art and a real description', () => {
    const pool = [
      ent('a', { imageUrl: 'https://x/a.png' }),
      ent('b', { imageUrl: 'https://x/b.png', description: LONG }),
      ent('c', { description: LONG }),
    ];
    for (let day = 0; day < 5; day++) expect(pickFeatured(pool, day)?.id).toBe('b');
  });

  it('falls back to any entry with art, and to nothing without art', () => {
    expect(pickFeatured([ent('a', { imageUrl: 'https://x/a.png' })], 3)?.id).toBe('a');
    expect(pickFeatured([ent('a', { description: LONG })], 3)).toBeUndefined();
  });

  it('is stable within a day regardless of input order, and rotates across days', () => {
    const pool = ['c', 'a', 'b'].map((id) =>
      ent(id, { imageUrl: `https://x/${id}.png`, description: LONG })
    );
    expect(pickFeatured(pool, 7)?.id).toBe(pickFeatured([...pool].reverse(), 7)?.id);
    const picks = new Set([0, 1, 2].map((d) => pickFeatured(pool, d)?.id));
    expect(picks.size).toBe(3);
  });
});

describe('recentlyAdded', () => {
  it('sorts newest first, de-duplicates and skips the excluded id', () => {
    const pool = [
      ent('old', { createdAt: '2026-01-01T00:00:00Z' }),
      ent('new', { createdAt: { _seconds: 2_000_000_000 } as unknown as string }),
      ent('mid', { createdAt: '2026-06-01T00:00:00Z' }),
      ent('mid', { createdAt: '2026-06-01T00:00:00Z' }),
      ent('featured', { createdAt: '2027-01-01T00:00:00Z' }),
    ];
    expect(recentlyAdded(pool, 10, 'featured').map((e) => e.id)).toEqual(['new', 'mid', 'old']);
    expect(recentlyAdded(pool, 1)).toHaveLength(1);
  });
});

describe('shelfEntities', () => {
  it('puts entries with art first, otherwise keeps order', () => {
    const list = [ent('a'), ent('b', { imageUrl: 'u' }), ent('c'), ent('d', { imageUrl: 'u' })];
    expect(shelfEntities(list, 3).map((e) => e.id)).toEqual(['b', 'd', 'a']);
  });
});

describe('splitMetadata', () => {
  it('routes short scalars to facts and long text to sections, skipping hidden/objects/blank', () => {
    const { facts, sections } = splitMetadata(
      {
        leader: 'Director Clearview',
        era: 2077,
        article: 'A long history. '.repeat(10),
        hq: 'Line one\nLine two',
        modelUrl: 'https://x/m.glb',
        characterVariants: [{ label: 'a' }],
        blank: '   ',
      },
      new Set(['modelUrl'])
    );
    expect(facts).toEqual([
      ['leader', 'Director Clearview'],
      ['era', '2077'],
    ]);
    expect(sections.map(([k]) => k)).toEqual(['article', 'hq']);
  });
});

describe('localDayNumber', () => {
  it('changes once per day', () => {
    const a = localDayNumber(new Date(2026, 9, 4, 0, 30));
    const b = localDayNumber(new Date(2026, 9, 4, 23, 30));
    const c = localDayNumber(new Date(2026, 9, 5, 0, 30));
    expect(a).toBe(b);
    expect(c).toBe(a + 1);
  });
});
