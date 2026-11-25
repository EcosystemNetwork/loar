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

describe('buildUniverseSharePage', () => {
  const ubase = {
    appUrl: 'https://loar.fun',
    shareUrl: 'https://loar.fun/share/universe/0xabc',
    appPath: '/universe/0xabc/watch',
  };
  it('renders escaped title, description and image, and redirects to watch', async () => {
    const { buildUniverseSharePage } = await import('./share');
    const html = buildUniverseSharePage({
      ...ubase,
      universe: {
        id: '0xabc',
        name: 'Void <b>Saga</b>',
        description: 'A "dark" tale',
        image_url: 'https://cdn.example/x.png',
      },
    });
    expect(html).toContain('<title>Void &lt;b&gt;Saga&lt;/b&gt; | LOAR</title>');
    expect(html).toContain('content="A &quot;dark&quot; tale"');
    expect(html).toContain('og:image" content="https://cdn.example/x.png"');
    expect(html).toContain('url=https://loar.fun/universe/0xabc/watch');
    expect(html).not.toContain('<b>');
  });
  it('never leaks private or hidden universes and falls back to the site card', async () => {
    const { buildUniverseSharePage } = await import('./share');
    for (const flag of [{ isPrivate: true }, { isHidden: true }]) {
      const html = buildUniverseSharePage({
        ...ubase,
        universe: { id: '0xabc', name: 'Secret', description: 'shh', ...flag },
      });
      expect(html).not.toContain('Secret');
      expect(html).not.toContain('shh');
      expect(html).toContain('https://loar.fun/og-image.png');
    }
  });
});

describe('buildEpisodeSharePage', () => {
  const ebase = {
    appUrl: 'https://loar.fun',
    shareUrl: 'https://loar.fun/share/episode/ep1',
    appPath: '/episode/ep1',
  };
  const universe = { id: '0xabc', name: 'Void Saga', image_url: 'https://cdn.example/u.png' };
  it('renders a canon episode with its universe and redirects to the episode', async () => {
    const { buildEpisodeSharePage } = await import('./share');
    const html = buildEpisodeSharePage({
      ...ebase,
      universe,
      episode: { id: 'ep1', title: 'Ep 1 <x>', isCanon: true, universeId: '0xabc' },
    });
    expect(html).toContain('<title>Ep 1 &lt;x&gt; — Void Saga | LOAR</title>');
    expect(html).toContain('og:image" content="https://cdn.example/u.png"');
    expect(html).toContain('url=https://loar.fun/episode/ep1');
  });
  it('never leaks drafts or episodes of private/hidden universes', async () => {
    const { buildEpisodeSharePage } = await import('./share');
    const cases = [
      { universe, episode: { id: 'ep1', title: 'Draft', isCanon: false, universeId: '0xabc' } },
      {
        universe: { ...universe, isPrivate: true },
        episode: { id: 'ep1', title: 'Draft', isCanon: true, universeId: '0xabc' },
      },
      {
        universe: { ...universe, isHidden: true },
        episode: { id: 'ep1', title: 'Draft', isCanon: true, universeId: '0xabc' },
      },
    ];
    for (const c of cases) {
      const html = buildEpisodeSharePage({ ...ebase, ...c });
      expect(html).not.toContain('Draft');
      expect(html).not.toContain('Void Saga');
      expect(html).toContain('https://loar.fun/og-image.png');
    }
  });
});

describe('buildUniverseSitemap', () => {
  it('lists only public universes with safe ids, lowercasing EVM ids', async () => {
    const { buildUniverseSitemap } = await import('./share');
    const xml = buildUniverseSitemap('https://loar.fun', [
      { id: '0xABCDEF0123456789abcdef0123456789ABCDEF01' },
      { id: '0x1111111111111111111111111111111111111111', isPrivate: true },
      { id: '0x2222222222222222222222222222222222222222', isHidden: true },
      { id: '../etc/passwd' },
    ]);
    expect(xml).toContain(
      'https://loar.fun/universe/0xabcdef0123456789abcdef0123456789abcdef01/watch'
    );
    expect(xml).not.toContain('0x1111');
    expect(xml).not.toContain('0x2222');
    expect(xml).not.toContain('passwd');
  });
});
