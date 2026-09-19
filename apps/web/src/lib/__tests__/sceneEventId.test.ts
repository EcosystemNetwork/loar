import { describe, it, expect } from 'vitest';
import { nextSceneEventId } from '../sceneEventId';

describe('nextSceneEventId', () => {
  it('starts at 1 on an empty timeline', () => {
    expect(nextSceneEventId({ additionType: 'after', existingIds: [] })).toBe('1');
  });

  it('continues the main line from the highest numeric id, ignoring suffixes', () => {
    expect(nextSceneEventId({ additionType: 'after', existingIds: ['1', '2', '2b', '3'] })).toBe(
      '4'
    );
  });

  it('branches with the first free letter, not a count', () => {
    // "1c" exists but "1b" was deleted: a count-based scheme would pick "1c" again.
    expect(
      nextSceneEventId({ additionType: 'branch', sourceEventId: '1', existingIds: ['1', '1c'] })
    ).toBe('1b');
  });

  it("does not confuse ids that merely start with the source id ('1' vs '12b')", () => {
    expect(
      nextSceneEventId({ additionType: 'branch', sourceEventId: '1', existingIds: ['1', '12b'] })
    ).toBe('1b');
  });

  it('continues a branch from a branch reference', () => {
    expect(
      nextSceneEventId({ additionType: 'after', sourceEventId: '1b', existingIds: ['1', '1b'] })
    ).toBe('1c');
  });

  it('falls back past z without colliding', () => {
    const letters = Array.from({ length: 25 }, (_, i) => `1${String.fromCharCode(98 + i)}`);
    const id = nextSceneEventId({
      additionType: 'branch',
      sourceEventId: '1',
      existingIds: ['1', ...letters],
    });
    expect(id).toBe('1b2');
    expect(letters).not.toContain(id);
  });
});
