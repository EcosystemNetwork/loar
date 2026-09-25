import { describe, it, expect } from 'vitest';
import { bondingSpotPrice, bondingTradePrice } from '../useTokens';

// The contract's newPrice (indexed as lastPrice / snapshot.price) is integer wei per
// raw unit and truncates to 0 on real curves, so prices come from exact amounts.
describe('bondingSpotPrice', () => {
  it('is 2·raised/sold in ETH per token (linear curve)', () => {
    // raised 2 ETH, sold 200M tokens ⇒ 2e-8 ETH/token
    expect(bondingSpotPrice('2000000000000000000', '200000000000000000000000000')).toBeCloseTo(
      2e-8,
      12
    );
  });
  it('is null with nothing sold or raised, or bad input', () => {
    expect(bondingSpotPrice('0', '0')).toBeNull();
    expect(bondingSpotPrice('1000', '0')).toBeNull();
    expect(bondingSpotPrice(undefined, '5')).toBeNull();
    expect(bondingSpotPrice('abc', '5')).toBeNull();
  });
});

describe('bondingTradePrice', () => {
  it('is eth/tokens for the trade', () => {
    // 0.5 ETH for 100M tokens ⇒ 5e-9
    expect(bondingTradePrice('500000000000000000', '100000000000000000000000000')).toBeCloseTo(
      5e-9,
      12
    );
  });
  it('is 0 when either side is zero or invalid', () => {
    expect(bondingTradePrice('0', '10')).toBe(0);
    expect(bondingTradePrice('10', '0')).toBe(0);
    expect(bondingTradePrice('x', '1')).toBe(0);
  });
});
