/**
 * Admin-only queries over the cost ledger + aggregates.
 * All functions here are expected to be gated by `adminProcedure` upstream.
 */

import { db, firebaseAvailable } from '../../lib/firebase';

export interface AggregateRow {
  period: string;
  scope: string;
  key: string;
  costUsd: number;
  calls: number;
  tokensUsed: number;
  provider?: string;
  kind?: string;
  updatedAt?: Date;
}

function row(d: FirebaseFirestore.QueryDocumentSnapshot): AggregateRow {
  const data = d.data();
  return {
    period: String(data.period ?? d.id.split('__')[0] ?? ''),
    scope: String(data.scope ?? ''),
    key: String(data.key ?? ''),
    costUsd: Number(data.costUsd ?? 0),
    calls: Number(data.calls ?? 0),
    tokensUsed: Number(data.tokensUsed ?? 0),
    provider: data.provider,
    kind: data.kind,
    updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt,
  };
}

export async function getOverview(period: string): Promise<{
  total: AggregateRow | null;
  byProvider: AggregateRow[];
}> {
  if (!firebaseAvailable) return { total: null, byProvider: [] };
  // Platform total is sharded for write throughput (see record.ts) — sum
  // the shards on read. Provider rollups stay un-sharded; each
  // provider:kind doc is much lower volume.
  const { PLATFORM_SHARD_COUNT } = await import('./record');
  const platformShardRefs = Array.from({ length: PLATFORM_SHARD_COUNT }, (_, i) =>
    db.collection('costAggregates').doc(`${period}__platform__all__shard${i}`)
  );
  const [platformSnaps, providerSnap] = await Promise.all([
    db.getAll(...platformShardRefs),
    db
      .collection('costAggregates')
      .where('period', '==', period)
      .where('scope', '==', 'provider')
      .get(),
  ]);
  const byProvider = providerSnap.docs.map(row).sort((a, b) => b.costUsd - a.costUsd);
  const platformAgg = platformSnaps.reduce(
    (acc, s) => {
      const data = s.data();
      if (!data) return acc;
      acc.costUsd += Number(data.costUsd ?? 0);
      acc.calls += Number(data.calls ?? 0);
      acc.tokensUsed += Number(data.tokensUsed ?? 0);
      return acc;
    },
    { costUsd: 0, calls: 0, tokensUsed: 0 }
  );
  const totalRow: AggregateRow | null = platformSnaps.some((s) => s.exists)
    ? {
        period,
        scope: 'platform',
        key: 'all',
        costUsd: platformAgg.costUsd,
        calls: platformAgg.calls,
        tokensUsed: platformAgg.tokensUsed,
      }
    : null;
  return { total: totalRow, byProvider };
}

export async function getByUser(period: string, limit = 50): Promise<AggregateRow[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('costAggregates')
    .where('period', '==', period)
    .where('scope', '==', 'user')
    .orderBy('costUsd', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(row);
}

export async function getByApiKey(period: string, limit = 50): Promise<AggregateRow[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('costAggregates')
    .where('period', '==', period)
    .where('scope', '==', 'apiKey')
    .orderBy('costUsd', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(row);
}

export async function getByUniverse(period: string, limit = 50): Promise<AggregateRow[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('costAggregates')
    .where('period', '==', period)
    .where('scope', '==', 'universe')
    .orderBy('costUsd', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(row);
}

export interface LedgerEntry {
  id: string;
  createdAt: Date;
  provider: string;
  kind: string;
  model: string | null;
  costUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
  userId: string | null;
  apiKeyId: string | null;
  universeAddress: string | null;
  route: string | null;
  extra: Record<string, unknown> | null;
}

export async function getRecentLedger(args: {
  limit?: number;
  userId?: string;
  apiKeyId?: string;
  universeAddress?: string;
  provider?: string;
}): Promise<LedgerEntry[]> {
  if (!firebaseAvailable) return [];
  let q: FirebaseFirestore.Query = db.collection('costLedger').orderBy('createdAt', 'desc');
  if (args.userId) q = q.where('userId', '==', args.userId);
  if (args.apiKeyId) q = q.where('apiKeyId', '==', args.apiKeyId);
  if (args.universeAddress) q = q.where('universeAddress', '==', args.universeAddress);
  if (args.provider) q = q.where('provider', '==', args.provider);
  const snap = await q.limit(Math.min(Math.max(args.limit ?? 100, 1), 500)).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      createdAt: x.createdAt?.toDate?.() ?? x.createdAt,
      provider: String(x.provider ?? ''),
      kind: String(x.kind ?? ''),
      model: x.model ?? null,
      costUsd: Number(x.costUsd ?? 0),
      inputTokens: x.inputTokens ?? null,
      outputTokens: x.outputTokens ?? null,
      userId: x.userId ?? null,
      apiKeyId: x.apiKeyId ?? null,
      universeAddress: x.universeAddress ?? null,
      route: x.route ?? null,
      extra: (x.extra as any) ?? null,
    };
  });
}
