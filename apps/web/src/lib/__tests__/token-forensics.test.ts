import { describe, it, expect } from 'vitest';
import {
  classifyHolder,
  detectSnipersAndBundles,
  packBubbles,
  supplyShare,
  type TransferLite,
} from '../token-forensics';

const T = (to: string, blockNumber: number, from = '0xcurve'): TransferLite => ({
  from,
  to,
  blockNumber,
  timestamp: blockNumber * 12,
});
const ZERO = '0x0000000000000000000000000000000000000000';

describe('detectSnipersAndBundles', () => {
  it('never flags launch-block allocations', () => {
    const r = detectSnipersAndBundles([
      T('0xcreator', 100, ZERO),
      T('0xtreasury', 100, ZERO),
      T('0xcurve', 100, ZERO),
    ]);
    expect(r.launchBlock).toBe(100);
    expect(r.snipers.size).toBe(0);
  });
  it('flags wallets whose first buy lands within N blocks after launch', () => {
    const r = detectSnipersAndBundles(
      [T('0xcreator', 100, ZERO), T('0xa', 101), T('0xb', 104), T('0xlate', 140)],
      { maxBlocks: 5 }
    );
    expect([...r.snipers].sort()).toEqual(['0xa', '0xb']);
  });
  it('uses the FIRST inbound block, not later top-ups', () => {
    const r = detectSnipersAndBundles([T('0xcreator', 100, ZERO), T('0xa', 200), T('0xa', 101)]);
    expect(r.snipers.has('0xa')).toBe(true);
  });
  it('detects bundles: 3+ fresh wallets funded in the same post-launch block', () => {
    const r = detectSnipersAndBundles([
      T('0xc', 100, ZERO),
      T('0xa', 102),
      T('0xb', 102),
      T('0xd', 102),
      T('0xe', 103),
    ]);
    expect([...r.bundled].sort()).toEqual(['0xa', '0xb', '0xd']);
    expect(r.bundled.has('0xe')).toBe(false);
  });
  it('honours excludes and case-insensitivity, ignores the zero address', () => {
    const r = detectSnipersAndBundles(
      [T('0xC', 100, ZERO), T('0xCURVE', 101), T(ZERO, 101), T('0xA', 101)],
      { exclude: ['0xcurve'] }
    );
    expect([...r.snipers]).toEqual(['0xa']);
  });
  it('handles no data', () => {
    expect(detectSnipersAndBundles([]).snipers.size).toBe(0);
  });
});

describe('supplyShare / classifyHolder', () => {
  it('sums balances of the set as a percent of total', () => {
    const pct = supplyShare(
      new Set(['0xa']),
      [
        { address: '0xA', balance: 25n },
        { address: '0xb', balance: 75n },
      ],
      100n
    );
    expect(pct).toBe(25);
    expect(supplyShare(new Set(['0xa']), [], 0n)).toBe(0);
  });
  it('classifies with contract > creator > bundle > sniper precedence', () => {
    const ctx = {
      creators: ['0xC'],
      contracts: ['0xK'],
      snipers: new Set(['0xs', '0xb']),
      bundled: new Set(['0xb']),
    };
    expect(classifyHolder('0xk', ctx)).toBe('contract');
    expect(classifyHolder('0xc', ctx)).toBe('creator');
    expect(classifyHolder('0xb', ctx)).toBe('bundle');
    expect(classifyHolder('0xs', ctx)).toBe('sniper');
    expect(classifyHolder('0xz', ctx)).toBe('holder');
  });
});

describe('packBubbles', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `0x${i}`, value: 100 / i }));
  const bubbles = packBubbles(items, 400, 300);
  it('places every positive-value item inside the box with no overlaps', () => {
    expect(bubbles).toHaveLength(8);
    for (const b of bubbles) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.r).toBeLessThanOrEqual(400.5);
      expect(b.y - b.r).toBeGreaterThanOrEqual(-0.5);
      expect(b.y + b.r).toBeLessThanOrEqual(300.5);
    }
    for (let i = 0; i < bubbles.length; i++)
      for (let j = i + 1; j < bubbles.length; j++)
        expect(
          Math.hypot(bubbles[i].x - bubbles[j].x, bubbles[i].y - bubbles[j].y)
        ).toBeGreaterThanOrEqual(bubbles[i].r + bubbles[j].r - 0.01);
  });
  it('sizes by value, is deterministic, and drops zero/empty', () => {
    expect(bubbles[0].r).toBeGreaterThan(bubbles[7].r);
    expect(packBubbles(items, 400, 300)).toEqual(bubbles);
    expect(packBubbles([{ id: 'z', value: 0 }], 400, 300)).toEqual([]);
    expect(packBubbles([], 400, 300)).toEqual([]);
  });
});
