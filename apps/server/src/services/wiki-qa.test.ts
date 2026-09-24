import { describe, it, expect } from 'vitest';
import type { Entity } from '../routers/entities/entities.types';
import {
  tokenize,
  rankEntities,
  formatSources,
  citedSources,
  buildQaUserPrompt,
  MAX_SOURCES,
} from './wiki-qa';

const ent = (name: string, description = '', kind = 'person', metadata = {}): Entity =>
  ({ id: name, name, description, kind, metadata }) as unknown as Entity;

describe('tokenize', () => {
  it('drops stopwords and short tokens, lowercases', () => {
    expect(tokenize('Who is the leader of Null?')).toEqual(['leader', 'null']);
  });
  it('handles non-latin letters', () => {
    expect(tokenize('Où est Élodie')).toContain('élodie');
  });
});

describe('rankEntities', () => {
  const kael = ent('Kael', 'Pilot of the Convergence fleet.');
  const nexus = ent('Nexus Protocol', 'The network Kael fights to free.', 'lore');
  const rain = ent('Acid Rain', 'Weather over the lower city.', 'place');

  it('ranks a full-name mention first', () => {
    expect(rankEntities('Who is Kael?', [rain, nexus, kael])[0].name).toBe('Kael');
  });
  it('excludes entities with no match', () => {
    const r = rankEntities('Who is Kael?', [rain, kael]);
    expect(r.map((e) => e.name)).toEqual(['Kael']);
  });
  it('returns nothing for a question with no usable tokens', () => {
    expect(rankEntities('what is the?', [kael])).toEqual([]);
  });
  it('matches on metadata text', () => {
    const e = ent('Vesper', '', 'person', { role: 'smuggler captain' });
    expect(rankEntities('any smuggler?', [e, rain]).map((x) => x.name)).toEqual(['Vesper']);
  });
  it('caps results at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ent(`Kael ${i}`, 'kael'));
    expect(rankEntities('kael', many)).toHaveLength(MAX_SOURCES);
  });
});

describe('formatSources / buildQaUserPrompt', () => {
  it('numbers sources from 1 with kind and metadata', () => {
    const out = formatSources([ent('Kael', 'Pilot.', 'person', { role: 'pilot', n: 3 })]);
    expect(out).toBe('[1] Kael (person): Pilot. [role: pilot]');
  });
  it('truncates long descriptions', () => {
    expect(formatSources([ent('A', 'x'.repeat(2000))]).length).toBeLessThan(800);
  });
  it('puts the question after the sources', () => {
    const p = buildQaUserPrompt('Who?', [ent('Kael')]);
    expect(p.indexOf('CANON SOURCES')).toBeLessThan(p.indexOf('QUESTION: Who?'));
  });
});

describe('citedSources', () => {
  const s = [ent('A'), ent('B'), ent('C'), ent('D')];
  it('returns cited sources in citation order, deduped', () => {
    expect(citedSources('B is key [2]. See also [1][2].', s).map((e) => e.name)).toEqual([
      'B',
      'A',
    ]);
  });
  it('ignores out-of-range citations', () => {
    expect(citedSources('nope [9] [0]', s).map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });
  it('falls back to the top three when nothing is cited', () => {
    expect(citedSources('no citations', s)).toHaveLength(3);
  });
});
