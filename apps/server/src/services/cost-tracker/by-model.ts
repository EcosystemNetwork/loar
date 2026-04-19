/**
 * Per-model cost breakdown — reads the `model` scope aggregates.
 */

import { db, firebaseAvailable } from '../../lib/firebase';

export interface ModelRow {
  key: string; // `${provider}:${model}`
  provider: string;
  model: string;
  kind: string;
  costUsd: number;
  calls: number;
  tokensUsed: number;
  costPerCallUsd: number;
}

export async function getByModel(period: string, limit = 50): Promise<ModelRow[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('costAggregates')
    .where('period', '==', period)
    .where('scope', '==', 'model')
    .orderBy('costUsd', 'desc')
    .limit(Math.min(Math.max(limit, 1), 200))
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    const key = String(x.key ?? '');
    const [provider, model] = key.split(':');
    const costUsd = Number(x.costUsd ?? 0);
    const calls = Number(x.calls ?? 0);
    return {
      key,
      provider: provider ?? '',
      model: model ?? '',
      kind: String(x.kind ?? ''),
      costUsd,
      calls,
      tokensUsed: Number(x.tokensUsed ?? 0),
      costPerCallUsd: calls > 0 ? costUsd / calls : 0,
    };
  });
}
