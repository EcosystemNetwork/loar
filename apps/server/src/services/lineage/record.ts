/**
 * Asset lineage write-path — PRD 10.
 *
 * All generation/edit/publish handlers call recordAssetEvent() on success
 * (and optionally on failure) to persist a row in the `assetEvents`
 * collection. Failures here are swallowed — lineage tracking must never
 * break a generation.
 *
 * Required Firestore composite indexes (see firestore.indexes.json):
 *   - assetEvents: (parentAssetId asc, createdAt desc)
 *   - assetEvents: (rootAssetId asc, createdAt asc)
 *   - assetEvents: (universeAddress asc, createdAt desc)
 *   - assetEvents: (universeId asc, createdAt desc)
 *   - assetEvents: (creatorUid asc, createdAt desc)
 */
import { db } from '../../lib/firebase';
import type { AssetEvent, RecordAssetEventInput } from './types';

export const ASSET_EVENTS_COLLECTION = 'assetEvents';

function assetEventsCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection(ASSET_EVENTS_COLLECTION);
}

async function resolveRoot(
  parentAssetId: string | null,
  selfAssetId: string
): Promise<{ rootAssetId: string; depth: number }> {
  if (!parentAssetId) return { rootAssetId: selfAssetId, depth: 0 };
  try {
    const parentDoc = await assetEventsCol().doc(parentAssetId).get();
    if (!parentDoc.exists) {
      // Parent asset exists elsewhere (e.g. external upload, or upstream
      // handler hasn't written its event yet). Treat the parent as its own
      // root so lineage links remain navigable.
      return { rootAssetId: parentAssetId, depth: 1 };
    }
    const parent = parentDoc.data() as AssetEvent;
    return {
      rootAssetId: parent.rootAssetId || parent.assetId,
      depth: (parent.depth ?? 0) + 1,
    };
  } catch {
    return { rootAssetId: parentAssetId, depth: 1 };
  }
}

/**
 * Persist a single asset event. Safe to call fire-and-forget.
 *
 * Uses the assetId as the Firestore doc id so repeated calls for the same
 * asset (e.g. a retry that succeeds after an initial failure write) upsert
 * instead of duplicating rows.
 */
export async function recordAssetEvent(input: RecordAssetEventInput): Promise<void> {
  if (!db) return;
  try {
    const parentAssetId = input.parentAssetId ?? null;
    const { rootAssetId, depth } = await resolveRoot(parentAssetId, input.assetId);

    const event: AssetEvent = {
      id: input.assetId,
      assetId: input.assetId,
      parentAssetId,
      rootAssetId,
      depth,
      kind: input.kind,
      tool: input.tool,
      step: input.step,
      prompt: input.prompt ?? null,
      promptRefs: input.promptRefs ?? [],
      modelId: input.modelId ?? null,
      modelProvider: input.modelProvider ?? null,
      creditCost: input.creditCost ?? 0,
      latencyMs: input.latencyMs ?? null,
      creatorUid: input.creatorUid,
      creatorAddress: input.creatorAddress ?? null,
      universeAddress: input.universeAddress ?? null,
      universeId: input.universeId ?? null,
      rightsClass: input.rightsClass ?? null,
      outputUrl: input.outputUrl ?? null,
      outputKind: input.outputKind,
      status: input.status ?? 'completed',
      createdAt: new Date(),
    };

    await assetEventsCol().doc(input.assetId).set(event, { merge: true });
  } catch (err) {
    console.error('[lineage] recordAssetEvent failed:', err);
  }
}

export function recordAssetEventAsync(input: RecordAssetEventInput): void {
  recordAssetEvent(input).catch((err) =>
    console.error('[lineage] recordAssetEventAsync error:', err)
  );
}
