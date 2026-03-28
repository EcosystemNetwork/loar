/**
 * Firestore handlers for narrative entities (Timeline, Reality, Dimension, Plane, Realm, Domain).
 *
 * Entities are stored as a subcollection under each universe:
 *   cinematicUniverses/{universeAddress}/entities/{entityId}
 *
 * This keeps queries scoped to a single universe and avoids cross-universe leakage.
 */
import { db } from '../../lib/firebase';
import {
  type Entity,
  type CreateEntityInput,
  type UpdateEntityInput,
  type EntityKind,
  ENTITY_KINDS,
  VALID_PARENTS,
} from './entities.types';

function entitiesCol(universeAddress: string) {
  return db
    .collection('cinematicUniverses')
    .doc(universeAddress.toLowerCase())
    .collection('entities');
}

/** Validate that the parent relationship is allowed by the ontology. */
async function validateParent(
  universeAddress: string,
  kind: EntityKind,
  parentId: string | null
): Promise<void> {
  const allowed = VALID_PARENTS[kind];

  if (parentId === null || parentId === undefined) {
    if (!allowed.includes(null)) {
      throw new Error(
        `Entity kind "${kind}" requires a parent. Valid parents: ${allowed.filter(Boolean).join(', ')}`
      );
    }
    return;
  }

  // Fetch the parent entity and check its kind
  const parentDoc = await entitiesCol(universeAddress).doc(parentId).get();
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
  await validateParent(input.universeAddress, input.kind, parentId);

  const col = entitiesCol(input.universeAddress);
  const ref = col.doc();
  const now = new Date();

  const entity: Entity = {
    id: ref.id,
    name: input.name,
    description: input.description,
    kind: input.kind,
    universeAddress: input.universeAddress.toLowerCase(),
    parentId,
    nodeIds: input.nodeIds ?? [],
    imageUrl: input.imageUrl ?? null,
    metadata: input.metadata ?? {},
    creator,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(entity);
  return { id: ref.id, data: entity };
}

export async function getEntity(universeAddress: string, entityId: string): Promise<Entity | null> {
  const doc = await entitiesCol(universeAddress).doc(entityId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as Entity;
}

export async function getEntitiesByUniverse(
  universeAddress: string,
  kind?: EntityKind
): Promise<Entity[]> {
  const col = entitiesCol(universeAddress);
  let query: FirebaseFirestore.Query = col.orderBy('createdAt');

  if (kind) {
    query = col.where('kind', '==', kind).orderBy('createdAt');
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
}

export async function getChildEntities(
  universeAddress: string,
  parentId: string
): Promise<Entity[]> {
  const snapshot = await entitiesCol(universeAddress)
    .where('parentId', '==', parentId)
    .orderBy('createdAt')
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);
}

export async function updateEntity(
  universeAddress: string,
  entityId: string,
  input: UpdateEntityInput
): Promise<Entity> {
  const col = entitiesCol(universeAddress);
  const ref = col.doc(entityId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error('Entity not found');
  }

  const existing = doc.data() as Entity;

  // If parentId is changing, validate the new relationship
  if (input.parentId !== undefined && input.parentId !== existing.parentId) {
    await validateParent(universeAddress, existing.kind, input.parentId ?? null);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.parentId !== undefined) updates.parentId = input.parentId;
  if (input.nodeIds !== undefined) updates.nodeIds = input.nodeIds;
  if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
  if (input.metadata !== undefined) updates.metadata = input.metadata;

  await ref.update(updates);

  return { ...existing, ...updates, id: entityId } as Entity;
}

export async function deleteEntity(universeAddress: string, entityId: string): Promise<void> {
  const col = entitiesCol(universeAddress);

  // Check for child entities — prevent orphaning
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

export async function addNodeToEntity(
  universeAddress: string,
  entityId: string,
  nodeId: number
): Promise<Entity> {
  const col = entitiesCol(universeAddress);
  const ref = col.doc(entityId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error('Entity not found');
  }

  const existing = doc.data() as Entity;
  const nodeIds = existing.nodeIds || [];

  if (nodeIds.includes(nodeId)) {
    return { ...existing, id: entityId };
  }

  const updatedNodeIds = [...nodeIds, nodeId];
  await ref.update({ nodeIds: updatedNodeIds, updatedAt: new Date() });

  return { ...existing, id: entityId, nodeIds: updatedNodeIds };
}

export async function removeNodeFromEntity(
  universeAddress: string,
  entityId: string,
  nodeId: number
): Promise<Entity> {
  const col = entitiesCol(universeAddress);
  const ref = col.doc(entityId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error('Entity not found');
  }

  const existing = doc.data() as Entity;
  const updatedNodeIds = (existing.nodeIds || []).filter((id) => id !== nodeId);
  await ref.update({ nodeIds: updatedNodeIds, updatedAt: new Date() });

  return { ...existing, id: entityId, nodeIds: updatedNodeIds };
}
