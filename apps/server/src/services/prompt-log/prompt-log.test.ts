/**
 * prompt-log — capture gating, kind derivation, and in-process dedupe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setSpy, docSpy, collectionSpy } = vi.hoisted(() => {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const docSpy = vi.fn(() => ({ set: setSpy }));
  const collectionSpy = vi.fn(() => ({ doc: docSpy }));
  return { setSpy, docSpy, collectionSpy };
});

vi.mock('../../lib/firebase', () => ({
  db: { collection: collectionSpy },
  firebaseAvailable: true,
}));

import { capturePrompt } from './index';
import { withCostScope } from '../cost-tracker/scope';

beforeEach(() => {
  setSpy.mockClear();
  docSpy.mockClear();
  collectionSpy.mockClear();
});

describe('capturePrompt', () => {
  it('records a user prompt on a generation route', () => {
    withCostScope({ userId: '0xabc', route: 'trpc:generation.generate' }, () => {
      capturePrompt('a cinematic wide shot of a dragon over a burning city');
    });

    expect(collectionSpy).toHaveBeenCalledWith('promptLog');
    expect(setSpy).toHaveBeenCalledTimes(1);
    const doc = setSpy.mock.calls[0][0];
    expect(doc).toMatchObject({
      userId: '0xabc',
      route: 'trpc:generation.generate',
      kind: 'video',
      field: 'prompt',
      source: 'live',
    });
    expect(doc.promptHash).toHaveLength(64);
    expect(doc.promptChars).toBeGreaterThan(0);
  });

  it('dedupes an identical prompt within the window', () => {
    withCostScope({ userId: '0xdd', route: 'trpc:image.generate' }, () => {
      capturePrompt('identical dedupe probe text');
      capturePrompt('identical dedupe probe text');
    });
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct prompts from the same request', () => {
    withCostScope({ userId: '0xee', route: 'trpc:image.generate' }, () => {
      capturePrompt('first distinct prompt');
      capturePrompt('second distinct prompt');
    });
    expect(setSpy).toHaveBeenCalledTimes(2);
  });

  it('skips system calls with no userId', () => {
    withCostScope({ userId: null, route: 'trpc:generation.generate' }, () => {
      capturePrompt('orphan system prompt xyz');
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('skips non-generation routes', () => {
    withCostScope({ userId: '0xabc', route: 'trpc:profile.update' }, () => {
      capturePrompt('not a generation prompt at all here');
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('skips trivial strings', () => {
    withCostScope({ userId: '0xabc', route: 'trpc:generation.generate' }, () => {
      capturePrompt('  ');
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('derives kind from the route mount key', () => {
    const cases: Array<[string, string]> = [
      ['trpc:threed.generate', 'threed'],
      ['trpc:tts.speak', 'audio'],
      ['trpc:editing.inpaint', 'edit'],
      ['trpc:outpaint.run', 'image'],
      ['trpc:wiki.summarize', 'text'],
    ];
    for (const [route, expected] of cases) {
      setSpy.mockClear();
      withCostScope({ userId: `0x${expected}`, route }, () => {
        capturePrompt(`kind probe for ${expected} ${route}`);
      });
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0].kind).toBe(expected);
    }
  });

  it('honours an explicit kind override even off a generation route', () => {
    withCostScope({ userId: '0xff', route: 'trpc:something.else' }, () => {
      capturePrompt('override probe text', { kind: 'image', field: 'negativePrompt' });
    });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toMatchObject({ kind: 'image', field: 'negativePrompt' });
  });

  it('never throws', () => {
    expect(() => capturePrompt(undefined as unknown as string)).not.toThrow();
  });
});
