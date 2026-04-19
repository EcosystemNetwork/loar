/**
 * Period comparison — current window vs previous window.
 * Supports day-over-day, week-over-week, and month-over-month.
 */

import { getPlatformTrend } from './trend';

export interface Comparison {
  window: 'day' | 'week' | 'month';
  current: { costUsd: number; calls: number; revenueUsd: number; marginRatio: number };
  previous: { costUsd: number; calls: number; revenueUsd: number; marginRatio: number };
  delta: {
    costUsd: number;
    costPct: number; // 0.23 = +23%
    callsPct: number;
    revenueUsd: number;
    revenuePct: number;
    marginRatioDelta: number; // absolute pp change
  };
}

function sum(points: Array<{ costUsd: number; calls: number; revenueUsd: number }>) {
  let costUsd = 0;
  let calls = 0;
  let revenueUsd = 0;
  for (const p of points) {
    costUsd += p.costUsd;
    calls += p.calls;
    revenueUsd += p.revenueUsd;
  }
  const marginRatio = revenueUsd > 0 ? (revenueUsd - costUsd) / revenueUsd : 0;
  return { costUsd, calls, revenueUsd, marginRatio };
}

function pct(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : Infinity;
  return (curr - prev) / prev;
}

export async function getComparison(window: 'day' | 'week' | 'month'): Promise<Comparison> {
  const spanDays = window === 'day' ? 1 : window === 'week' ? 7 : 30;
  const series = await getPlatformTrend(spanDays * 2);
  const split = series.length / 2;
  const previousPoints = series.slice(0, split);
  const currentPoints = series.slice(split);

  const current = sum(currentPoints);
  const previous = sum(previousPoints);

  return {
    window,
    current,
    previous,
    delta: {
      costUsd: current.costUsd - previous.costUsd,
      costPct: pct(current.costUsd, previous.costUsd),
      callsPct: pct(current.calls, previous.calls),
      revenueUsd: current.revenueUsd - previous.revenueUsd,
      revenuePct: pct(current.revenueUsd, previous.revenueUsd),
      marginRatioDelta: current.marginRatio - previous.marginRatio,
    },
  };
}
