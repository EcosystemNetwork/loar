/**
 * Unit tests for the small pure formatters exported alongside hooks:
 * useEthUsd (formatUsd / formatEth), useAddressIdentity (shortAddress),
 * useHlsVideo (isHlsUrl).
 */
import { describe, expect, it } from 'vitest';
import { formatEth, formatUsd } from '../useEthUsd';
import { shortAddress } from '../useAddressIdentity';
import { isHlsUrl } from '../useHlsVideo';

describe('formatUsd', () => {
  it('renders a plain currency string with 2 dp by default', () => {
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('uses 4 dp for sub-cent amounts', () => {
    expect(formatUsd(0.0031)).toBe('$0.0031');
  });

  it('compact mode abbreviates ≥10K and ≥1M', () => {
    expect(formatUsd(15_000, { compact: true })).toBe('$15.0K');
    expect(formatUsd(2_400_000, { compact: true })).toBe('$2.40M');
  });

  it('compact mode leaves values under 10K as plain currency', () => {
    expect(formatUsd(9_999, { compact: true })).toBe('$9,999.00');
  });
});

describe('formatEth', () => {
  it('returns "0" for exactly zero', () => {
    expect(formatEth(0)).toBe('0');
  });

  it('scales precision with magnitude', () => {
    expect(formatEth(0.00001)).toBe('0.000010'); // < 0.0001 → 6 dp
    expect(formatEth(0.25)).toBe('0.2500'); // < 1 → 4 dp
    expect(formatEth(12.3456)).toBe('12.346'); // ≥ 1 → 3 dp
  });

  it('honours an explicit decimals option', () => {
    expect(formatEth(1.23456, { decimals: 2 })).toBe('1.23');
  });
});

describe('shortAddress', () => {
  it('truncates a long address with an ellipsis', () => {
    const a = '0x' + 'a'.repeat(40);
    expect(shortAddress(a)).toBe(`0xaaaa…aaaa`);
  });

  it('respects custom head/tail lengths', () => {
    const a = '0x1234567890abcdef';
    expect(shortAddress(a, 4, 3)).toBe('0x12…def');
  });

  it('returns "" for undefined and leaves a short string alone', () => {
    expect(shortAddress(undefined)).toBe('');
    expect(shortAddress('0xabc')).toBe('0xabc');
  });
});

describe('isHlsUrl', () => {
  it('is true for an .m3u8 URL (with or without query/hash)', () => {
    expect(isHlsUrl('https://cdn/x.m3u8')).toBe(true);
    expect(isHlsUrl('https://cdn/x.m3u8?token=1')).toBe(true);
    expect(isHlsUrl('https://cdn/x.M3U8#t=3')).toBe(true);
  });

  it('is false for non-HLS / empty / nullish', () => {
    expect(isHlsUrl('https://cdn/x.mp4')).toBe(false);
    expect(isHlsUrl('https://cdn/m3u8-not-really')).toBe(false);
    expect(isHlsUrl('')).toBe(false);
    expect(isHlsUrl(null)).toBe(false);
    expect(isHlsUrl(undefined)).toBe(false);
  });
});
