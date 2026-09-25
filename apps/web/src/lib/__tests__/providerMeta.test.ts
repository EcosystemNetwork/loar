/**
 * Unit tests for lib/providerMeta.ts — BYOK provider display copy shared by
 * /settings/api-keys and ApiKeyGateModal (so the two never drift).
 */
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_META,
  type Provider,
  formatRelativeTime,
  isKnownProviderMeta,
  keyStatus,
  providerLabel,
} from '../providerMeta';

const ALL_PROVIDERS: Provider[] = [
  'bytedance',
  'zai',
  'openai',
  'google',
  'fal',
  'elevenlabs',
  'meshy',
  'tripo',
  'minimax',
  'assemblyai',
  'deepgram',
  'groq',
];

describe('PROVIDER_META', () => {
  it('has an entry for every Provider in the union', () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_META[p], `missing meta for ${p}`).toBeDefined();
    }
    expect(Object.keys(PROVIDER_META).sort()).toEqual([...ALL_PROVIDERS].sort());
  });

  it('every entry has non-empty label / blurb / placeholder / lockedNote', () => {
    for (const [id, m] of Object.entries(PROVIDER_META)) {
      for (const field of ['label', 'blurb', 'placeholder', 'lockedNote'] as const) {
        expect(m[field].trim().length, `${id}.${field} empty`).toBeGreaterThan(0);
      }
    }
  });

  it('every docsUrl is an https URL', () => {
    for (const [id, m] of Object.entries(PROVIDER_META)) {
      expect(m.docsUrl, `${id}.docsUrl`).toMatch(/^https:\/\//);
      expect(() => new URL(m.docsUrl)).not.toThrow();
    }
  });
});

describe('isKnownProviderMeta', () => {
  it('is true for known ids and narrows the type', () => {
    expect(isKnownProviderMeta('openai')).toBe(true);
    expect(isKnownProviderMeta('meshy')).toBe(true);
  });
  it('is false for unknown / empty / arbitrary ids', () => {
    expect(isKnownProviderMeta('anthropic')).toBe(false);
    expect(isKnownProviderMeta('')).toBe(false);
    expect(isKnownProviderMeta('OpenAI')).toBe(false); // case-sensitive
  });
});

describe('providerLabel', () => {
  it('returns the friendly label for a known provider', () => {
    expect(providerLabel('bytedance')).toBe(PROVIDER_META.bytedance.label);
    expect(providerLabel('zai')).toBe('Z.AI (GLM)');
  });
  it('falls back to the raw id for an unrecognised provider (new server-side addition)', () => {
    expect(providerLabel('future-provider')).toBe('future-provider');
  });
});

describe('keyStatus', () => {
  it('is active for an enabled key', () => {
    expect(keyStatus({ enabled: true })).toBe('active');
    expect(keyStatus({ enabled: true, lastCheckStatus: 'valid' })).toBe('active');
  });
  it('is disabled when switched off', () => {
    expect(keyStatus({ enabled: false, lastCheckStatus: null })).toBe('disabled');
  });
  it('rejected outranks disabled — replacing the key is what the user must do', () => {
    expect(keyStatus({ enabled: true, lastCheckStatus: 'invalid' })).toBe('rejected');
    expect(keyStatus({ enabled: false, lastCheckStatus: 'invalid' })).toBe('rejected');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-24T12:00:00Z').getTime();
  it('formats coarse buckets', () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('clamps future timestamps and survives garbage', () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe('just now');
    expect(formatRelativeTime('not-a-date', now)).toBe('unknown');
  });
});
