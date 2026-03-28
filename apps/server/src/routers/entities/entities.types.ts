/**
 * Ontology entity types for the LOAR narrative hierarchy.
 *
 * Hierarchy: Universe → Timeline/Reality → Dimension/Plane → Realm → Domain
 *
 * Universe is the root (on-chain contract). All sub-entities are Firestore documents
 * that organize and tag on-chain VideoNodes into narrative structures.
 */

/** The six sub-universe entity kinds. Universe itself is on-chain, not an entity. */
export const ENTITY_KINDS = [
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Top-level entity kinds shown as first-class in the UI. */
export const PRIMARY_KINDS: EntityKind[] = ['timeline', 'realm'];

/** Secondary/advanced entity kinds. */
export const SECONDARY_KINDS: EntityKind[] = ['reality', 'dimension', 'plane', 'domain'];

/**
 * Valid parent-child relationships in the ontology.
 * null parent means direct child of the Universe root.
 */
export const VALID_PARENTS: Record<EntityKind, (EntityKind | null)[]> = {
  timeline: [null], // Direct child of Universe
  reality: [null, 'timeline'], // Direct child or under a Timeline
  dimension: ['timeline', 'reality'],
  plane: ['dimension', 'reality'],
  realm: [null, 'timeline', 'reality', 'dimension'],
  domain: ['realm'],
};

/** Firestore document shape for a narrative entity. */
export interface Entity {
  id: string;
  name: string;
  description: string;
  kind: EntityKind;
  universeAddress: string;
  parentId: string | null;
  nodeIds: number[];
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  creator: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new entity (server-generated fields omitted). */
export interface CreateEntityInput {
  name: string;
  description: string;
  kind: EntityKind;
  universeAddress: string;
  parentId?: string | null;
  nodeIds?: number[];
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/** Input for updating an existing entity. */
export interface UpdateEntityInput {
  name?: string;
  description?: string;
  parentId?: string | null;
  nodeIds?: number[];
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
}
