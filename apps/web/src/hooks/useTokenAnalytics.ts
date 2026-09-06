/**
 * useTokenAnalytics — deeper per-token analytics for the token detail page.
 *
 * These hooks read entities the launchpad list doesn't touch:
 *   - `bondingCurveSnapshot`  → real pre-graduation price/volume history
 *   - `bondingCurveTrade`      → per-trade feed while on the curve
 *   - `tokenTransfer`          → holder-count-over-time + whale net flow
 *
 * Everything degrades to an empty result when the indexer is offline or the
 * schema predates a table (older Sepolia deployments), so callers can render a
 * "no data yet" state instead of erroring.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ponderGql, ponderQueryDefaults, type Swap } from '@/utils/ponder-api';
import { jitteredInterval, POLL_INTERVALS } from './useSmartPolling';
import { ethPriceFromTick, weiToNumber, type BondingCurveTrade } from './useTokens';

// ─── Types ────────────────────────────────────────────────────────────

/** One point on a unified price/volume series. Matches CandlestickChart's input. */
export interface SeriesPoint {
  timestamp: number;
  price: number; // ETH per token
  isBuy: boolean;
  ethAmount: number; // absolute ETH moved by this event
}

export interface BondingCurveSnapshotRow {
  id: string;
  bondingCurve: string;
  blockNumber: number;
  timestamp: number;
  tokensSold: string;
  ethRaised: string;
  price: string;
  trigger: 'buy' | 'sell' | 'graduate' | string;
}

export interface TokenTransferRow {
  id: string;
  tokenAddress: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  blockNumber: number;
}

// ─── Bonding-curve price/volume snapshots ─────────────────────────────

export function useBondingCurveSnapshots(bondingCurveId: string | undefined) {
  return useQuery({
    queryKey: ['bonding-curve-snapshots', bondingCurveId?.toLowerCase()],
    queryFn: async (): Promise<BondingCurveSnapshotRow[]> => {
      try {
        const data = await ponderGql<{
          bondingCurveSnapshots: { items: BondingCurveSnapshotRow[] };
        }>(
          `query ($curve: String!) {
            bondingCurveSnapshots(
              where: { bondingCurve: $curve }
              orderBy: "blockNumber"
              orderDirection: "asc"
              limit: 1000
            ) {
              items { id bondingCurve blockNumber timestamp tokensSold ethRaised price trigger }
            }
          }`,
          { curve: bondingCurveId!.toLowerCase() }
        );
        return data.bondingCurveSnapshots?.items ?? [];
      } catch {
        return [];
      }
    },
    enabled: !!bondingCurveId,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

// ─── Per-trade bonding-curve feed for one curve ──────────────────────

export function useBondingCurveTradesForCurve(bondingCurveId: string | undefined, limit = 500) {
  return useQuery({
    queryKey: ['bonding-curve-trades-for-curve', bondingCurveId?.toLowerCase(), limit],
    queryFn: async (): Promise<BondingCurveTrade[]> => {
      try {
        const data = await ponderGql<{
          bondingCurveTrades: { items: BondingCurveTrade[] };
        }>(
          `query ($curve: String!, $limit: Int!) {
            bondingCurveTrades(
              where: { bondingCurve: $curve }
              orderBy: "timestamp"
              orderDirection: "desc"
              limit: $limit
            ) {
              items { id bondingCurve trader isBuy ethAmount tokenAmount price timestamp }
            }
          }`,
          { curve: bondingCurveId!.toLowerCase(), limit }
        );
        return data.bondingCurveTrades?.items ?? [];
      } catch {
        return [];
      }
    },
    enabled: !!bondingCurveId,
    ...ponderQueryDefaults,
    refetchInterval: jitteredInterval(POLL_INTERVALS.MODERATE),
  });
}

// ─── Token transfers (holder-count history + whale flow) ─────────────

export function useTokenTransfers(tokenAddress: string | undefined, limit = 1000) {
  return useQuery({
    queryKey: ['token-transfers', tokenAddress?.toLowerCase(), limit],
    queryFn: async (): Promise<TokenTransferRow[]> => {
      try {
        const data = await ponderGql<{
          tokenTransfers: { items: TokenTransferRow[] };
        }>(
          `query ($token: String!, $limit: Int!) {
            tokenTransfers(
              where: { tokenAddress: $token }
              orderBy: "timestamp"
              orderDirection: "asc"
              limit: $limit
            ) {
              items { id tokenAddress from to value timestamp blockNumber }
            }
          }`,
          { token: tokenAddress!.toLowerCase(), limit }
        );
        return data.tokenTransfers?.items ?? [];
      } catch {
        return [];
      }
    },
    enabled: !!tokenAddress,
    ...ponderQueryDefaults,
  });
}

// ─── Unified price/volume series ─────────────────────────────────────

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

/**
 * Merge pre-graduation bonding-curve snapshots with post-graduation Uniswap v4
 * swaps into a single time-ordered series for the candlestick chart. Falls back
 * to swaps-only (current behaviour) when there are no snapshots.
 */
export function usePriceSeries({
  bondingCurveId,
  swaps,
  tokenIsCurrency0,
}: {
  bondingCurveId: string | undefined;
  swaps: Swap[] | undefined;
  tokenIsCurrency0: boolean;
}): { data: SeriesPoint[]; isLoading: boolean } {
  const snapshotsQuery = useBondingCurveSnapshots(bondingCurveId);

  const data = useMemo<SeriesPoint[]>(() => {
    const points: SeriesPoint[] = [];

    // 1) Bonding-curve snapshots — one point per price-moving event. Volume for
    //    a point is the change in cumulative ethRaised since the previous one.
    const snaps = snapshotsQuery.data ?? [];
    let prevRaised = 0;
    for (const s of snaps) {
      const raised = weiToNumber(s.ethRaised, 18);
      const vol = Math.abs(raised - prevRaised);
      prevRaised = raised;
      points.push({
        timestamp: s.timestamp,
        price: weiToNumber(s.price, 18),
        isBuy: s.trigger !== 'sell',
        ethAmount: vol,
      });
    }

    // 2) Uniswap v4 swaps — oldest→newest. Skip any that predate the last
    //    snapshot so the two sources don't double-count the graduation seed.
    const lastSnapTs = snaps.length ? snaps[snaps.length - 1].timestamp : 0;
    const orderedSwaps = (swaps ?? []).slice().reverse();
    for (const s of orderedSwaps) {
      if (s.timestamp < lastSnapTs) continue;
      const ethSigned = tokenIsCurrency0 ? BigInt(s.amount1) : BigInt(s.amount0);
      const ethAbs = ethSigned < 0n ? -ethSigned : ethSigned;
      points.push({
        timestamp: s.timestamp,
        price: ethPriceFromTick(s.tick, tokenIsCurrency0),
        isBuy: ethSigned > 0n,
        ethAmount: weiToNumber(ethAbs, 18),
      });
    }

    points.sort((a, b) => a.timestamp - b.timestamp);
    return points.filter((p) => Number.isFinite(p.price) && p.price > 0);
  }, [snapshotsQuery.data, swaps, tokenIsCurrency0]);

  return { data, isLoading: snapshotsQuery.isLoading };
}

// ─── Derived stats from a series ────────────────────────────────────

export interface TokenPriceStats {
  ath: number | null;
  athAt: number | null;
  atl: number | null;
  atlAt: number | null;
  high24h: number | null;
  low24h: number | null;
  volumeAllTime: number;
  avgTradeSize: number;
  tradeCount: number;
}

export function computePriceStats(series: SeriesPoint[]): TokenPriceStats {
  if (!series.length) {
    return {
      ath: null,
      athAt: null,
      atl: null,
      atlAt: null,
      high24h: null,
      low24h: null,
      volumeAllTime: 0,
      avgTradeSize: 0,
      tradeCount: 0,
    };
  }
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  let ath = -Infinity;
  let athAt: number | null = null;
  let atl = Infinity;
  let atlAt: number | null = null;
  let high24h = -Infinity;
  let low24h = Infinity;
  let volumeAllTime = 0;
  for (const p of series) {
    if (p.price > ath) {
      ath = p.price;
      athAt = p.timestamp;
    }
    if (p.price < atl) {
      atl = p.price;
      atlAt = p.timestamp;
    }
    if (p.timestamp >= dayAgo) {
      if (p.price > high24h) high24h = p.price;
      if (p.price < low24h) low24h = p.price;
    }
    volumeAllTime += p.ethAmount;
  }
  return {
    ath: ath === -Infinity ? null : ath,
    athAt,
    atl: atl === Infinity ? null : atl,
    atlAt,
    high24h: high24h === -Infinity ? null : high24h,
    low24h: low24h === Infinity ? null : low24h,
    volumeAllTime,
    avgTradeSize: series.length ? volumeAllTime / series.length : 0,
    tradeCount: series.length,
  };
}

// ─── Holder count over time ────────────────────────────────────────

export interface HolderCountPoint {
  timestamp: number;
  holders: number;
}

/**
 * Reconstruct the holder count over time by replaying transfers and tracking
 * which addresses hold a positive balance. Mint (`from` == 0x0) and burn
 * (`to` == 0x0) are handled; the returned series has one point per transfer
 * (deduped to the last point per hour to keep it light).
 */
export function computeHolderHistory(transfers: TokenTransferRow[]): HolderCountPoint[] {
  if (!transfers.length) return [];
  const bal = new Map<string, bigint>();
  const raw: HolderCountPoint[] = [];
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    let v: bigint;
    try {
      v = BigInt(t.value);
    } catch {
      continue;
    }
    if (from !== ZERO_ADDR) bal.set(from, (bal.get(from) ?? 0n) - v);
    if (to !== ZERO_ADDR) bal.set(to, (bal.get(to) ?? 0n) + v);
    let holders = 0;
    for (const b of bal.values()) if (b > 0n) holders++;
    raw.push({ timestamp: t.timestamp, holders });
  }
  // Keep the last sample per hour bucket.
  const byBucket = new Map<number, HolderCountPoint>();
  for (const p of raw) byBucket.set(Math.floor(p.timestamp / 3600) * 3600, p);
  return Array.from(byBucket.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Whale flow (net position change over a window) ────────────────

export interface WhaleFlowRow {
  address: string;
  inTokens: number; // received in window
  outTokens: number; // sent in window
  netTokens: number;
  currentTokens: number; // best-effort running balance from replayed transfers
}

export function computeWhaleFlow(
  transfers: TokenTransferRow[],
  windowSeconds = 86400,
  topN = 8
): WhaleFlowRow[] {
  if (!transfers.length) return [];
  const since = Math.floor(Date.now() / 1000) - windowSeconds;
  const bal = new Map<string, number>();
  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    const v = weiToNumber(t.value, 18);
    if (from !== ZERO_ADDR) bal.set(from, (bal.get(from) ?? 0) - v);
    if (to !== ZERO_ADDR) bal.set(to, (bal.get(to) ?? 0) + v);
    if (t.timestamp >= since) {
      if (to !== ZERO_ADDR) inMap.set(to, (inMap.get(to) ?? 0) + v);
      if (from !== ZERO_ADDR) outMap.set(from, (outMap.get(from) ?? 0) + v);
    }
  }
  const addrs = new Set<string>([...inMap.keys(), ...outMap.keys()]);
  const rows: WhaleFlowRow[] = [];
  for (const a of addrs) {
    const inTokens = inMap.get(a) ?? 0;
    const outTokens = outMap.get(a) ?? 0;
    rows.push({
      address: a,
      inTokens,
      outTokens,
      netTokens: inTokens - outTokens,
      currentTokens: bal.get(a) ?? 0,
    });
  }
  rows.sort((a, b) => Math.abs(b.netTokens) - Math.abs(a.netTokens));
  return rows.slice(0, topN);
}

// ─── Trader leaderboard for one token ─────────────────────────────

export interface TraderStatRow {
  address: string;
  boughtEth: number;
  soldEth: number;
  boughtTokens: number;
  soldTokens: number;
  trades: number;
  avgBuyPrice: number;
  realizedPnL: number; // soldEth - soldTokens * avgBuyPrice
  volumeEth: number;
}

/**
 * Aggregate a token's bonding-curve trades + Uniswap swaps by trader into a
 * realized-PnL leaderboard. `tokenIsCurrency0` picks the ETH leg of each swap.
 */
export function computeTraderLeaderboard({
  bondingTrades,
  swaps,
  tokenIsCurrency0,
}: {
  bondingTrades: BondingCurveTrade[];
  swaps: Swap[];
  tokenIsCurrency0: boolean;
}): TraderStatRow[] {
  interface Agg {
    boughtEth: number;
    soldEth: number;
    boughtTokens: number;
    soldTokens: number;
    trades: number;
  }
  const agg = new Map<string, Agg>();
  const ensure = (a: string) => {
    if (!agg.has(a))
      agg.set(a, { boughtEth: 0, soldEth: 0, boughtTokens: 0, soldTokens: 0, trades: 0 });
    return agg.get(a)!;
  };

  for (const t of bondingTrades) {
    const a = ensure(t.trader.toLowerCase());
    const eth = weiToNumber(t.ethAmount, 18);
    const tok = weiToNumber(t.tokenAmount, 18);
    if (t.isBuy) {
      a.boughtEth += eth;
      a.boughtTokens += tok;
    } else {
      a.soldEth += eth;
      a.soldTokens += tok;
    }
    a.trades++;
  }

  for (const s of swaps) {
    const a = ensure(s.sender.toLowerCase());
    const ethSigned = tokenIsCurrency0 ? BigInt(s.amount1) : BigInt(s.amount0);
    const tokSigned = tokenIsCurrency0 ? BigInt(s.amount0) : BigInt(s.amount1);
    const ethAbs = weiToNumber(ethSigned < 0n ? -ethSigned : ethSigned, 18);
    const tokAbs = weiToNumber(tokSigned < 0n ? -tokSigned : tokSigned, 18);
    if (ethSigned > 0n) {
      a.boughtEth += ethAbs;
      a.boughtTokens += tokAbs;
    } else if (ethSigned < 0n) {
      a.soldEth += ethAbs;
      a.soldTokens += tokAbs;
    }
    a.trades++;
  }

  const rows: TraderStatRow[] = [];
  for (const [address, a] of agg) {
    const avgBuyPrice = a.boughtTokens > 0 ? a.boughtEth / a.boughtTokens : 0;
    rows.push({
      address,
      boughtEth: a.boughtEth,
      soldEth: a.soldEth,
      boughtTokens: a.boughtTokens,
      soldTokens: a.soldTokens,
      trades: a.trades,
      avgBuyPrice,
      realizedPnL: a.soldEth - a.soldTokens * avgBuyPrice,
      volumeEth: a.boughtEth + a.soldEth,
    });
  }
  rows.sort((a, b) => b.volumeEth - a.volumeEth);
  return rows;
}
