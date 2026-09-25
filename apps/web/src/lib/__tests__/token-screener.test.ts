import { describe, it, expect } from 'vitest';
import { pickKingOfTheHill } from '../token-screener';
import type { EnrichedToken } from '@/hooks/useTokens';

const tok = (over: Partial<EnrichedToken>): EnrichedToken =>
  ({
    id: '0x1',
    symbol: 'T',
    name: 'T',
    stage: 'bonding',
    marketCap: 1,
    graduationPct: 10,
    createdAt: 100,
    ...over,
  }) as EnrichedToken;

describe('pickKingOfTheHill', () => {
  it('is the highest market cap among tokens still on the curve', () => {
    const king = pickKingOfTheHill([
      tok({ id: 'a', marketCap: 5 }),
      tok({ id: 'b', marketCap: 50, stage: 'graduating' }),
      tok({ id: 'c', marketCap: 9 }),
    ]);
    expect(king?.id).toBe('b');
  });

  it('ignores graduated and halted tokens even with a bigger market cap', () => {
    const king = pickKingOfTheHill([
      tok({ id: 'grad', marketCap: 1000, stage: 'graduated' }),
      tok({ id: 'halt', marketCap: 900, stage: 'halted' }),
      tok({ id: 'live', marketCap: 3 }),
    ]);
    expect(king?.id).toBe('live');
  });

  it('skips untraded tokens (no market cap)', () => {
    expect(pickKingOfTheHill([tok({ marketCap: null }), tok({ marketCap: 0 })])).toBeNull();
    expect(pickKingOfTheHill([])).toBeNull();
  });

  it('breaks ties by graduation progress, then recency', () => {
    expect(
      pickKingOfTheHill([
        tok({ id: 'a', marketCap: 5, graduationPct: 20 }),
        tok({ id: 'b', marketCap: 5, graduationPct: 60 }),
      ])?.id
    ).toBe('b');
    expect(
      pickKingOfTheHill([
        tok({ id: 'old', marketCap: 5, graduationPct: 20, createdAt: 1 }),
        tok({ id: 'new', marketCap: 5, graduationPct: 20, createdAt: 9 }),
      ])?.id
    ).toBe('new');
  });
});
