import { describe, it, expect } from 'vitest';
import { buildLaunchpadRows, parseMetadata, safeImageUrl } from './launchpad';

const CURVE = '0xc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1';
const ZP = '0x' + '0'.repeat(64);
const tok = (id: string, over = {}) => ({
  id,
  name: id,
  symbol: 'S' + id.slice(-2),
  imageURL: '',
  metadata: '',
  deployer: '0xd',
  poolId: ZP,
  createdAt: 100,
  ...over,
});
const curve = (tokenAddress: string, over = {}) => ({
  id: CURVE,
  tokenAddress,
  graduationEth: '10000000000000000000',
  graduated: false,
  tradingStatus: 'active',
  tokensSold: '200000000000000000000000000',
  ethRaised: '2000000000000000000',
  ...over,
});

describe('buildLaunchpadRows', () => {
  it('prices a bonding token from raised/sold (not the contract price field) and marks the king', () => {
    const [r] = buildLaunchpadRows({
      tokens: [tok('0xaa')],
      curves: [curve('0xaa')],
      holders: [],
      pools: [],
    });
    expect(r.stage).toBe('bonding');
    expect(r.price).toBeCloseTo(2e-8, 12);
    expect(r.marketCap).toBeCloseTo(4, 6);
    expect(r.graduationPct).toBe(20);
    expect(r.isKing).toBe(true);
  });
  it('classifies stages and only crowns a live curve token', () => {
    const rows = buildLaunchpadRows({
      tokens: [tok('0x01'), tok('0x02'), tok('0x03'), tok('0x04')],
      curves: [
        curve('0x01', { ethRaised: '8000000000000000000' }), // 80% → graduating
        curve('0x02', {
          graduated: true,
          tradingStatus: 'graduated',
          ethRaised: '99000000000000000000',
        }),
        curve('0x03', { tradingStatus: 'halted', ethRaised: '9000000000000000000' }),
      ],
      holders: [],
      pools: [],
    });
    expect(rows.map((r) => r.stage)).toEqual(['graduating', 'graduated', 'halted', 'graduated']); // 0x04 has no curve
    expect(rows.filter((r) => r.isKing).map((r) => r.id)).toEqual(['0x01']);
    expect(rows[2].isKing).toBe(false);
  });
  it('counts holders without zero balances or the curve contract', () => {
    const [r] = buildLaunchpadRows({
      tokens: [tok('0xaa')],
      curves: [curve('0xaa')],
      holders: [
        {
          tokenAddress: '0xAA',
          holderAddress: CURVE.toUpperCase().replace('0X', '0x'),
          balance: '800',
        },
        { tokenAddress: '0xaa', holderAddress: '0x1', balance: '5' },
        { tokenAddress: '0xaa', holderAddress: '0x2', balance: '0' },
      ],
      pools: [],
    });
    expect(r.holderCount).toBe(1);
  });
  it('prices a graduated token from its pool, either side of the pair', () => {
    const P = '0x' + 'b1'.repeat(32);
    const sqrt = '79228162514264337593543950'; // price 1e-6 (currency1 per currency0)
    const t = tok('0xbb', { poolId: P });
    const asC0 = buildLaunchpadRows({
      tokens: [t],
      curves: [],
      holders: [],
      pools: [{ poolId: P, currency0: '0xbb', sqrtPriceX96: sqrt }],
    })[0];
    const asC1 = buildLaunchpadRows({
      tokens: [t],
      curves: [],
      holders: [],
      pools: [{ poolId: P, currency0: '0xweth', sqrtPriceX96: sqrt }],
    })[0];
    expect(asC0.price).toBeCloseTo(1e-6, 9);
    expect(asC1.price).toBeCloseTo(1e6, 0);
    expect(asC0.stage).toBe('graduated');
  });
  it('has no price before the first trade', () => {
    const [r] = buildLaunchpadRows({
      tokens: [tok('0xaa')],
      curves: [curve('0xaa', { ethRaised: '0', tokensSold: '0' })],
      holders: [],
      pools: [],
    });
    expect(r.price).toBeNull();
    expect(r.marketCap).toBeNull();
    expect(r.isKing).toBe(false);
  });
});

describe('metadata + images', () => {
  it('parses JSON and legacy metadata, dropping unsafe links', () => {
    expect(parseMetadata('Governance token for X')).toEqual({
      description: 'Governance token for X',
      socials: {},
    });
    const m = parseMetadata(
      JSON.stringify({
        description: 'hi',
        socials: {
          website: 'https://loar.fun',
          twitter: 'https://evil.com/x',
          telegram: 'javascript:1',
        },
      })
    );
    expect(m.description).toBe('hi');
    expect(m.socials.website).toBe('https://loar.fun/');
    expect(m.socials.twitter).toBeUndefined();
    expect(m.socials.telegram).toBeUndefined();
  });
  it('only allows https / ipfs images', () => {
    expect(safeImageUrl('ipfs://Qm1')).toBe('https://ipfs.io/ipfs/Qm1');
    expect(safeImageUrl('https://a.io/i.png')).toBe('https://a.io/i.png');
    expect(safeImageUrl('http://a.io/i.png')).toBeNull();
    expect(safeImageUrl('javascript:1')).toBeNull();
    expect(safeImageUrl('')).toBeNull();
  });
});
