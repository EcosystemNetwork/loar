import { describe, it, expect } from 'vitest';
import {
  buildCharacterProfile,
  mergeGeneratedFields,
  isFilled,
  humanizeKey,
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
    expect(p.extra).toEqual([{ key: 'Catchphrase', value: 'Again.' }]);
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

describe('legacy keys', () => {
  it('counts seeded keys toward the spec field and hides them from extras', () => {
    const p = buildCharacterProfile(
      person({
        species: 'Vacation Bunny',
        signatureOutfit: 'Navy dress',
        voice: 'None',
        eyes: 'Purple',
      })
    );
    const by = Object.fromEntries(p.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(by.ancestry).toMatchObject({ filled: true, value: 'Vacation Bunny' });
    expect(by.outfit.value).toBe('Navy dress');
    expect(by.speechStyle.filled).toBe(true);
    expect(p.extra).toEqual([{ key: 'Eyes', value: 'Purple' }]);
  });
  it('maps the older seeded person keys (faction, skills, augmentations, location)', () => {
    const p = buildCharacterProfile(
      person({
        faction: 'The Panopticon Authority',
        skills: 'Biometric analysis',
        augmentations: 'Scanner eyes',
        location: 'The Spire',
      })
    );
    const by = Object.fromEntries(p.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(by.affiliations.value).toBe('The Panopticon Authority');
    expect(by.abilities.value).toBe('Biometric analysis');
    expect(by.distinguishingFeatures.value).toBe('Scanner eyes');
    expect(by.homePlace.value).toBe('The Spire');
    expect(p.extra).toEqual([]);
  });
  it('does not let AI overwrite a value held under a legacy key', () => {
    const { metadata, added } = mergeGeneratedFields({ species: 'Bunny' }, { ancestry: 'Robot' });
    expect(added).toEqual([]);
    expect(metadata.ancestry).toBeUndefined();
  });
});

describe('humanizeKey', () => {
  it('turns camelCase and snake_case into readable labels', () => {
    expect(humanizeKey('signatureOutfit')).toBe('Signature outfit');
    expect(humanizeKey('home_world')).toBe('Home world');
  });
});
