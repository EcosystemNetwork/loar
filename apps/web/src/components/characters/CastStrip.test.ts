import { describe, expect, it } from 'vitest';
import { castStatus, sortCast } from './CastStrip';

describe('castStatus', () => {
  it('reports art-only, model and rigged characters', () => {
    expect(castStatus({ id: 'a', name: 'A' })).toBe('art');
    expect(castStatus({ id: 'b', name: 'B', metadata: { model3d: { glbUrl: 'x' } } })).toBe(
      'model'
    );
    expect(castStatus({ id: 'c', name: 'C', metadata: { puppet: { modelUrl: 'x' } } })).toBe(
      'model'
    );
    expect(
      castStatus({
        id: 'd',
        name: 'D',
        metadata: { puppet: { riggedModelUrl: 'x', rigType: 'biped' } },
      })
    ).toBe('rigged');
  });
});

describe('sortCast', () => {
  it('puts NFT samples first, then sorts by name', () => {
    const out = sortCast([
      { id: '1', name: 'Wren Ashby' },
      { id: '2', name: 'Outlaw #002', metadata: { sample: true } },
      { id: '3', name: 'Big Tobin' },
      { id: '4', name: 'Outlaw #001', metadata: { sample: true } },
    ]);
    expect(out.map((e) => e.id)).toEqual(['4', '2', '3', '1']);
  });
});
