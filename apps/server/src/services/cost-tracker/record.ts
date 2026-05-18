/**
 * Cost-tracker record path.
 *
 * recordProviderCost is the single entry point for every paid external API
 * call. It writes an append-only ledger row and atomically increments the
 * daily + monthly aggregates keyed by (provider, model, userId, apiKeyId,
 * universeAddress). The admin `admin.cost.*` router reads those aggregates
 * to compute margin in O(1) without scanning the ledger.
 */

import { randomUUID } from 'node:crypto';
import { db, firebaseAvailable } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { getCostScope } from './scope';
import { recordProviderCostMetric } from './metrics';

export type CostProvider =
  | 'gemini'
  | 'openai'
  | 'fal'
  | 'bytedance'
  | 'elevenlabs'
  | 'meshy'
  | 'pinata'
  | 'lighthouse'
  | 'firebase_storage'
  | 'stripe_fee'
  | 'unstoppable_domains'
  | 'groq'
  | 'zai'
  | 'assemblyai'
  | 'deepgram'
  | 'tripo'
  | 'minimax'
  | 'other';

export type CostKind =
  | 'llm'
  | 'vlm'
  | 'image_gen'
  | 'video_gen'
  | 'audio_gen'
  | 'threed_gen'
  | 'embedding'
  | 'storage'
  | 'payment_fee'
  | 'lookup'
  | 'other';

export interface RecordProviderCostInput {
  provider: CostProvider;
  model?: string | null;
  kind: CostKind;
  /** Actual dollar cost of this call. Must never be negative. */
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensUsed?: number;
  /** Free-form extra fields (e.g. generationId, resolution, duration). */
  extra?: Record<string, string | number | boolean | null>;
  /** Override scope fields for this record only (used by workers). */
  scopeOverride?: Partial<ReturnType<typeof getCostScope>>;
}

function periodKeys(now: Date) {
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const month = day.slice(0, 7); // YYYY-MM
  return { day, month };
}

function aggregateDocId(
  period: string,
  scope: 'platform' | 'provider' | 'user' | 'apiKey' | 'universe',
  key: string
) {
  return `${period}__${scope}__${key || 'none'}`;
}

export async function recordProviderCost(input: RecordProviderCostInput): Promise<void> {
  const costUsd = Number.isFinite(input.costUsd) && input.costUsd > 0 ? input.costUsd : 0;
  const scope = { ...getCostScope(), ...(input.scopeOverride ?? {}) };
  // Always emit the Prometheus counter even when Firestore isn't configured —
  // dashboards should see cost regardless of persistence state.
  recordProviderCostMetric({
    provider: input.provider,
    kind: input.kind,
    model: input.model ?? 'unknown',
    costUsd,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
  });
  if (!firebaseAvailable || costUsd <= 0) return;

  const now = new Date();
  const { day, month } = periodKeys(now);
  const ledgerRef = db.collection('costLedger').doc(`cost_${randomUUID()}`);
  const ledgerDoc = {
    provider: input.provider,
    model: input.model ?? null,
    kind: input.kind,
    costUsd,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    tokensUsed: input.tokensUsed ?? (input.inputTokens ?? 0) + (input.outputTokens ?? 0),
    userId: scope.userId ?? null,
    apiKeyId: scope.apiKeyId ?? null,
    aiAgentId: scope.aiAgentId ?? null,
    universeAddress: scope.universeAddress ?? null,
    route: scope.route ?? null,
    requestId: scope.requestId ?? null,
    extra: input.extra ?? null,
    day,
    month,
    createdAt: now,
  };

  // Aggregate writes are best-effort; never let a missed increment fail the caller.
  const aggregateOps: Array<{
    ref: FirebaseFirestore.DocumentReference;
    id: string;
    scope: string;
    key: string;
  }> = [
    { scope: 'platform', key: 'all' },
    { scope: 'provider', key: `${input.provider}:${input.kind}` },
    // Per-model scope (only when model is known) — powers the per-model
    // admin table + cost-per-call efficiency view.
    ...(input.model ? [{ scope: 'model', key: `${input.provider}:${input.model}` }] : []),
    { scope: 'user', key: scope.userId ?? 'anon' },
    ...(scope.apiKeyId ? [{ scope: 'apiKey', key: scope.apiKeyId }] : []),
    ...(scope.universeAddress ? [{ scope: 'universe', key: scope.universeAddress }] : []),
  ].flatMap(({ scope: s, key }) => {
    const idDay = aggregateDocId(day, s as any, key);
    const idMonth = aggregateDocId(month, s as any, key);
    return [
      {
        ref: db.collection('costAggregates').doc(idDay),
        id: idDay,
        scope: s,
        key,
      },
      {
        ref: db.collection('costAggregates').doc(idMonth),
        id: idMonth,
        scope: s,
        key,
      },
    ];
  });

  try {
    const batch = db.batch();
    batch.set(ledgerRef, ledgerDoc);
    for (const op of aggregateOps) {
      const period = op.id.split('__')[0];
      batch.set(
        op.ref,
        {
          period,
          periodKind: period.length === 7 ? 'month' : 'day',
          scope: op.scope,
          key: op.key,
          costUsd: FieldValue.increment(costUsd),
          tokensUsed: FieldValue.increment(ledgerDoc.tokensUsed ?? 0),
          calls: FieldValue.increment(1),
          provider: input.provider,
          kind: input.kind,
          updatedAt: now,
        },
        { merge: true }
      );
    }
    await batch.commit();
  } catch (err) {
    // Log but never rethrow — cost tracking must not break business flows.
    console.error('[cost-tracker] record failed:', err);
  }
}
