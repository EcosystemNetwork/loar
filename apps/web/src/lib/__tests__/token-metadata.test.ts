import { describe, it, expect } from 'vitest';
import {
  encodeTokenMetadata,
  normalizeSocial,
  parseTokenMetadata,
  tokenDescription,
} from '../token-metadata';

describe('normalizeSocial', () => {
  it('turns bare handles into canonical urls', () => {
    expect(normalizeSocial('twitter', '@loar')).toBe('https://x.com/loar');
    expect(normalizeSocial('twitter', 'loar')).toBe('https://x.com/loar');
    expect(normalizeSocial('telegram', 'loarchat')).toBe('https://t.me/loarchat');
  });
  it('accepts urls on the right host only', () => {
    expect(normalizeSocial('twitter', 'https://twitter.com/loar')).toBe('https://twitter.com/loar');
    expect(normalizeSocial('twitter', 'https://evil.com/loar')).toBeNull();
    expect(normalizeSocial('telegram', 'https://x.com/loar')).toBeNull();
  });
  it('prefixes https for websites and rejects non-https / dangerous schemes', () => {
    expect(normalizeSocial('website', 'loar.fun')).toBe('https://loar.fun/');
    expect(normalizeSocial('website', 'http://loar.fun')).toBeNull();
    expect(normalizeSocial('website', 'javascript:alert(1)')).toBeNull();
    expect(normalizeSocial('website', 'data:text/html,hi')).toBeNull();
    expect(normalizeSocial('website', 'https://user:pw@loar.fun')).toBeNull();
    expect(normalizeSocial('website', 'localhost')).toBeNull();
  });
  it('rejects empty and over-long input', () => {
    expect(normalizeSocial('website', '  ')).toBeNull();
    expect(normalizeSocial('website', 'https://a.com/' + 'x'.repeat(250))).toBeNull();
  });
});

describe('encode/parse round trip', () => {
  it('round-trips description + socials', () => {
    const enc = encodeTokenMetadata({
      description: ' Hello ',
      socials: { twitter: '@loar', website: 'loar.fun', telegram: '' },
    });
    const p = parseTokenMetadata(enc);
    expect(p.description).toBe('Hello');
    expect(p.socials).toEqual({ twitter: 'https://x.com/loar', website: 'https://loar.fun/' });
  });
  it('encodes to empty string when there is nothing to store', () => {
    expect(encodeTokenMetadata({})).toBe('');
    expect(encodeTokenMetadata({ description: '  ', socials: { twitter: 'bad host!' } })).toBe('');
  });
  it('drops invalid socials at encode time', () => {
    const enc = encodeTokenMetadata({ description: 'x', socials: { website: 'javascript:1' } });
    expect(JSON.parse(enc)).toEqual({ description: 'x' });
  });
});

describe('parseTokenMetadata', () => {
  it('treats legacy plain text as the description', () => {
    expect(parseTokenMetadata('Governance token for Orange Pills')).toEqual({
      description: 'Governance token for Orange Pills',
      socials: {},
    });
    expect(tokenDescription('Governance token for X')).toBe('Governance token for X');
  });
  it('never throws on garbage and never yields unsafe urls from hostile json', () => {
    expect(parseTokenMetadata('{not json').description).toBe('{not json');
    const hostile = JSON.stringify({
      description: 5,
      socials: { website: 'javascript:alert(1)', twitter: 'https://evil.com/x', telegram: 7 },
    });
    expect(parseTokenMetadata(hostile)).toEqual({ description: '', socials: {} });
    expect(parseTokenMetadata(null)).toEqual({ description: '', socials: {} });
  });
});
