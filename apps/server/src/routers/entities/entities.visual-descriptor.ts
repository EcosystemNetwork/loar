/**
 * Visual-descriptor handlers — VLM-maintained canonical visual memory for entities.
 *
 * A descriptor lives on the entity doc under `visualDescriptor`. Prior versions
 * archive to a per-entity `descriptorHistory` subcollection keyed by version so
 * creators can revert. Creator-pinned reference assets carry forward through
 * VLM auto-refreshes — they can only be displaced by explicit creator action.
 *
 * See docs/prd-vlm-subsystem.md §12.1.
 */
import { db } from '../../lib/firebase';
import {
  type Entity,
  type EntityVisualDescriptor,
  type DescriptorReferenceAsset,
  type DescriptorReferenceRole,
  DESCRIPTOR_REFERENCE_ROLES,
  MAX_DESCRIPTOR_REFERENCES,
} from './entities.types';

function entitiesCol() {
  return db.collection('entities');
}

function descriptorHistorySubcol(entityId: string) {
  return entitiesCol().doc(entityId).collection('descriptorHistory');
}

const MAX_CANONICAL_DESCRIPTION_LEN = 4000;

/** Bound + normalize a descriptor draft before persisting. */
function sanitizeDescriptor(
  input: Partial<EntityVisualDescriptor>,
  version: number
): EntityVisualDescriptor {
  const canonicalDescription =
    typeof input.canonicalDescription === 'string'
      ? input.canonicalDescription.slice(0, MAX_CANONICAL_DESCRIPTION_LEN)
      : '';

  const attributes: EntityVisualDescriptor['attributes'] = {};
  if (input.attributes && typeof input.attributes === 'object') {
    for (const [k, v] of Object.entries(input.attributes)) {
      if (typeof v === 'string') {
        attributes[k] = v;
      } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        attributes[k] = v as string[];
      }
    }
  }

  const seenCids = new Set<string>();
  const referenceAssets: DescriptorReferenceAsset[] = [];
  for (const asset of input.referenceAssets ?? []) {
    if (!asset || typeof asset.cid !== 'string' || typeof asset.mediaUrl !== 'string') continue;
    if (seenCids.has(asset.cid)) continue;
    if (!DESCRIPTOR_REFERENCE_ROLES.includes(asset.role as DescriptorReferenceRole)) continue;
    seenCids.add(asset.cid);
    referenceAssets.push({
      cid: asset.cid,
      mediaUrl: asset.mediaUrl,
      sourceContentId: asset.sourceContentId,
      sourceSceneIndex:
        typeof asset.sourceSceneIndex === 'number' && Number.isFinite(asset.sourceSceneIndex)
          ? asset.sourceSceneIndex
          : undefined,
      role: asset.role as DescriptorReferenceRole,
      priority:
        typeof asset.priority === 'number' && Number.isFinite(asset.priority) ? asset.priority : 0,
      pinnedByCreator: asset.pinnedByCreator === true,
    });
  }

  // Pinned assets always survive the cap; trim lowest-priority unpinned first.
  referenceAssets.sort((a, b) => {
    if (a.pinnedByCreator !== b.pinnedByCreator) return a.pinnedByCreator ? -1 : 1;
    return b.priority - a.priority;
  });
  const bounded = referenceAssets.slice(0, MAX_DESCRIPTOR_REFERENCES);

  return {
    version,
    canonicalDescription,
    attributes,
    referenceAssets: bounded,
    lastUpdatedBy: input.lastUpdatedBy ?? 'vlm',
    updatedAt: new Date(),
    sourceExtractionId: input.sourceExtractionId,
  };
}

/** Read the current descriptor from the entity doc. */
export async function getVisualDescriptor(
  entityId: string
): Promise<EntityVisualDescriptor | null> {
  const doc = await entitiesCol().doc(entityId).get();
  if (!doc.exists) return null;
  const data = doc.data() as Entity;
  return data.visualDescriptor ?? null;
}

/**
 * Atomically write a new descriptor version.
 *
 * 1. Reads current descriptor from entity doc.
 * 2. Archives it to `descriptorHistory/{prior.version}` (no-op if no prior).
 * 3. Preserves creator-pinned assets from the prior version so VLM auto-refresh
 *    can never silently displace them.
 * 4. Bumps `version`, sanitizes, writes onto entity doc.
 *
 * Callers: `vlm.proposals.accept`, `vlm.copilot.refreshVisualDescriptor`,
 * or admin tooling. The route layer is responsible for authorization.
 */
export async function writeVisualDescriptor(
  entityId: string,
  input: Partial<EntityVisualDescriptor>
): Promise<EntityVisualDescriptor> {
  const ref = entitiesCol().doc(entityId);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Entity not found');
    const data = doc.data() as Entity;
    const prior = data.visualDescriptor ?? null;

    const pinnedCarry = (prior?.referenceAssets ?? []).filter((a) => a.pinnedByCreator === true);
    const incoming = input.referenceAssets ?? [];
    const pinnedCids = new Set(pinnedCarry.map((a) => a.cid));
    const merged = [...pinnedCarry, ...incoming.filter((a) => !pinnedCids.has(a.cid))];

    const nextVersion = (prior?.version ?? 0) + 1;
    const next = sanitizeDescriptor({ ...input, referenceAssets: merged }, nextVersion);

    if (prior) {
      const historyRef = descriptorHistorySubcol(entityId).doc(String(prior.version));
      tx.set(historyRef, prior);
    }

    tx.update(ref, { visualDescriptor: next, updatedAt: new Date() });
    return next;
  });
}

/** Toggle the creator-pinned flag on a reference asset. */
export async function pinReferenceAsset(
  entityId: string,
  cid: string,
  pinned: boolean
): Promise<EntityVisualDescriptor> {
  const ref = entitiesCol().doc(entityId);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Entity not found');
    const data = doc.data() as Entity;
    const descriptor = data.visualDescriptor;
    if (!descriptor) throw new Error('Entity has no visual descriptor yet');

    let found = false;
    const updatedAssets = descriptor.referenceAssets.map((a) => {
      if (a.cid !== cid) return a;
      found = true;
      return { ...a, pinnedByCreator: pinned };
    });
    if (!found) throw new Error('Reference asset not found on this descriptor');

    const next: EntityVisualDescriptor = {
      ...descriptor,
      referenceAssets: updatedAssets,
      updatedAt: new Date(),
      lastUpdatedBy: 'creator',
    };
    tx.update(ref, { visualDescriptor: next, updatedAt: new Date() });
    return next;
  });
}

/**
 * Revert to a prior descriptor version. The current version is archived to
 * history before the revert so revert-then-forward is always possible.
 */
export async function revertVisualDescriptor(
  entityId: string,
  targetVersion: number
): Promise<EntityVisualDescriptor> {
  const ref = entitiesCol().doc(entityId);
  const historyDocSnap = await descriptorHistorySubcol(entityId).doc(String(targetVersion)).get();
  if (!historyDocSnap.exists) {
    throw new Error(`Descriptor version ${targetVersion} not found in history`);
  }
  const archived = historyDocSnap.data() as EntityVisualDescriptor;

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Entity not found');
    const data = doc.data() as Entity;
    const prior = data.visualDescriptor ?? null;

    if (prior) {
      const historyRef = descriptorHistorySubcol(entityId).doc(String(prior.version));
      tx.set(historyRef, prior);
    }

    const nextVersion = (prior?.version ?? 0) + 1;
    const reverted: EntityVisualDescriptor = {
      ...archived,
      version: nextVersion,
      lastUpdatedBy: 'creator',
      updatedAt: new Date(),
    };
    tx.update(ref, { visualDescriptor: reverted, updatedAt: new Date() });
    return reverted;
  });
}

/** List descriptor history, newest first. */
export async function getDescriptorHistory(
  entityId: string,
  limit = 20
): Promise<EntityVisualDescriptor[]> {
  const snap = await descriptorHistorySubcol(entityId)
    .orderBy('version', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as EntityVisualDescriptor);
}
