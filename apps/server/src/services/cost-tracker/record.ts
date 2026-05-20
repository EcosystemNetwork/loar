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

// Tracks routes that have already warned about missing scope so the log
// doesn't get spammed at 1000 QPS. One warn per (route, runtime).
const scopeWarnedFor = new Set<string>();

// Sharding for hot aggregate writes. Firestore caps single-doc writes at
// ~1/sec; the platform-wide aggregate doc gets a write on EVERY paid call
// (~1000 QPS at scale). Round-robining writes across SHARD_COUNT replica
// docs gives ~SHARD_COUNT× the write throughput. Reads sum across shards.
//
// We shard the platform total ONLY — per-provider:kind and per-user docs
// don't get enough traffic to need it (a single openai:llm doc maxes at
// the rate of openai:llm calls, not total platform calls). Adjust via
// env if a specific provider becomes a hot bottleneck.
export const PLATFORM_SHARD_COUNT = Math.max(
  1,
  Math.min(50, parseInt(process.env.COST_PLATFORM_SHARD_COUNT ?? '10', 10) || 10)
);

function pickShardSuffix(scope: string): string {
  if (scope !== 'platform') return '';
  const s = Math.floor(Math.random() * PLATFORM_SHARD_COUNT);
  return `__shard${s}`;
}

/**
 * Build the document refs for every shard of `${period}__platform__${key}`.
 * Public so consumers (alerts, margin, trend, query, redis-spend) can
 * read the platform aggregate without each having to know the sharding
 * scheme. Returns at most PLATFORM_SHARD_COUNT refs.
 */
export function platformShardRefs(
  period: string,
  key: string
): FirebaseFirestore.DocumentReference[] {
  return Array.from({ length: PLATFORM_SHARD_COUNT }, (_, i) =>
    db.collection('costAggregates').doc(`${period}__platform__${key}__shard${i}`)
  );
}

export interface PlatformAggregate {
  costUsd: number;
  calls: number;
  tokensUsed: number;
}

/**
 * Sum the platform aggregate for one period across all shards. Returns
 * zeros when Firestore is unavailable or no shard has been written yet.
 *
 * Use this instead of reading `${period}__platform__all` directly — that
 * doc no longer exists after the pass-2 sharding change.
 */
export async function readPlatformAggregate(
  period: string,
  key = 'all'
): Promise<PlatformAggregate> {
  if (!firebaseAvailable) return { costUsd: 0, calls: 0, tokensUsed: 0 };
  const snaps = await db.getAll(...platformShardRefs(period, key));
  return snaps.reduce(
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
}

/**
 * Sum platform aggregates for N periods (days or months) in a single
 * Firestore batched read. Useful for trend charts. Returns one entry
 * per input period, in the same order, with zeros for periods that have
 * no data.
 */
export async function readPlatformAggregateBatch(
  periods: string[],
  key = 'all'
): Promise<PlatformAggregate[]> {
  if (!firebaseAvailable || periods.length === 0) {
    return periods.map(() => ({ costUsd: 0, calls: 0, tokensUsed: 0 }));
  }
  const refs = periods.flatMap((p) => platformShardRefs(p, key));
  const snaps = await db.getAll(...refs);
  const byPeriod: PlatformAggregate[] = periods.map(() => ({
    costUsd: 0,
    calls: 0,
    tokensUsed: 0,
  }));
  for (let i = 0; i < snaps.length; i++) {
    const periodIdx = Math.floor(i / PLATFORM_SHARD_COUNT);
    const data = snaps[i].data();
    if (!data) continue;
    byPeriod[periodIdx].costUsd += Number(data.costUsd ?? 0);
    byPeriod[periodIdx].calls += Number(data.calls ?? 0);
    byPeriod[periodIdx].tokensUsed += Number(data.tokensUsed ?? 0);
  }
  return byPeriod;
}

function aggregateDocId(
  period: string,
  scope: 'platform' | 'provider' | 'user' | 'apiKey' | 'universe' | 'model',
  key: string,
  shardSuffix = ''
) {
  return `${period}__${scope}__${key || 'none'}${shardSuffix}`;
}

export async function recordProviderCost(input: RecordProviderCostInput): Promise<void> {
  const costUsd = Number.isFinite(input.costUsd) && input.costUsd > 0 ? input.costUsd : 0;
  const scope = { ...getCostScope(), ...(input.scopeOverride ?? {}) };

  // Surface scope-missing on metered calls. AsyncLocalStorage doesn't cross
  // worker process boundaries — if a BullMQ job forgets to wrap with
  // withCostScope, ledger writes attribute to 'anon' silently. Warn once per
  // route so per-user margin math doesn't degrade unnoticed.
  if (costUsd > 0 && scope.userId == null && !scopeWarnedFor.has(scope.route ?? 'unknown')) {
    scopeWarnedFor.add(scope.route ?? 'unknown');
    console.warn(
      `[cost-tracker] metered call recorded with no userId (provider=${input.provider} kind=${input.kind} model=${input.model ?? 'unknown'} route=${scope.route ?? 'unknown'}) — ` +
        `wrap the caller with withCostScope({ userId, ... }) to restore attribution`
    );
  }

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
    const shardSuffix = pickShardSuffix(s);
    const idDay = aggregateDocId(day, s as any, key, shardSuffix);
    const idMonth = aggregateDocId(month, s as any, key, shardSuffix);
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

  // Write-through to Redis-backed atomic spend counters. Used by
  // assertProviderAllowed for cap stampede mitigation (closes the
  // read-vs-write race window from seconds → microseconds). Best-effort:
  // the Firestore aggregate above is the source of truth.
  try {
    const { incrementRedisSpend } = await import('./redis-spend');
    const incrementOps: Array<{ scope: string; key: string }> = [
      { scope: 'platform', key: 'all' },
      { scope: 'provider', key: `${input.provider}:${input.kind}` },
    ];
    if (scope.userId) incrementOps.push({ scope: 'user', key: scope.userId });
    if (scope.apiKeyId) incrementOps.push({ scope: 'apiKey', key: scope.apiKeyId });
    if (scope.universeAddress) {
      incrementOps.push({ scope: 'universe', key: scope.universeAddress });
    }
    await Promise.all(
      incrementOps.map(({ scope: s, key: k }) => incrementRedisSpend(s, k, costUsd))
    );
  } catch (err) {
    console.warn('[cost-tracker] redis-spend write-through failed:', (err as Error).message);
  }
}
