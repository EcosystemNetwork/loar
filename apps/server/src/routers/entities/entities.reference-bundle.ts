/**
 * Reference-bundle handlers — Character Identity Lock + Multi-Reference Editing.
 *
 * A bundle is stored on the entity doc under `referenceBundle`. Child entities
 * inherit from their parent chain; an explicit slot value on the child
 * overrides inherited values for that slot. Locks and identityStrength are
 * merged by "nearest wins" — child value takes precedence.
 */
import { db } from '../../lib/firebase';
import {
  type Entity,
  type ReferenceBundle,
  type ReferenceSlot,
  type IdentityLock,
  IDENTITY_LOCK_LABELS,
  MAX_REFS_PER_SLOT,
  REFERENCE_SLOTS,
  IDENTITY_LOCKS,
} from './entities.types';

function entitiesCol() {
  return db.collection('entities');
}

/** Sanitize a bundle before persisting. Ensures arrays are capped and unique. */
function sanitizeBundle(input: Partial<ReferenceBundle>): ReferenceBundle {
  const slots: ReferenceBundle['slots'] = {};
  for (const slot of REFERENCE_SLOTS) {
    const urls = input.slots?.[slot];
    if (!Array.isArray(urls)) continue;
    const unique = Array.from(new Set(urls.filter((u) => typeof u === 'string' && u.length > 0)));
    if (unique.length > 0) {
      slots[slot] = unique.slice(0, MAX_REFS_PER_SLOT);
    }
  }

  const locks: ReferenceBundle['locks'] = {};
  for (const lock of IDENTITY_LOCKS) {
    if (input.locks?.[lock] === true) locks[lock] = true;
  }

  const rawStrength = input.identityStrength;
  const identityStrength =
    typeof rawStrength === 'number' && Number.isFinite(rawStrength)
      ? Math.max(0, Math.min(1, rawStrength))
      : 0.7;

  return { slots, locks, identityStrength, updatedAt: new Date() };
}

/** Write a bundle to an entity. Creator is not checked here — route enforces auth. */
export async function setReferenceBundle(
  entityId: string,
  input: Partial<ReferenceBundle>
): Promise<ReferenceBundle> {
  const ref = entitiesCol().doc(entityId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Entity not found');
  const bundle = sanitizeBundle(input);
  await ref.update({ referenceBundle: bundle, updatedAt: new Date() });
  return bundle;
}

/** Clear the bundle (set to null). */
export async function clearReferenceBundle(entityId: string): Promise<void> {
  const ref = entitiesCol().doc(entityId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Entity not found');
  await ref.update({ referenceBundle: null, updatedAt: new Date() });
}

interface ResolveOptions {
  /** Whether to walk the parent chain. Default: true. */
  includeInherited?: boolean;
  /** Cycle-safety cap on how many parents to walk. Default: 8. */
  maxDepth?: number;
}

export interface ResolvedReferenceBundle extends ReferenceBundle {
  /** Direct (non-inherited) slots set on this entity. */
  directSlots: ReferenceSlot[];
  /** Slots that came from an ancestor entity, with their provenance. */
  inheritedFrom: Partial<Record<ReferenceSlot, { entityId: string; entityName: string }>>;
}

/**
 * Resolve an entity's reference bundle, merging ancestor bundles if requested.
 *
 * Merge rules:
 *   - Each slot: first non-empty value walking from self → parent → grandparent wins.
 *   - Each lock: any `true` in the chain wins (strictest preservation).
 *   - identityStrength: nearest value wins (self overrides parent).
 */
export async function resolveReferenceBundle(
  entityId: string,
  opts: ResolveOptions = {}
): Promise<ResolvedReferenceBundle | null> {
  const includeInherited = opts.includeInherited ?? true;
  const maxDepth = opts.maxDepth ?? 8;

  const rootDoc = await entitiesCol().doc(entityId).get();
  if (!rootDoc.exists) return null;

  const mergedSlots: ReferenceBundle['slots'] = {};
  const mergedLocks: ReferenceBundle['locks'] = {};
  const directSlots: ReferenceSlot[] = [];
  const inheritedFrom: ResolvedReferenceBundle['inheritedFrom'] = {};
  let identityStrength: number | null = null;
  let latestUpdate = new Date(0);

  const visited = new Set<string>();
  let cursorId: string | null = entityId;
  let depth = 0;
  let isSelf = true;

  while (cursorId && depth < maxDepth && !visited.has(cursorId)) {
    visited.add(cursorId);
    const doc = isSelf ? rootDoc : await entitiesCol().doc(cursorId).get();
    if (!doc.exists) break;
    const data = doc.data() as Entity;
    const bundle = data.referenceBundle ?? null;

    if (bundle) {
      if (bundle.updatedAt && bundle.updatedAt > latestUpdate) latestUpdate = bundle.updatedAt;

      for (const slot of REFERENCE_SLOTS) {
        const urls = bundle.slots?.[slot];
        if (urls && urls.length > 0 && !mergedSlots[slot]) {
          mergedSlots[slot] = urls.slice(0, MAX_REFS_PER_SLOT);
          if (isSelf) {
            directSlots.push(slot);
          } else {
            inheritedFrom[slot] = { entityId: cursorId, entityName: data.name };
          }
        }
      }

      for (const lock of IDENTITY_LOCKS) {
        if (bundle.locks?.[lock] === true) mergedLocks[lock] = true;
      }

      if (identityStrength === null && typeof bundle.identityStrength === 'number') {
        identityStrength = bundle.identityStrength;
      }
    }

    if (!includeInherited) break;
    cursorId = data.parentId;
    depth += 1;
    isSelf = false;
  }

  const hasAny =
    Object.keys(mergedSlots).length > 0 ||
    Object.keys(mergedLocks).length > 0 ||
    identityStrength !== null;

  if (!hasAny) return null;

  return {
    slots: mergedSlots,
    locks: mergedLocks,
    identityStrength: identityStrength ?? 0.7,
    updatedAt: latestUpdate.getTime() === 0 ? new Date() : latestUpdate,
    directSlots,
    inheritedFrom,
  };
}

/**
 * Flatten all reference URLs out of a bundle in a stable order
 * (character → outfit → prop → environment → style). Useful for providers
 * that accept a single ordered list of reference images.
 */
export function flattenReferenceUrls(bundle: ReferenceBundle | null, cap = 6): string[] {
  if (!bundle) return [];
  const urls: string[] = [];
  for (const slot of REFERENCE_SLOTS) {
    for (const url of bundle.slots?.[slot] ?? []) {
      if (urls.length >= cap) return urls;
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

/**
 * Build a short prompt suffix describing active locks. Used by providers
 * without structured identity-lock support so the information still reaches
 * the model through the text prompt.
 */
export function buildLockPromptSuffix(bundle: ReferenceBundle | null): string {
  if (!bundle) return '';
  const active = IDENTITY_LOCKS.filter((lock) => bundle.locks?.[lock] === true);
  if (active.length === 0) return '';
  const phrases = active.map((lock) => {
    switch (lock) {
      case 'face':
        return 'preserve the subject’s exact face and facial features';
      case 'costume':
        return 'preserve the subject’s exact costume and outfit details';
      case 'colors':
        return 'preserve the exact color palette of the reference';
      case 'silhouette':
        return 'preserve the overall silhouette and proportions of the reference';
      default:
        return IDENTITY_LOCK_LABELS[lock as IdentityLock];
    }
  });
  const strength = bundle.identityStrength ?? 0.7;
  const strengthWord = strength >= 0.85 ? 'strict' : strength >= 0.5 ? 'strong' : 'light';
  return `identity lock (${strengthWord}): ${phrases.join('; ')}`;
}
