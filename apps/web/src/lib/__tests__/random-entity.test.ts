/**
 * Unit tests for lib/random-entity.ts — the pure roll helpers behind the
 * per-kind create form and the "Random universe builder" wizard.
 * (rollRandomEntity itself is async + tRPC and lives outside this file.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KIND_LABELS,
  RANDOM_NAME_SEEDS,
  baseArtPromptForKind,
  pickRandom,
  type EntityKind,
} from '../random-entity';

const ALL_KINDS: EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
  'moodboard',
  'style_pack',
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
];

afterEach(() => vi.restoreAllMocks());

describe('RANDOM_NAME_SEEDS / KIND_LABELS', () => {
  it('has a non-empty seed list for every EntityKind', () => {
    for (const k of ALL_KINDS) {
      expect(Array.isArray(RANDOM_NAME_SEEDS[k]), `seeds missing for ${k}`).toBe(true);
      expect(RANDOM_NAME_SEEDS[k].length, `no seeds for ${k}`).toBeGreaterThan(0);
      expect(RANDOM_NAME_SEEDS[k].every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    }
  });

  it('has a non-empty label for every EntityKind', () => {
    for (const k of ALL_KINDS) {
      expect(KIND_LABELS[k]?.length, `label missing for ${k}`).toBeGreaterThan(0);
    }
  });
});

describe('pickRandom', () => {
  it('returns an element of the array', () => {
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 50; i++) expect(arr).toContain(pickRandom(arr));
  });

  it('picks by Math.random() * length (floored)', () => {
    const arr = ['a', 'b', 'c', 'd'];
    vi.spyOn(Math, 'random').mockReturnValue(0); // → index 0
    expect(pickRandom(arr)).toBe('a');
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // → index 3
    expect(pickRandom(arr)).toBe('d');
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // → index 2
    expect(pickRandom(arr)).toBe('c');
  });
});

describe('baseArtPromptForKind', () => {
  it('produces a distinct phrasing per kind and embeds the name', () => {
    expect(baseArtPromptForKind('person', 'Axiom-7', '')).toMatch(/^Character portrait of Axiom-7/);
    expect(baseArtPromptForKind('place', 'The Cathedral', '')).toMatch(
      /^Establishing shot of The Cathedral/
    );
    expect(baseArtPromptForKind('vehicle', 'Skiff', '')).toMatch(/^Hero shot of Skiff/);
    expect(baseArtPromptForKind('technology', 'Uplink', '')).toMatch(/^Cutaway diagram of Uplink/);
  });

  it('appends a trimmed hint as ", <hint>" and omits it when blank', () => {
    expect(baseArtPromptForKind('person', 'X', '  neon rain  ')).toContain('of X, neon rain,');
    expect(baseArtPromptForKind('person', 'X', '')).toContain('of X, cinematic lighting');
    expect(baseArtPromptForKind('person', 'X', '   ')).not.toContain(', ,');
  });

  it('moodboard and style_pack share the mood-collage phrasing', () => {
    const a = baseArtPromptForKind('moodboard', 'Vibe', '');
    const b = baseArtPromptForKind('style_pack', 'Vibe', '');
    expect(a).toMatch(/^Mood collage representing Vibe/);
    expect(a).toBe(b);
  });

  it('the abstract "world" kinds all fall through to the symbolic-landscape phrasing', () => {
    for (const k of ['timeline', 'reality', 'dimension', 'plane', 'realm', 'domain'] as const) {
      expect(baseArtPromptForKind(k, 'Aeon', '')).toMatch(/^Symbolic landscape of Aeon/);
    }
  });

  it('returns a non-empty string for every EntityKind', () => {
    for (const k of ALL_KINDS) {
      expect(baseArtPromptForKind(k, 'Name', 'hint').length).toBeGreaterThan(10);
    }
  });
});
