/**
 * Daily trend series for the admin dashboard.
 * Pulls the last N days of platform + provider aggregates so the UI can
 * render an SVG chart without needing a separate time-series store.
 */

import { db, firebaseAvailable } from '../../lib/firebase';

export interface TrendPoint {
  day: string; // YYYY-MM-DD
  costUsd: number;
  calls: number;
  tokensUsed: number;
  revenueUsd: number;
  marginRatio: number;
}

function daysBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function loadRevenueForDay(day: string): Promise<number> {
  if (!firebaseAvailable) return 0;
  const start = `${day}T00:00:00.000Z`;
  const end = `${day}T23:59:59.999Z`;
  try {
    const snap = await db
      .collection('creditPurchases')
      .where('createdAtIso', '>=', start)
      .where('createdAtIso', '<=', end)
      .get();
    let total = 0;
    snap.forEach((d) => {
      const v = Number(d.data().usdAmount ?? 0);
      if (Number.isFinite(v)) total += v;
    });
    return total;
  } catch {
    return 0;
  }
}

export async function getPlatformTrend(days = 30): Promise<TrendPoint[]> {
  const window = Math.min(Math.max(days, 1), 90);
  const series = daysBack(window);
  if (!firebaseAvailable) {
    return series.map((day) => ({
      day,
      costUsd: 0,
      calls: 0,
      tokensUsed: 0,
      revenueUsd: 0,
      marginRatio: 0,
    }));
  }
  // Platform aggregate is sharded since pass-2 — sum across shards per day.
  const { readPlatformAggregateBatch } = await import('./record');
  const [aggs, revenues] = await Promise.all([
    readPlatformAggregateBatch(series),
    Promise.all(series.map(loadRevenueForDay)),
  ]);
  return series.map((day, i) => {
    const { costUsd, calls, tokensUsed } = aggs[i];
    const revenueUsd = revenues[i];
    return {
      day,
      costUsd,
      calls,
      tokensUsed,
      revenueUsd,
      marginRatio: revenueUsd > 0 ? (revenueUsd - costUsd) / revenueUsd : 0,
    };
  });
}
