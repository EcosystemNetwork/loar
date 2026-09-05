/**
 * Firestore handlers for worldbuilding entities.
 *
 * Entities are stored in the top-level `entities` collection:
 *   entities/{entityId}
 *
 * universeAddress is an optional field on each entity — creator kinds
 * (person, place, thing, etc.) can exist without a universe assignment.
 * Structural kinds (timeline, realm, etc.) continue to work with or
 * without a universe.
 */
import { db } from '../../lib/firebase';
import { rehostEphemeralUrl } from '../../lib/rehost-ephemeral';
import { normalizeUniverseId } from '../../lib/universe-id';
import {
  type Entity,
  type CreateEntityInput,
  type UpdateEntityInput,
  type EntityKind,
  type EntityRelation,
  type EntityRelationType,
  ENTITY_KINDS,
  ENTITY_RELATION_TYPES,
  VALID_PARENTS,
  STRUCTURAL_KINDS,
} from './entities.types';

async function pinEntityImage(
  imageUrl: string | null | undefined,
  entityId: string,
  creator: string
): Promise<string | null> {
  if (!imageUrl) return null;
  const filename = `entity-${entityId}.jpg`;
  const { url } = await rehostEphemeralUrl(imageUrl, filename, creator);
  return url;
}

function entitiesCol() {
  return db.collection('entities');
}

/**
 * Assert that an entity is eligible for minting as an NFT.
 * Only monetized entities with a valid rights declaration can be minted.
 */
export async function assertMintEligible(entityId: string): Promise<Entity> {
  const doc = await entitiesCol().doc(entityId).get();
  if (!doc.exists) throw new Error('Entity not found');
  const entity = { id: doc.id, ...doc.data() } as Entity;

  if (!entity.monetized) {
    throw new Error(
      'Only monetized entities can be minted as NFTs. Update this entity to monetized first.'
    );
  }
  if (!entity.rightsDeclaration) {
    throw new Error(
      'Rights declaration is required before minting. Declare this as original or licensed work.'
    );
  }
  return entity;
}

/** Validate parent-child relationship for structural kinds only. */
async function validateParent(kind: EntityKind, parentId: string | null): Promise<void> {
  // Creator kinds can have any or no parent — skip strict validation
  if (!STRUCTURAL_KINDS.includes(kind)) return;

  const allowed = VALID_PARENTS[kind];

  if (parentId === null || parentId === undefined) {
    if (!allowed.includes(null)) {
      throw new Error(
        `Entity kind "${kind}" requires a parent. Valid parents: ${allowed.filter(Boolean).join(', ')}`
      );
    }
    return;
  }

  const parentDoc = await entitiesCol().doc(parentId).get();
  if (!parentDoc.exists) {
    throw new Error(`Parent entity "${parentId}" not found`);
  }

  const parentKind = parentDoc.data()?.kind as EntityKind;
  if (!allowed.includes(parentKind)) {
    throw new Error(
      `Entity kind "${kind}" cannot be a child of "${parentKind}". Valid parents: ${allowed.filter(Boolean).join(', ') || 'Universe root (no parent)'}`
    );
  }
}

export async function createEntity(
  input: CreateEntityInput,
  creator: string
): Promise<{ id: string; data: Entity }> {
  if (!ENTITY_KINDS.includes(input.kind)) {
    throw new Error(`Invalid entity kind: ${input.kind}`);
  }

  const parentId = input.parentId ?? null;
  await validateParent(input.kind, parentId);

  // Structural kinds must belong to a universe
  if (STRUCTURAL_KINDS.includes(input.kind) && !input.universeAddress) {
    throw new Error(`Structural kind "${input.kind}" requires a universeAddress`);
  }

  const col = entitiesCol();
  const ref = col.doc();
  const now = new Date();

  const monetized = input.monetized ?? false;
  if (monetized && !input.rightsDeclaration) {
    throw new Error('Rights declaration is required for monetized entities');
  }

  const pinnedImageUrl = await pinEntityImage(input.imageUrl, ref.id, creator.toLowerCase());

  const entity: Entity = {
    id: ref.id,
    name: input.name,
    description: input.description,
    kind: input.kind,
    universeAddress: input.universeAddress ? normalizeUniverseId(input.universeAddress) : null,
    parentId,
    nodeIds: input.nodeIds ?? [],
    imageUrl: pinnedImageUrl,
    metadata: input.metadata ?? {},
    creator: creator.toLowerCase(),
    monetized,
    rightsDeclaration: monetized ? input.rightsDeclaration! : null,
    unstoppableDomain: input.unstoppableDomain ?? null,
    referenceBundle: null,
    visualDescriptor: null,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(entity);
  return { id: ref.id, data: entity };
}

export async function getEntity(entityId: string): Promise<Entity | null>;
/** @deprecated Pass only entityId — universeAddress is no longer needed. */
export async function getEntity(
  universeAddressOrId: string,
  entityId?: string
): Promise<Entity | null>;
export async function getEntity(first: string, second?: string): Promise<Entity | null> {
  // Support legacy call signature: getEntity(universeAddress, entityId)
  const entityId = second ?? first;
  const doc = await entitiesCol().doc(entityId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as Entity;
}

/**
 * Default page size applied when a caller omits `limit`. Previously an omitted
 * limit meant "read the entire universe's entities" — an unbounded scan that
 * grows with the universe. We now always bound the read; callers wanting more
 * page forward via `nextCursorId`.
 */
const DEFAULT_ENTITY_PAGE_LIMIT = 100;

export async function getEntitiesByUniverse(
  universeAddress: string,
  kind?: EntityKind,
  limit?: number,
  cursorId?: string
): Promise<{ entities: Entity[]; nextCursorId: string | null }> {
  const col = entitiesCol();
  const pageLimit = limit ?? DEFAULT_ENTITY_PAGE_LIMIT;
  let query: FirebaseFirestore.Query = col.where(
    'universeAddress',
    '==',
    normalizeUniverseId(universeAddress)
  );

  if (kind) {
    query = query.where('kind', '==', kind);
  }

  query = query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');

  if (cursorId) {
    const cursorDoc = await col.doc(cursorId).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  query = query.limit(pageLimit);

  const snapshot = await query.get();
  const entities = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
  const nextCursorId =
    snapshot.docs.length === pageLimit ? snapshot.docs[snapshot.docs.length - 1].id : null;
  return { entities, nextCursorId };
}

export async function getEntitiesByKind(
  kind: EntityKind,
  limit = 100,
  cursorId?: string
): Promise<{ entities: Entity[]; nextCursorId: string | null }> {
  let query: FirebaseFirestore.Query = entitiesCol()
    .where('kind', '==', kind)
    .orderBy('createdAt', 'desc')
    .orderBy('__name__', 'desc');

  if (cursorId) {
    const cursorDoc = await entitiesCol().doc(cursorId).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.limit(limit).get();
  const entities = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
  const nextCursorId =
    snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;
  return { entities, nextCursorId };
}

export async function getEntitiesByCreator(
  creator: string,
  kind?: EntityKind,
  limit = 100
): Promise<Entity[]> {
  let query: FirebaseFirestore.Query = entitiesCol().where('creator', '==', creator);

  if (kind) {
    query = query.where('kind', '==', kind);
  }

  query = query.orderBy('createdAt', 'desc').limit(limit);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
}

export async function getChildEntities(parentId: string, limit?: number): Promise<Entity[]>;
/** @deprecated universeAddress no longer needed */
export async function getChildEntities(
  universeAddress: string,
  parentId: string
): Promise<Entity[]>;
export async function getChildEntities(first: string, second?: string | number): Promise<Entity[]> {
  let parentId: string;
  let limit = 100;
  if (typeof second === 'string') {
    // Legacy: getChildEntities(universeAddress, parentId)
    parentId = second;
  } else {
    parentId = first;
    if (typeof second === 'number') limit = second;
  }
  const snapshot = await entitiesCol()
    .where('parentId', '==', parentId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
}

export async function updateEntity(entityId: string, input: UpdateEntityInput): Promise<Entity>;
/** @deprecated Pass entityId first — universeAddress is no longer needed. */
export async function updateEntity(
  universeAddress: string,
  entityId: string,
  input: UpdateEntityInput
): Promise<Entity>;
export async function updateEntity(
  first: string,
  second: string | UpdateEntityInput,
  third?: UpdateEntityInput
): Promise<Entity> {
  // Support legacy call signature: updateEntity(universeAddress, entityId, input)
  let entityId: string;
  let input: UpdateEntityInput;

  if (typeof second === 'string') {
    entityId = second;
    input = third!;
  } else {
    entityId = first;
    input = second;
  }

  const ref = entitiesCol().doc(entityId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error('Entity not found');
  }

  const existing = doc.data() as Entity;

  if (input.parentId !== undefined && input.parentId !== existing.parentId) {
    await validateParent(existing.kind, input.parentId ?? null);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.universeAddress !== undefined)
    updates.universeAddress = input.universeAddress
      ? normalizeUniverseId(input.universeAddress)
      : null;
  if (input.parentId !== undefined) updates.parentId = input.parentId;
  if (input.nodeIds !== undefined) updates.nodeIds = input.nodeIds;
  if (input.imageUrl !== undefined) {
    updates.imageUrl = await pinEntityImage(input.imageUrl, entityId, existing.creator || 'system');
  }
  if (input.metadata !== undefined) updates.metadata = input.metadata;
  if (input.monetized !== undefined) {
    updates.monetized = input.monetized;
    if (input.monetized && !input.rightsDeclaration) {
      throw new Error('Rights declaration is required for monetized entities');
    }
    updates.rightsDeclaration = input.monetized ? input.rightsDeclaration! : null;
  } else if (input.rightsDeclaration !== undefined) {
    updates.rightsDeclaration = input.rightsDeclaration;
  }
  if (input.unstoppableDomain !== undefined) updates.unstoppableDomain = input.unstoppableDomain;

  await ref.update(updates);

  return { ...existing, ...updates, id: entityId } as Entity;
}

export async function deleteEntity(entityId: string): Promise<void>;
/** @deprecated universeAddress no longer needed */
export async function deleteEntity(universeAddress: string, entityId: string): Promise<void>;
export async function deleteEntity(first: string, second?: string): Promise<void> {
  const entityId = second ?? first;
  const col = entitiesCol();

  const children = await col.where('parentId', '==', entityId).limit(1).get();
  if (!children.empty) {
    throw new Error('Cannot delete entity with children. Remove or reparent children first.');
  }

  const ref = col.doc(entityId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Entity not found');
  }

  await ref.delete();
}

export async function addNodeToEntity(entityId: string, nodeId: number): Promise<Entity>;
/** @deprecated universeAddress no longer needed */
export async function addNodeToEntity(
  universeAddress: string,
  entityId: string,
  nodeId: number
): Promise<Entity>;
export async function addNodeToEntity(
  first: string,
  second: string | number,
  third?: number
): Promise<Entity> {
  let entityId: string;
  let nodeId: number;

  if (typeof second === 'number') {
    entityId = first;
    nodeId = second;
  } else {
    entityId = second;
    nodeId = third!;
  }

  const ref = entitiesCol().doc(entityId);
  const doc = await ref.get();

  if (!doc.exists) throw new Error('Entity not found');

  const existing = doc.data() as Entity;
  const nodeIds = existing.nodeIds || [];

  if (nodeIds.includes(nodeId)) {
    return { ...existing, id: entityId };
  }

  const updatedNodeIds = [...nodeIds, nodeId];
  await ref.update({ nodeIds: updatedNodeIds, updatedAt: new Date() });

  return { ...existing, id: entityId, nodeIds: updatedNodeIds };
}

export async function removeNodeFromEntity(entityId: string, nodeId: number): Promise<Entity>;
/** @deprecated universeAddress no longer needed */
export async function removeNodeFromEntity(
  universeAddress: string,
  entityId: string,
  nodeId: number
): Promise<Entity>;
export async function removeNodeFromEntity(
  first: string,
  second: string | number,
  third?: number
): Promise<Entity> {
  let entityId: string;
  let nodeId: number;

  if (typeof second === 'number') {
    entityId = first;
    nodeId = second;
  } else {
    entityId = second;
    nodeId = third!;
  }

  const ref = entitiesCol().doc(entityId);
  const doc = await ref.get();

  if (!doc.exists) throw new Error('Entity not found');

  const existing = doc.data() as Entity;
  const updatedNodeIds = (existing.nodeIds || []).filter((id) => id !== nodeId);
  await ref.update({ nodeIds: updatedNodeIds, updatedAt: new Date() });

  return { ...existing, id: entityId, nodeIds: updatedNodeIds };
}

// ── Search ──────────────────────────────────────────────────────────

/**
 * Search entities by name/description substring.
 * Firestore doesn't support full-text search, so we use a prefix-based
 * approach on the `name` field with client-side description filtering.
 */
export async function searchEntities(opts: {
  query: string;
  universeAddress?: string;
  kind?: EntityKind;
  limit?: number;
}): Promise<Entity[]> {
  const { query, universeAddress, kind, limit = 50 } = opts;
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Build base query
  let firestoreQuery: FirebaseFirestore.Query = entitiesCol();

  if (universeAddress) {
    firestoreQuery = firestoreQuery.where(
      'universeAddress',
      '==',
      normalizeUniverseId(universeAddress)
    );
  }
  if (kind) {
    firestoreQuery = firestoreQuery.where('kind', '==', kind);
  }

  // Firestore doesn't support LIKE, so we fetch more and filter in memory.
  // For a production system, use Algolia/Typesense/Meilisearch.
  const fetchLimit = Math.min(limit * 5, 500);
  const snapshot = await firestoreQuery.orderBy('createdAt', 'desc').limit(fetchLimit).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Entity)
    .filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q))
    )
    .slice(0, limit);
}

// ── Relationships ────────────────────────────────────────────────────

function relationsCol() {
  return db.collection('entityRelations');
}

export async function createRelation(
  sourceId: string,
  targetId: string,
  type: EntityRelationType,
  description: string,
  creator: string
): Promise<EntityRelation> {
  if (!ENTITY_RELATION_TYPES.includes(type)) {
    throw new Error(`Invalid relation type: ${type}`);
  }

  // Validate both entities exist
  const [sourceDoc, targetDoc] = await Promise.all([
    entitiesCol().doc(sourceId).get(),
    entitiesCol().doc(targetId).get(),
  ]);
  if (!sourceDoc.exists) throw new Error('Source entity not found');
  if (!targetDoc.exists) throw new Error('Target entity not found');
  if (sourceId === targetId) throw new Error('Cannot create a relationship to itself');

  const source = sourceDoc.data() as Entity;

  // Check for duplicate
  const existing = await relationsCol()
    .where('sourceId', '==', sourceId)
    .where('targetId', '==', targetId)
    .where('type', '==', type)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error('This relationship already exists');
  }

  const ref = relationsCol().doc();
  const now = new Date();
  const relation: EntityRelation = {
    id: ref.id,
    sourceId,
    targetId,
    type,
    description,
    universeAddress: source.universeAddress,
    creator: creator.toLowerCase(),
    createdAt: now,
  };

  await ref.set(relation);
  return relation;
}

export async function deleteRelation(relationId: string, caller: string): Promise<void> {
  const ref = relationsCol().doc(relationId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Relationship not found');
  const relation = doc.data() as EntityRelation;
  const callerLower = caller.toLowerCase();
  let authorized = (relation.creator || '').toLowerCase() === callerLower;
  if (!authorized && relation.sourceId) {
    const sourceDoc = await entitiesCol().doc(relation.sourceId).get();
    const source = sourceDoc.exists ? (sourceDoc.data() as Entity) : null;
    if (source?.creator?.toLowerCase() === callerLower) {
      authorized = true;
    }
  }
  if (!authorized) {
    throw new Error('Forbidden: only the relationship creator or source entity owner can delete');
  }
  await ref.delete();
}

type HydratedEntityRelation = EntityRelation & {
  sourceName: string;
  targetName: string;
  sourceKind: string;
  targetKind: string;
  sourceImageUrl: string | null;
  targetImageUrl: string | null;
};

/** Default cap on relations returned per call (per direction, then merged). */
const DEFAULT_RELATIONS_LIMIT = 100;

/**
 * Get relationships where entity is source OR target.
 *
 * Firestore can't OR across two fields, so we run two queries. Each direction
 * is now bounded by `limit` (default 100) instead of reading the entire
 * matching set unbounded. An optional `cursorId` (id of the last item from a
 * previous page) is applied to BOTH sub-queries via `startAfter`, so paging is
 * monotonic. `nextCursorId` is returned alongside the rows; it is non-null only
 * when a sub-query was saturated (i.e. more may exist).
 */
export async function getEntityRelations(
  entityId: string,
  opts?: { limit?: number; cursorId?: string }
): Promise<{ relations: HydratedEntityRelation[]; nextCursorId: string | null }> {
  const limit = opts?.limit ?? DEFAULT_RELATIONS_LIMIT;
  const rcol = relationsCol();

  const buildQuery = (field: 'sourceId' | 'targetId') =>
    rcol
      .where(field, '==', entityId)
      .orderBy('createdAt', 'desc')
      .orderBy('__name__', 'desc')
      .limit(limit);

  let sourceQuery: FirebaseFirestore.Query = buildQuery('sourceId');
  let targetQuery: FirebaseFirestore.Query = buildQuery('targetId');

  if (opts?.cursorId) {
    const cursorDoc = await rcol.doc(opts.cursorId).get();
    if (cursorDoc.exists) {
      sourceQuery = sourceQuery.startAfter(cursorDoc);
      targetQuery = targetQuery.startAfter(cursorDoc);
    }
  }

  // Firestore doesn't support OR queries across different fields,
  // so we run two bounded queries in parallel.
  const [asSourceSnap, asTargetSnap] = await Promise.all([sourceQuery.get(), targetQuery.get()]);

  const saturated = asSourceSnap.docs.length === limit || asTargetSnap.docs.length === limit;

  // Merge, de-dupe (an entity related to itself can't happen, but a doc can't
  // appear in both sets anyway), sort by createdAt desc, and cap to `limit`.
  const merged = new Map<string, EntityRelation>();
  for (const doc of [...asSourceSnap.docs, ...asTargetSnap.docs]) {
    merged.set(doc.id, { id: doc.id, ...doc.data() } as EntityRelation);
  }
  const relations = Array.from(merged.values())
    .sort((a, b) => {
      const at = (a.createdAt as any)?.toMillis?.() ?? new Date(a.createdAt as any).getTime() ?? 0;
      const bt = (b.createdAt as any)?.toMillis?.() ?? new Date(b.createdAt as any).getTime() ?? 0;
      return bt - at;
    })
    .slice(0, limit);

  const nextCursorId =
    saturated && relations.length > 0 ? relations[relations.length - 1].id : null;

  if (relations.length === 0) return { relations: [], nextCursorId: null };

  // Batch-fetch related entity names to avoid N+1
  const relatedIds = new Set<string>();
  for (const rel of relations) {
    relatedIds.add(rel.sourceId);
    relatedIds.add(rel.targetId);
  }

  const entityDocs = await Promise.all([...relatedIds].map((id) => entitiesCol().doc(id).get()));
  const entityMap = new Map<string, { name: string; kind: string; imageUrl: string | null }>();
  for (const doc of entityDocs) {
    if (doc.exists) {
      const data = doc.data() as Entity;
      entityMap.set(doc.id, { name: data.name, kind: data.kind, imageUrl: data.imageUrl });
    }
  }

  const hydrated: HydratedEntityRelation[] = relations.map((rel) => ({
    ...rel,
    sourceName: entityMap.get(rel.sourceId)?.name ?? 'Unknown',
    targetName: entityMap.get(rel.targetId)?.name ?? 'Unknown',
    sourceKind: entityMap.get(rel.sourceId)?.kind ?? 'unknown',
    targetKind: entityMap.get(rel.targetId)?.kind ?? 'unknown',
    sourceImageUrl: entityMap.get(rel.sourceId)?.imageUrl ?? null,
    targetImageUrl: entityMap.get(rel.targetId)?.imageUrl ?? null,
  }));

  return { relations: hydrated, nextCursorId };
}

/** Get all relationships within a universe. */
export async function getUniverseRelations(universeAddress: string): Promise<EntityRelation[]> {
  const snapshot = await relationsCol()
    .where('universeAddress', '==', normalizeUniverseId(universeAddress))
    .limit(200)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as EntityRelation);
}

/**
 * Atomically swap a node ID between two entities.
 * Removes nodeIdA from entityA and adds nodeIdB; removes nodeIdB from entityB and adds nodeIdA.
 * This is the off-chain counterpart to Universe.swapNodes() on-chain.
 */
export async function swapNodesBetweenEntities(
  entityIdA: string,
  nodeIdA: number,
  entityIdB: string,
  nodeIdB: number
): Promise<{ entityA: Entity; entityB: Entity }> {
  const col = entitiesCol();
  const refA = col.doc(entityIdA);
  const refB = col.doc(entityIdB);

  return await db.runTransaction(async (transaction) => {
    const [docA, docB] = await Promise.all([transaction.get(refA), transaction.get(refB)]);

    if (!docA.exists) throw new Error('Entity A not found');
    if (!docB.exists) throw new Error('Entity B not found');

    const existingA = docA.data() as Entity;
    const existingB = docB.data() as Entity;

    const nodeIdsA = existingA.nodeIds || [];
    const nodeIdsB = existingB.nodeIds || [];

    if (!nodeIdsA.includes(nodeIdA)) {
      throw new Error(`Node ${nodeIdA} not found on entity ${entityIdA}`);
    }
    if (!nodeIdsB.includes(nodeIdB)) {
      throw new Error(`Node ${nodeIdB} not found on entity ${entityIdB}`);
    }

    // Swap: replace nodeIdA with nodeIdB in A, replace nodeIdB with nodeIdA in B
    const updatedNodeIdsA = nodeIdsA.map((id) => (id === nodeIdA ? nodeIdB : id));
    const updatedNodeIdsB = nodeIdsB.map((id) => (id === nodeIdB ? nodeIdA : id));

    const now = new Date();
    transaction.update(refA, { nodeIds: updatedNodeIdsA, updatedAt: now });
    transaction.update(refB, { nodeIds: updatedNodeIdsB, updatedAt: now });

    return {
      entityA: { ...existingA, id: entityIdA, nodeIds: updatedNodeIdsA },
      entityB: { ...existingB, id: entityIdB, nodeIds: updatedNodeIdsB },
    };
  });
}
