import { describe, expect, it } from 'vitest';
import { clipLabel } from './clips';

describe('clipLabel', () => {
  it('turns Tripo preset ids into readable clip names', () => {
    expect(clipLabel('preset:walk')).toBe('Walk');
    expect(clipLabel('preset:biped:wave_goodbye_01')).toBe('Wave goodbye 1');
    expect(clipLabel('preset:biped:press-up')).toBe('Press up');
    expect(clipLabel('preset:quadruped:walk')).toBe('Walk');
    expect(clipLabel('preset:biped:dance_06')).toBe('Dance 6');
  });
});
