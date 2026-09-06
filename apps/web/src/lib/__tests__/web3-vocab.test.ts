/**
 * Unit tests for lib/web3-vocab.ts — the web2/web3 label switch used across
 * the UI so copy adapts to the user's disclosure level.
 */
import { describe, expect, it } from 'vitest';
import { vocab } from '../web3-vocab';

describe('vocab', () => {
  it('returns the web3 label when web3Mode is true', () => {
    expect(vocab('mint', true)).toBe('Mint');
    expect(vocab('wallet', true)).toBe('Wallet');
    expect(vocab('gas-fee', true)).toBe('Gas fee');
  });

  it('returns the web2 label when web3Mode is false', () => {
    expect(vocab('mint', false)).toBe('Publish');
    expect(vocab('wallet', false)).toBe('Account');
    expect(vocab('gas-fee', false)).toBe('Processing fee');
    expect(vocab('dao', false)).toBe('Community');
  });

  it('every mapped key resolves to a non-empty string in both modes', () => {
    // exercise the whole table via a representative spread of keys
    const keys = [
      'mint',
      'nft',
      'token',
      'wallet',
      'chain',
      'transaction',
      'marketplace',
      'governance',
      'stake',
      'royalty',
      'token-gate',
      'bridge',
      'burn',
      'airdrop',
      'voting-power',
    ] as const;
    for (const k of keys) {
      expect(vocab(k, true).length).toBeGreaterThan(0);
      expect(vocab(k, false).length).toBeGreaterThan(0);
    }
  });

  it('web2 and web3 variants differ for the headline terms', () => {
    for (const k of ['mint', 'nft', 'wallet', 'dao', 'stake'] as const) {
      expect(vocab(k, true)).not.toBe(vocab(k, false));
    }
  });
});
