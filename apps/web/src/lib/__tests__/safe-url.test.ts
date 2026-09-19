import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from '../safe-url';

describe('safeHttpUrl', () => {
  it('allows http(s)', () => {
    expect(safeHttpUrl('https://a.com/x.glb')).toBe('https://a.com/x.glb');
  });
  it('rejects javascript:, data:, garbage and empties', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,<b>', 'nope', '', null, undefined]) {
      expect(safeHttpUrl(u)).toBeUndefined();
    }
  });
});
