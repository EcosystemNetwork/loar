import { describe, it, expect } from 'vitest';
import { tokenIdCandidates } from '../useTokens';

// The indexer keys tokens by checksummed address and matches ids case-sensitively,
// so a lowercased lookup silently returns null ("Token Not Found" on the launchpad).
const CHECKSUM = '0x9844f10D961Aa31e5aba63c98D74Eca49501707e';

describe('tokenIdCandidates', () => {
  it('leads with the checksummed address for a lowercase input', () => {
    expect(tokenIdCandidates(CHECKSUM.toLowerCase())[0]).toBe(CHECKSUM);
  });

  it('keeps the checksummed form first and de-duplicates', () => {
    expect(tokenIdCandidates(CHECKSUM)).toEqual([CHECKSUM, CHECKSUM.toLowerCase()]);
  });

  it('falls back to as-given and lowercase for non-hex ids', () => {
    expect(tokenIdCandidates('SoLaNaPda')).toEqual(['SoLaNaPda', 'solanapda']);
  });
});
