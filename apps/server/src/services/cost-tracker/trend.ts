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
  const refs = series.map((d) => db.collection('costAggregates').doc(`${d}__platform__all`));
  const [snaps, revenues] = await Promise.all([
    db.getAll(...refs),
    Promise.all(series.map(loadRevenueForDay)),
  ]);
  return series.map((day, i) => {
    const doc = snaps[i];
    const data = doc?.exists ? (doc.data() ?? {}) : {};
    const costUsd = Number(data.costUsd ?? 0);
    const revenueUsd = revenues[i];
    return {
      day,
      costUsd,
      calls: Number(data.calls ?? 0),
      tokensUsed: Number(data.tokensUsed ?? 0),
      revenueUsd,
      marginRatio: revenueUsd > 0 ? (revenueUsd - costUsd) / revenueUsd : 0,
    };
  });
}
