/**
 * Unit tests for the pure analytics reducers in useTokenAnalytics.ts —
 * computePriceStats / computeHolderHistory / computeWhaleFlow. These power
 * the token detail page's deep-analytics panels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeHolderHistory,
  computePriceStats,
  computeWhaleFlow,
  type SeriesPoint,
  type TokenTransferRow,
} from '../useTokenAnalytics';

const NOW = 1_700_000_000; // fixed unix seconds
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

const ZERO = '0x0000000000000000000000000000000000000000';
const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);

const pt = (over: Partial<SeriesPoint>): SeriesPoint => ({
  timestamp: NOW,
  price: 1,
  isBuy: true,
  ethAmount: 1,
  ...over,
});

describe('computePriceStats', () => {
  it('returns an all-null shell for an empty series', () => {
    expect(computePriceStats([])).toEqual({
      ath: null,
      athAt: null,
      atl: null,
      atlAt: null,
      high24h: null,
      low24h: null,
      volumeAllTime: 0,
      avgTradeSize: 0,
      tradeCount: 0,
    });
  });

  it('tracks all-time high/low with their timestamps', () => {
    const s = [
      pt({ price: 2, timestamp: NOW - 100 }),
      pt({ price: 5, timestamp: NOW - 50 }),
      pt({ price: 1, timestamp: NOW - 10 }),
    ];
    const r = computePriceStats(s);
    expect(r.ath).toBe(5);
    expect(r.athAt).toBe(NOW - 50);
    expect(r.atl).toBe(1);
    expect(r.atlAt).toBe(NOW - 10);
  });

  it('only considers points within the last 24h for high24h/low24h', () => {
    const s = [
      pt({ price: 99, timestamp: NOW - 90_000 }), // > 24h ago — ignored for 24h band
      pt({ price: 3, timestamp: NOW - 3600 }),
      pt({ price: 7, timestamp: NOW - 60 }),
    ];
    const r = computePriceStats(s);
    expect(r.high24h).toBe(7);
    expect(r.low24h).toBe(3);
    expect(r.ath).toBe(99); // all-time still sees the old point
  });

  it('sums volume and derives avg trade size + count', () => {
    const s = [pt({ ethAmount: 2 }), pt({ ethAmount: 3 }), pt({ ethAmount: 5 })];
    const r = computePriceStats(s);
    expect(r.volumeAllTime).toBe(10);
    expect(r.avgTradeSize).toBeCloseTo(10 / 3, 6);
    expect(r.tradeCount).toBe(3);
  });
});

const transfer = (
  from: string,
  to: string,
  value: string,
  timestamp: number
): TokenTransferRow => ({
  id: `${from}-${to}-${timestamp}`,
  tokenAddress: '0xtoken',
  from,
  to,
  value,
  timestamp,
  blockNumber: timestamp,
});

const E = (n: number) => (BigInt(n) * 10n ** 18n).toString();

describe('computeHolderHistory', () => {
  it('returns [] for no transfers', () => {
    expect(computeHolderHistory([])).toEqual([]);
  });

  it('counts positive-balance holders, ignoring the zero address on mint/burn', () => {
    const ts = [
      transfer(ZERO, A, E(10), NOW - 7200), // mint to A → 1 holder
      transfer(ZERO, B, E(5), NOW - 5400), // mint to B → 2 holders
      transfer(A, C, E(10), NOW - 3600), // A → C, A now 0 → still 2 holders (B, C)
      transfer(B, ZERO, E(5), NOW - 1800), // burn all of B → 1 holder (C)
    ];
    const hist = computeHolderHistory(ts);
    expect(hist.at(-1)!.holders).toBe(1);
    // one bucket per distinct hour, ascending
    expect(hist.map((p) => p.timestamp)).toEqual(
      [...hist.map((p) => p.timestamp)].sort((a, b) => a - b)
    );
  });

  it('keeps only the last sample within an hour bucket', () => {
    const base = Math.floor((NOW - 10_000) / 3600) * 3600;
    const ts = [
      transfer(ZERO, A, E(1), base + 10),
      transfer(ZERO, B, E(1), base + 20),
      transfer(ZERO, C, E(1), base + 30),
    ];
    const hist = computeHolderHistory(ts);
    expect(hist).toHaveLength(1);
    expect(hist[0].holders).toBe(3); // the last sample of the bucket
  });

  it('skips a transfer with a non-numeric value', () => {
    const ts = [transfer(ZERO, A, 'not-a-number', NOW - 100), transfer(ZERO, B, E(1), NOW - 50)];
    expect(computeHolderHistory(ts).at(-1)!.holders).toBe(1);
  });
});

describe('computeWhaleFlow', () => {
  it('returns [] for no transfers', () => {
    expect(computeWhaleFlow([])).toEqual([]);
  });

  it('nets in/out only within the window, sorts by |net| desc, caps at topN', () => {
    const ts = [
      transfer(ZERO, A, E(100), NOW - 200_000), // outside 24h window
      transfer(A, B, E(40), NOW - 3600), // in window: A out 40, B in 40
      transfer(B, C, E(10), NOW - 1800), // B out 10, C in 10
    ];
    const rows = computeWhaleFlow(ts, 86_400, 8);
    const byAddr = Object.fromEntries(rows.map((r) => [r.address, r]));
    expect(byAddr[A.toLowerCase()].netTokens).toBe(-40);
    expect(byAddr[B.toLowerCase()].netTokens).toBe(30); // 40 in - 10 out
    expect(byAddr[C.toLowerCase()].netTokens).toBe(10);
    // sorted by absolute net flow
    expect(rows[0].address).toBe(A.toLowerCase());
  });

  it('currentTokens reflects the full replay, not just the window', () => {
    const ts = [
      transfer(ZERO, A, E(100), NOW - 500_000), // old mint still affects balance
      transfer(A, B, E(30), NOW - 100),
    ];
    const rows = computeWhaleFlow(ts, 86_400, 8);
    const a = rows.find((r) => r.address === A.toLowerCase())!;
    expect(a.currentTokens).toBeCloseTo(70, 6);
  });

  it('honours topN', () => {
    const ts = Array.from({ length: 12 }, (_, i) =>
      transfer(ZERO, '0x' + String(i).padStart(40, '0'), E(i + 1), NOW - 100)
    );
    expect(computeWhaleFlow(ts, 86_400, 3)).toHaveLength(3);
  });
});
