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
    universeAddress: input.universeAddress ? input.universeAddress.toLowerCase() : null,
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

export async function getEntitiesByUniverse(
  universeAddress: string,
  kind?: EntityKind
): Promise<Entity[]> {
  const col = entitiesCol();
  let query: FirebaseFirestore.Query = col.where(
    'universeAddress',
    '==',
    universeAddress.toLowerCase()
  );

  if (kind) {
    query = query.where('kind', '==', kind);
  }

  query = query.orderBy('createdAt', 'desc');

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
}

export async function getEntitiesByKind(kind: EntityKind, limit = 100): Promise<Entity[]> {
  const snapshot = await entitiesCol()
    .where('kind', '==', kind)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
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
    updates.universeAddress = input.universeAddress ? input.universeAddress.toLowerCase() : null;
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
    firestoreQuery = firestoreQuery.where('universeAddress', '==', universeAddress.toLowerCase());
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

/** Get all relationships where entity is source OR target. */
export async function getEntityRelations(entityId: string): Promise<
  Array<
    EntityRelation & {
      sourceName: string;
      targetName: string;
      sourceKind: string;
      targetKind: string;
      sourceImageUrl: string | null;
      targetImageUrl: string | null;
    }
  >
> {
  // Firestore doesn't support OR queries across different fields,
  // so we run two queries in parallel
  const [asSourceSnap, asTargetSnap] = await Promise.all([
    relationsCol().where('sourceId', '==', entityId).get(),
    relationsCol().where('targetId', '==', entityId).get(),
  ]);

  const relations = [
    ...asSourceSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as EntityRelation),
    ...asTargetSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as EntityRelation),
  ];

  if (relations.length === 0) return [];

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

  return relations.map((rel) => ({
    ...rel,
    sourceName: entityMap.get(rel.sourceId)?.name ?? 'Unknown',
    targetName: entityMap.get(rel.targetId)?.name ?? 'Unknown',
    sourceKind: entityMap.get(rel.sourceId)?.kind ?? 'unknown',
    targetKind: entityMap.get(rel.targetId)?.kind ?? 'unknown',
    sourceImageUrl: entityMap.get(rel.sourceId)?.imageUrl ?? null,
    targetImageUrl: entityMap.get(rel.targetId)?.imageUrl ?? null,
  }));
}

/** Get all relationships within a universe. */
export async function getUniverseRelations(universeAddress: string): Promise<EntityRelation[]> {
  const snapshot = await relationsCol()
    .where('universeAddress', '==', universeAddress.toLowerCase())
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
