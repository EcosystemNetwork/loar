import { describe, it, expect } from 'vitest';
import { buildSharePage, escapeHtml, shareImageUrl, shareStats } from './share';

const base = {
  appUrl: 'https://loar.fun',
  shareUrl: 'https://api.loar.fun/share/token/0xA',
  appPath: '/tokens/0xA',
};

describe('shareImageUrl', () => {
  it('allows https, maps ipfs://, drops everything else', () => {
    expect(shareImageUrl('https://gateway.pinata.cloud/ipfs/Qm1')).toBe(
      'https://gateway.pinata.cloud/ipfs/Qm1'
    );
    expect(shareImageUrl('ipfs://Qm123')).toBe('https://ipfs.io/ipfs/Qm123');
    expect(shareImageUrl('ipfs://ipfs/Qm123')).toBe('https://ipfs.io/ipfs/Qm123');
    expect(shareImageUrl('http://x.com/a.png')).toBeNull();
    expect(shareImageUrl('javascript:alert(1)')).toBeNull();
    expect(shareImageUrl('ipfs://Qm"><script>')).toBeNull();
    expect(shareImageUrl('')).toBeNull();
    expect(shareImageUrl(undefined)).toBeNull();
  });
});

describe('shareStats', () => {
  it('reports mcap and progress for a live curve', () => {
    const s = shareStats({
      ethRaised: '2000000000000000000',
      tokensSold: '200000000000000000000000000',
      graduationEth: '10000000000000000000',
      graduated: false,
    });
    expect(s).toBe('MCap 4.000 ETH · 20% to Uniswap');
  });
  it('handles graduated, missing, and untraded curves', () => {
    expect(
      shareStats({ ethRaised: '1', tokensSold: '1', graduationEth: '1', graduated: true })
    ).toBe('Graduated to Uniswap');
    expect(shareStats(null)).toBe('');
    expect(
      shareStats({
        ethRaised: '0',
        tokensSold: '0',
        graduationEth: '10000000000000000000',
        graduated: false,
      })
    ).toBe('0% to Uniswap');
  });
});

describe('buildSharePage', () => {
  it('emits OG/Twitter tags, the image, and a meta refresh to the app', () => {
    const html = buildSharePage({
      ...base,
      token: {
        id: '0xA',
        name: 'Orange Pills',
        symbol: 'OP',
        imageURL: 'https://x.io/i.png',
        metadata: '{"description":"Hi there"}',
      },
      curve: null,
    });
    expect(html).toContain('<title>$OP — Orange Pills | LOAR Launchpad</title>');
    expect(html).toContain('property="og:image" content="https://x.io/i.png"');
    expect(html).toContain('content="Hi there"');
    expect(html).toContain('http-equiv="refresh" content="0;url=https://loar.fun/tokens/0xA"');
    expect(html).toContain('rel="canonical" href="https://loar.fun/tokens/0xA"');
    expect(html).not.toContain('<script');
  });
  it('escapes hostile token fields so they cannot break out of attributes', () => {
    const html = buildSharePage({
      ...base,
      token: {
        id: '0xA',
        name: '"><script>alert(1)</script>',
        symbol: "x'y",
        imageURL: 'https://x.io/"onerror="alert(1)',
        metadata: '<img src=x onerror=alert(1)>',
      },
      curve: null,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/content="[^"]*"onerror=/);
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('falls back to generic tags for an unknown token', () => {
    const html = buildSharePage({ ...base, token: null, curve: null });
    expect(html).toContain('LOAR Launchpad');
    expect(html).not.toContain('og:image');
  });
});
