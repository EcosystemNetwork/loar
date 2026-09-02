import { describe, it, expect } from 'vitest';
import { normalizeUniverseId, isEvmAddress } from '../lib/universe-id';

describe('normalizeUniverseId', () => {
  it('lowercases a mixed-case EVM address (case-insensitive, stored lowercased)', () => {
    expect(normalizeUniverseId('0x89669812f850f34F907ee9e9009f501d1B008420')).toBe(
      '0x89669812f850f34f907ee9e9009f501d1b008420'
    );
  });

  it('leaves a case-sensitive Solana base58 PDA verbatim', () => {
    const pda = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
    expect(normalizeUniverseId(pda)).toBe(pda);
  });

  it('only treats a full 0x + 40-hex string as an EVM address', () => {
    expect(normalizeUniverseId('0xABC')).toBe('0xABC');
    expect(isEvmAddress('0xABC')).toBe(false);
    expect(isEvmAddress('0x89669812f850f34F907ee9e9009f501d1B008420')).toBe(true);
    expect(isEvmAddress('H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL')).toBe(false);
  });
});
