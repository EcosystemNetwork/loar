// @vitest-environment jsdom
/**
 * Unit tests for the read-only session getters in lib/wallet-auth.ts —
 * localStorage-backed UI hints (the real token lives in an httpOnly cookie).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAuthEmail,
  getAuthProvider,
  getAuthSolanaAddress,
  getSiweAddress,
  getSiweToken,
  hasSession,
} from '../wallet-auth';

beforeEach(() => localStorage.clear());

describe('getSiweAddress / getAuthSolanaAddress / getAuthEmail / getAuthProvider', () => {
  it('return null when unset', () => {
    expect(getSiweAddress()).toBeNull();
    expect(getAuthSolanaAddress()).toBeNull();
    expect(getAuthEmail()).toBeNull();
    expect(getAuthProvider()).toBeNull();
  });

  it('return the stored values', () => {
    localStorage.setItem('siwe-address', '0xabc');
    localStorage.setItem('circle-solana-address', 'SoLaNa123');
    localStorage.setItem('circle-email', 'a@b.com');
    localStorage.setItem('auth-provider', 'circle');
    expect(getSiweAddress()).toBe('0xabc');
    expect(getAuthSolanaAddress()).toBe('SoLaNa123');
    expect(getAuthEmail()).toBe('a@b.com');
    expect(getAuthProvider()).toBe('circle');
  });
});

describe('hasSession', () => {
  it('is false with no address or no expiry', () => {
    expect(hasSession()).toBe(false);
    localStorage.setItem('siwe-address', '0xabc');
    expect(hasSession()).toBe(false); // still no expiry
  });

  it('is true while the expiry is in the future', () => {
    localStorage.setItem('siwe-address', '0xabc');
    localStorage.setItem('siwe-expiry', String(Date.now() + 60_000));
    expect(hasSession()).toBe(true);
  });

  it('is false once the expiry has passed', () => {
    localStorage.setItem('siwe-address', '0xabc');
    localStorage.setItem('siwe-expiry', String(Date.now() - 1));
    expect(hasSession()).toBe(false);
  });

  it('is false for a non-numeric expiry', () => {
    localStorage.setItem('siwe-address', '0xabc');
    localStorage.setItem('siwe-expiry', 'soon');
    expect(hasSession()).toBe(false); // Date.now() < NaN → false
  });
});

describe('getSiweToken (deprecated shim)', () => {
  it('returns a placeholder string while a session is valid, null otherwise', () => {
    expect(getSiweToken()).toBeNull();
    localStorage.setItem('siwe-address', '0xabc');
    localStorage.setItem('siwe-expiry', String(Date.now() + 60_000));
    expect(getSiweToken()).toBe('__httpOnly__');
    localStorage.setItem('siwe-expiry', String(Date.now() - 1));
    expect(getSiweToken()).toBeNull();
  });
});
