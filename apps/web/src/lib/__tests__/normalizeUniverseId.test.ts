import { describe, it, expect } from 'vitest';
import { normalizeUniverseId } from '../utils';

describe('normalizeUniverseId', () => {
  it('lowercases EVM 0x addresses so they match the stored doc id', () => {
    expect(normalizeUniverseId('0x89669812f850f34F907ee9e9009f501d1B008420')).toBe(
      '0x89669812f850f34f907ee9e9009f501d1b008420'
    );
  });

  it('leaves a case-sensitive Solana base58 PDA untouched', () => {
    const pda = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
    expect(normalizeUniverseId(pda)).toBe(pda);
  });

  it('does not lowercase strings that merely start with 0x but are not addresses', () => {
    expect(normalizeUniverseId('0xNotAnAddress')).toBe('0xNotAnAddress');
  });
});
