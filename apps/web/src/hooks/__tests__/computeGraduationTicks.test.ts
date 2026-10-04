import { describe, it, expect, vi } from 'vitest';

vi.mock('wagmi', () => ({ useReadContract: vi.fn(), useChainId: vi.fn() }));
vi.mock('@/hooks/useWalletAccount', () => ({ useWalletAccount: vi.fn() }));
vi.mock('@/hooks/useCircleWrite', () => ({ useWriteContract: vi.fn() }));

import { computeGraduationTicks } from '../useUniverseManager';

describe('computeGraduationTicks', () => {
  it('opens the pool at the curve final price for a 1 ETH graduation', () => {
    // reserve = 800M / 3 → price 3.75e-9 WETH/token → tick ≈ -194025.
    // -194000 is the value the Sepolia fork test graduates + trades with.
    const t = computeGraduationTicks(10n ** 18n, 8000, 200);
    expect(t.tickIfToken0IsLoar).toBe(-194000);
    expect(t.tickLower).toEqual([-887200]);
    expect(t.tickUpper).toEqual([887200]);
  });

  it('raises the opening price with the graduation target', () => {
    expect(computeGraduationTicks(4n * 10n ** 18n, 8000, 200).tickIfToken0IsLoar).toBe(-180200);
  });

  it('keeps ticks on the tick spacing', () => {
    const t = computeGraduationTicks(10n ** 18n, 6000, 60);
    expect(Math.abs(t.tickIfToken0IsLoar % 60)).toBe(0);
    expect(Math.abs(t.tickLower[0] % 60)).toBe(0);
  });
});
