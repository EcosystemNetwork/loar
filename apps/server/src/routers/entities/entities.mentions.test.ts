import { describe, it, expect } from 'vitest';
import type { Entity } from './entities.types';
import { findMentions } from './entities.mentions';

const ent = (id: string, name: string, description = ''): Entity =>
  ({ id, name, description, kind: 'person', imageUrl: null }) as unknown as Entity;

describe('findMentions', () => {
  const kael = ent('1', 'Kael', 'Pilot.');

  it('finds whole-name mentions case-insensitively', () => {
    const r = findMentions(kael, [ent('2', 'Null', 'Hunted by KAEL across the grid.')]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
    expect(r[0].snippet).toContain('KAEL');
  });
  it('does not match inside longer words', () => {
    expect(findMentions(kael, [ent('2', 'X', 'Kaelen and Ankael are unrelated.')])).toEqual([]);
  });
  it('skips the entity itself', () => {
    expect(findMentions(kael, [ent('1', 'Kael', 'Kael is here.')])).toEqual([]);
  });
  it('ignores too-short names', () => {
    expect(findMentions(ent('1', 'Ed'), [ent('2', 'X', 'Ed was here')])).toEqual([]);
  });
  it('escapes regex characters in names', () => {
    const t = ent('1', 'C++ Core');
    expect(findMentions(t, [ent('2', 'X', 'Built on the C++ Core runtime.')])).toHaveLength(1);
    expect(findMentions(ent('1', '(.*)+'), [ent('2', 'X', 'anything')])).toEqual([]);
  });
  it('adds ellipses to trimmed snippets and respects the limit', () => {
    const long = `${'a '.repeat(80)}Kael${' b'.repeat(80)}`;
    const r = findMentions(kael, [ent('2', 'X', long)]);
    expect(r[0].snippet.startsWith('…')).toBe(true);
    expect(r[0].snippet.endsWith('…')).toBe(true);
    const many = Array.from({ length: 50 }, (_, i) => ent(`m${i}`, 'M', 'Kael'));
    expect(findMentions(kael, many, 5)).toHaveLength(5);
  });
});

import { findEpisodeAppearances } from './entities.mentions';

describe('findEpisodeAppearances', () => {
  const eps = [
    { id: 'a', title: 'Ep 1', description: 'Sable wakes at the fracture.' },
    { id: 'b', title: 'Sable Returns', description: '' },
    { id: 'c', title: 'Ep 3', description: 'Unrelated sabled text.' },
  ];
  it('matches by description or title, whole-name only', () => {
    const r = findEpisodeAppearances('Sable', eps);
    expect(r.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r[0].snippet).toContain('Sable');
    expect(r[1].snippet).toBe('');
  });
  it('ignores too-short names', () => {
    expect(findEpisodeAppearances('Ed', eps)).toEqual([]);
  });
});
