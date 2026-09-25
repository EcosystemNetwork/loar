import { describe, it, expect } from 'vitest';
import {
  buildCharacterProfile,
  mergeGeneratedFields,
  isFilled,
  CHARACTER_FIELD_KEYS,
} from './entities.character-profile';

const person = (metadata: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: 'e1',
  name: 'Sable',
  description: 'A Voidborn who remembers every universe that has ever died.',
  imageUrl: null as string | null,
  metadata,
  ...extra,
});

describe('isFilled', () => {
  it('rejects empty, whitespace, placeholder dashes and nullish', () => {
    for (const v of [null, undefined, '', '   ', '-', '—', '?']) {
      expect(isFilled(v)).toBe(false);
    }
  });
  it('accepts real text and numbers', () => {
    expect(isFilled('Pilot')).toBe(true);
    expect(isFilled(42)).toBe(true);
  });
});

describe('buildCharacterProfile', () => {
  it('reports an empty profile as 0% with every field missing', () => {
    const p = buildCharacterProfile(person());
    expect(p.completeness.percent).toBe(0);
    expect(p.completeness.missing).toEqual(CHARACTER_FIELD_KEYS);
    expect(p.completeness.hasDescription).toBe(true);
  });

  it('counts filled fields and lists what is still missing', () => {
    const p = buildCharacterProfile(
      person({ role: 'Protagonist', appearance: 'Tall.', age: '  ' })
    );
    expect(p.completeness.filled).toBe(2);
    expect(p.completeness.missing).not.toContain('role');
    expect(p.completeness.missing).toContain('age');
    expect(p.completeness.percent).toBe(Math.round((2 / CHARACTER_FIELD_KEYS.length) * 100));
  });

  it('keeps unknown metadata keys visible but hides structured blobs', () => {
    const p = buildCharacterProfile(
      person({ catchphrase: 'Again.', modelUrl: 'https://x/y.glb', characterVariants: [] })
    );
    expect(p.extra).toEqual([{ key: 'catchphrase', value: 'Again.' }]);
  });

  it('derives asset checks from signals, portrait and 3D variants', () => {
    const p = buildCharacterProfile(
      person({ characterVariants: [{ type: '3d' }] }, { imageUrl: 'https://x/a.png' }),
      { relationCount: 3, mediaCount: 0, referenceCount: 2 }
    );
    const by = Object.fromEntries(p.assets.map((a) => [a.key, a]));
    expect(by.portrait.done).toBe(true);
    expect(by.model3d.done).toBe(true);
    expect(by.relationships).toMatchObject({ done: true, count: 3 });
    expect(by.references).toMatchObject({ done: true, count: 2 });
    expect(by.media.done).toBe(false);
  });

  it('flags a too-short description', () => {
    expect(
      buildCharacterProfile(person({}, { description: 'Hi' })).completeness.hasDescription
    ).toBe(false);
  });
});

describe('mergeGeneratedFields', () => {
  it('never overwrites a human-written field', () => {
    const { metadata, added } = mergeGeneratedFields(
      { role: 'Mentor' },
      { role: 'Villain', age: '900' }
    );
    expect(metadata.role).toBe('Mentor');
    expect(metadata.age).toBe('900');
    expect(added).toEqual(['age']);
  });

  it('drops keys outside the spec and empty generated values', () => {
    const { metadata, added } = mergeGeneratedFields(
      { kept: 'x' },
      { evil: 'nope', fears: '   ', backstory: 'Born in the fracture.' }
    );
    expect(metadata).toEqual({ kept: 'x', backstory: 'Born in the fracture.' });
    expect(added).toEqual(['backstory']);
  });

  it('caps runaway generated text', () => {
    const { metadata } = mergeGeneratedFields({}, { backstory: 'a'.repeat(5000) });
    expect((metadata.backstory as string).length).toBe(1200);
  });
});
