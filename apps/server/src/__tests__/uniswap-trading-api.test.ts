/**
 * Safety-gate tests for the Uniswap Trading API adapter. These cover the
 * pre-signing invariants that protect the custodial Circle wallet — the
 * server signs whatever calldata the Trading API returns, so these gates are
 * the last line of defense against a malformed/compromised response.
 */
import { describe, it, expect } from 'vitest';
import { assertSwapTxSafe, isKnownRouter, isNativeToken } from '../lib/uniswap-trading-api';

const SEPOLIA = 11155111;
const UR_SEPOLIA = '0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b';
const ONE_ETH = '1000000000000000000';

describe('isNativeToken', () => {
  it('matches the zero address case-insensitively', () => {
    expect(isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true);
    expect(isNativeToken('0x0000000000000000000000000000000000000000'.toUpperCase())).toBe(true);
    expect(isNativeToken('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984')).toBe(false);
  });
});

describe('isKnownRouter', () => {
  it('recognizes the seeded Universal Routers', () => {
    expect(isKnownRouter(SEPOLIA, UR_SEPOLIA)).toBe(true);
    expect(isKnownRouter(SEPOLIA, UR_SEPOLIA.toUpperCase())).toBe(true);
    expect(isKnownRouter(1, '0x66a9893cc07d91d95644aedd05d03f95e1dba8af')).toBe(true);
  });
  it('rejects unknown targets and unknown chains', () => {
    expect(isKnownRouter(SEPOLIA, '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(false);
    expect(isKnownRouter(999, UR_SEPOLIA)).toBe(false);
  });
});

describe('assertSwapTxSafe', () => {
  it('accepts a native-ETH swap whose value equals the authorized amount', () => {
    const v = assertSwapTxSafe({
      chainId: SEPOLIA,
      nativeIn: true,
      type: 'EXACT_INPUT',
      to: UR_SEPOLIA,
      value: '0xde0b6b3a7640000', // 1 ETH in hex
      amount: ONE_ETH,
    });
    expect(v).toBe(ONE_ETH);
  });

  it('rejects a swap to an unknown router', () => {
    expect(() =>
      assertSwapTxSafe({
        chainId: SEPOLIA,
        nativeIn: true,
        type: 'EXACT_INPUT',
        to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        value: ONE_ETH,
        amount: ONE_ETH,
      })
    ).toThrow(/not a known Uniswap router/);
  });

  it('rejects a native swap that tries to send more than authorized', () => {
    expect(() =>
      assertSwapTxSafe({
        chainId: SEPOLIA,
        nativeIn: true,
        type: 'EXACT_INPUT',
        to: UR_SEPOLIA,
        value: '2000000000000000000', // 2 ETH != 1 ETH authorized
        amount: ONE_ETH,
      })
    ).toThrow(/!= authorized amount/);
  });

  it('rejects an ERC20 swap that carries native value', () => {
    expect(() =>
      assertSwapTxSafe({
        chainId: SEPOLIA,
        nativeIn: false,
        type: 'EXACT_INPUT',
        to: UR_SEPOLIA,
        value: ONE_ETH,
        amount: ONE_ETH,
      })
    ).toThrow(/non-zero native value/);
  });

  it('allows an ERC20 swap with zero/absent native value', () => {
    expect(
      assertSwapTxSafe({
        chainId: SEPOLIA,
        nativeIn: false,
        type: 'EXACT_INPUT',
        to: UR_SEPOLIA,
        value: undefined,
        amount: ONE_ETH,
      })
    ).toBeUndefined();
  });
});
