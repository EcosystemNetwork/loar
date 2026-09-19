import { describe, expect, it } from 'vitest';
import { isUniverseExcluded } from './universe-id';

describe('isUniverseExcluded', () => {
  const evm = '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa';
  const pda = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
  const excluded = new Set([evm, pda]);

  it('matches EVM addresses case-insensitively', () => {
    expect(isUniverseExcluded(excluded, evm.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('matches a case-sensitive Solana PDA verbatim (the lowercasing leak)', () => {
    expect(isUniverseExcluded(excluded, pda)).toBe(true);
    expect(excluded.has(pda.toLowerCase())).toBe(false); // old behaviour
  });

  it('does not match unrelated ids', () => {
    expect(isUniverseExcluded(excluded, '0x0000000000000000000000000000000000000001')).toBe(false);
  });
});
