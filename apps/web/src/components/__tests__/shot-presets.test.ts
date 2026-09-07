/**
 * Contract tests for shot-presets.ts — the web mirror of the server's
 * SHOT_PRESETS. Drift between the two shows up here.
 */
import { describe, expect, it } from 'vitest';
import {
  SHOT_CATEGORY_LABELS,
  SHOT_PRESETS,
  type ShotPresetCategory,
  type ShotPresetId,
} from '../shot-presets';

const CATEGORIES: ShotPresetCategory[] = ['framing', 'angle', 'lens', 'focus'];

// Keep in sync with the ShotPresetId union in shot-presets.ts.
const ALL_IDS: ShotPresetId[] = [
  'ecu',
  'cu',
  'mcu',
  'ms',
  'mls',
  'ls',
  'ws',
  'ews',
  'eye_level',
  'low_angle',
  'high_angle',
  'worms_eye',
  'birds_eye',
  'dutch_tilt',
  'ots',
  'pov',
  'two_shot',
  'ultra_wide',
  'wide_lens',
  'normal_lens',
  'standard_lens',
  'portrait_lens',
  'telephoto',
  'macro',
  'deep_focus',
  'shallow_focus',
  'rack_focus',
  'split_diopter',
];

describe('SHOT_PRESETS', () => {
  it('has exactly one entry per ShotPresetId, no dupes', () => {
    const ids = SHOT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ALL_IDS].sort());
  });

  it('every entry has a non-empty label + hint and a known category', () => {
    for (const p of SHOT_PRESETS) {
      expect(p.label.trim().length, `${p.id} label`).toBeGreaterThan(0);
      expect(p.hint.trim().length, `${p.id} hint`).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(p.category);
    }
  });

  it('covers all four categories', () => {
    const seen = new Set(SHOT_PRESETS.map((p) => p.category));
    expect([...seen].sort()).toEqual([...CATEGORIES].sort());
  });

  it('SHOT_CATEGORY_LABELS has a label for every category', () => {
    for (const c of CATEGORIES) {
      expect(SHOT_CATEGORY_LABELS[c]?.length).toBeGreaterThan(0);
    }
  });

  it('labels are unique (the picker keys chips by label in tests, users read them)', () => {
    const labels = SHOT_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
