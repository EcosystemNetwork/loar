/**
 * Top movers — users / api keys / universes whose daily cost jumped vs
 * yesterday. Cheap: reads today's and yesterday's scope aggregates for the
 * requested scope and diffs them.
 */

import { db, firebaseAvailable } from '../../lib/firebase';

export type Scope = 'user' | 'apiKey' | 'universe';

export interface Mover {
  key: string;
  scope: Scope;
  currentUsd: number;
  previousUsd: number;
  deltaUsd: number;
  deltaPct: number;
  currentCalls: number;
}

function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

export async function getTopMovers(args: { scope: Scope; limit?: number }): Promise<Mover[]> {
  if (!firebaseAvailable) return [];
  const today = day(0);
  const yesterday = day(-1);
  const [currSnap, prevSnap] = await Promise.all([
    db
      .collection('costAggregates')
      .where('period', '==', today)
      .where('scope', '==', args.scope)
      .get(),
    db
      .collection('costAggregates')
      .where('period', '==', yesterday)
      .where('scope', '==', args.scope)
      .get(),
  ]);
  const curr = new Map<string, { cost: number; calls: number }>();
  for (const d of currSnap.docs) {
    const x = d.data();
    curr.set(String(x.key), { cost: Number(x.costUsd ?? 0), calls: Number(x.calls ?? 0) });
  }
  const prev = new Map<string, number>();
  for (const d of prevSnap.docs) {
    const x = d.data();
    prev.set(String(x.key), Number(x.costUsd ?? 0));
  }
  const movers: Mover[] = [];
  for (const [key, { cost, calls }] of curr) {
    const previousUsd = prev.get(key) ?? 0;
    const deltaUsd = cost - previousUsd;
    const deltaPct = previousUsd > 0 ? deltaUsd / previousUsd : cost > 0 ? Infinity : 0;
    movers.push({
      key,
      scope: args.scope,
      currentUsd: cost,
      previousUsd,
      deltaUsd,
      deltaPct,
      currentCalls: calls,
    });
  }
  movers.sort((a, b) => b.deltaUsd - a.deltaUsd);
  return movers.slice(0, Math.min(Math.max(args.limit ?? 10, 1), 50));
}
