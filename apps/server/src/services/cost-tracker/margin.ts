/**
 * Gross-margin calculation.
 *
 *   margin = (revenueUsd - costUsd) / revenueUsd
 *
 * Revenue sources (server-side records):
 *   - creditPurchases collection → fiat USD in (net of Stripe fees tracked separately)
 *   - platformSubscriptions collection → recognised on period
 *
 * Cost sources:
 *   - costAggregates/{period}__platform__all → total provider cost
 *
 * Target: >= 0.30 (30%). The admin dashboard surfaces the current number;
 * the Prometheus gauge `loar_platform_margin_ratio{window}` is kept in sync.
 */

import { db, firebaseAvailable } from '../../lib/firebase';
import { setPlatformMargin } from './metrics';

export interface MarginWindow {
  window: 'day' | 'month';
  period: string; // YYYY-MM-DD or YYYY-MM
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginRatio: number;
  hitsTarget: boolean;
  target: number;
}

const TARGET = Number(process.env.COST_MARGIN_TARGET ?? 0.3);

function todayKeys(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  return { day, month };
}

async function loadCost(period: string): Promise<number> {
  if (!firebaseAvailable) return 0;
  const doc = await db.collection('costAggregates').doc(`${period}__platform__all`).get();
  return Number(doc.data()?.costUsd ?? 0);
}

async function loadRevenue(period: string, kind: 'day' | 'month'): Promise<number> {
  if (!firebaseAvailable) return 0;
  // Credits purchased in the window (USD value of completed Stripe + crypto payments).
  const start = kind === 'day' ? `${period}T00:00:00.000Z` : `${period}-01T00:00:00.000Z`;
  const end = kind === 'day' ? `${period}T23:59:59.999Z` : `${period}-31T23:59:59.999Z`;
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

export async function computeMargin(window: 'day' | 'month'): Promise<MarginWindow> {
  const { day, month } = todayKeys();
  const period = window === 'day' ? day : month;
  const [costUsd, revenueUsd] = await Promise.all([loadCost(period), loadRevenue(period, window)]);
  const marginUsd = revenueUsd - costUsd;
  const marginRatio = revenueUsd > 0 ? marginUsd / revenueUsd : 0;
  const result: MarginWindow = {
    window,
    period,
    revenueUsd,
    costUsd,
    marginUsd,
    marginRatio,
    hitsTarget: marginRatio >= TARGET,
    target: TARGET,
  };
  setPlatformMargin(window, marginRatio);
  return result;
}

export function marginTarget(): number {
  return TARGET;
}
