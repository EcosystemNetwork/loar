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
import {
  type Entity,
  type CreateEntityInput,
  type UpdateEntityInput,
  type EntityKind,
  ENTITY_KINDS,
  VALID_PARENTS,
  STRUCTURAL_KINDS,
} from './entities.types';

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
  if (!STRUCTURAL_KINDS.includes(kind as any)) return;

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

  const col = entitiesCol();
  const ref = col.doc();
  const now = new Date();

  const monetized = input.monetized ?? false;
  if (monetized && !input.rightsDeclaration) {
    throw new Error('Rights declaration is required for monetized entities');
  }

  const entity: Entity = {
    id: ref.id,
    name: input.name,
    description: input.description,
    kind: input.kind,
    universeAddress: input.universeAddress ? input.universeAddress.toLowerCase() : null,
    parentId,
    nodeIds: input.nodeIds ?? [],
    imageUrl: input.imageUrl ?? null,
    metadata: input.metadata ?? {},
    creator: creator.toLowerCase(),
    monetized,
    rightsDeclaration: monetized ? input.rightsDeclaration! : null,
    unstoppableDomain: input.unstoppableDomain ?? null,
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

  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Entity)
    .sort((a, b) => {
      const aTime =
        a.createdAt instanceof Date
          ? a.createdAt.getTime()
          : new Date(a.createdAt as any).getTime();
      const bTime =
        b.createdAt instanceof Date
          ? b.createdAt.getTime()
          : new Date(b.createdAt as any).getTime();
      return aTime - bTime;
    });
}

export async function getEntitiesByKind(kind: EntityKind, limit = 100): Promise<Entity[]> {
  const snapshot = await entitiesCol().where('kind', '==', kind).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Entity)
    .sort((a, b) => {
      const aTime =
        a.createdAt instanceof Date
          ? a.createdAt.getTime()
          : new Date(a.createdAt as any).getTime();
      const bTime =
        b.createdAt instanceof Date
          ? b.createdAt.getTime()
          : new Date(b.createdAt as any).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);
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

  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Entity)
    .sort((a, b) => {
      const aTime =
        a.createdAt instanceof Date
          ? a.createdAt.getTime()
          : new Date(a.createdAt as any).getTime();
      const bTime =
        b.createdAt instanceof Date
          ? b.createdAt.getTime()
          : new Date(b.createdAt as any).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);
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
  const snapshot = await entitiesCol().where('parentId', '==', parentId).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Entity)
    .sort((a, b) => {
      const aTime =
        a.createdAt instanceof Date
          ? a.createdAt.getTime()
          : new Date(a.createdAt as any).getTime();
      const bTime =
        b.createdAt instanceof Date
          ? b.createdAt.getTime()
          : new Date(b.createdAt as any).getTime();
      return aTime - bTime;
    })
    .slice(0, limit);
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
  if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
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
