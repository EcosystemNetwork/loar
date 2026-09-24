import { describe, it, expect } from 'vitest';
import { splitCitations } from './ask';

describe('splitCitations', () => {
  it('splits text around valid citations', () => {
    expect(splitCitations('Kael flies [1] and Null hides [2].', 2)).toEqual([
      { type: 'text', text: 'Kael flies ' },
      { type: 'cite', index: 0 },
      { type: 'text', text: ' and Null hides ' },
      { type: 'cite', index: 1 },
      { type: 'text', text: '.' },
    ]);
  });
  it('keeps out-of-range markers as literal text', () => {
    expect(splitCitations('See [5] and [0].', 2)).toEqual([
      { type: 'text', text: 'See [5] and [0].' },
    ]);
  });
  it('handles adjacent citations and no citations', () => {
    expect(splitCitations('[1][2]', 2)).toEqual([
      { type: 'cite', index: 0 },
      { type: 'cite', index: 1 },
    ]);
    expect(splitCitations('plain', 3)).toEqual([{ type: 'text', text: 'plain' }]);
    expect(splitCitations('', 3)).toEqual([]);
  });
});
