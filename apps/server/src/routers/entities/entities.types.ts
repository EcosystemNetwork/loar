/**
 * Entity types for the LOAR worldbuilding system.
 *
 * Two layers of kinds:
 *
 * CREATOR KINDS — the things people actually build fiction with:
 *   person, place, thing, faction, event, lore, species, vehicle, technology, organization
 *
 * STRUCTURAL KINDS — advanced ontology hierarchy inside a universe:
 *   timeline, reality, dimension, plane, realm, domain
 *
 * Universe itself is on-chain (not an entity). All entities are Firestore
 * documents in the top-level `entities` collection, optionally tagged with a
 * universeAddress.
 */

/** All entity kinds — creator-facing first, structural second. */
export const ENTITY_KINDS = [
  // Creator-facing kinds
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
  // Structural/ontology kinds
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Creator-facing kinds shown as first-class in the Create hub and Wiki. */
export const CREATOR_KINDS: EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
];

/** Advanced structural kinds for universe ontology. */
export const STRUCTURAL_KINDS: EntityKind[] = [
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
];

/** Legacy aliases for backwards compatibility. */
export const PRIMARY_KINDS: EntityKind[] = ['timeline', 'realm'];
export const SECONDARY_KINDS: EntityKind[] = ['reality', 'dimension', 'plane', 'domain'];

/**
 * Valid parent-child relationships for structural kinds.
 * Creator kinds can have any parent or none.
 * null means direct child of the Universe root (or standalone with no universe).
 */
export const VALID_PARENTS: Record<EntityKind, (EntityKind | null)[]> = {
  // Creator kinds — can exist anywhere
  person: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  place: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  thing: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  faction: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  event: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  lore: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  species: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  vehicle: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  technology: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  organization: [null, ...STRUCTURAL_KINDS, ...CREATOR_KINDS],
  // Structural kinds — follow ontology hierarchy
  timeline: [null],
  reality: [null, 'timeline'],
  dimension: ['timeline', 'reality'],
  plane: ['dimension', 'reality'],
  realm: [null, 'timeline', 'reality', 'dimension'],
  domain: ['realm'],
};

/** Human-readable labels for each kind. */
export const KIND_LABELS: Record<EntityKind, string> = {
  person: 'Person',
  place: 'Place',
  thing: 'Thing / Artifact',
  faction: 'Faction',
  event: 'Event',
  lore: 'Lore Page',
  species: 'Species',
  vehicle: 'Vehicle',
  technology: 'Technology',
  organization: 'Organization',
  timeline: 'Timeline',
  reality: 'Reality',
  dimension: 'Dimension',
  plane: 'Plane',
  realm: 'Realm',
  domain: 'Domain',
};

/** Plural labels for wiki section headings. */
export const KIND_PLURAL_LABELS: Record<EntityKind, string> = {
  person: 'People',
  place: 'Places',
  thing: 'Things',
  faction: 'Factions',
  event: 'Events',
  lore: 'Lore',
  species: 'Species',
  vehicle: 'Vehicles',
  technology: 'Technology',
  organization: 'Organizations',
  timeline: 'Timelines',
  reality: 'Realities',
  dimension: 'Dimensions',
  plane: 'Planes',
  realm: 'Realms',
  domain: 'Domains',
};

/** Rights declaration for monetized entities. */
export type RightsDeclaration = 'original' | 'licensed';

/** Firestore document shape for a narrative entity. */
export interface Entity {
  id: string;
  name: string;
  description: string;
  kind: EntityKind;
  /** The universe this entity belongs to. Null = standalone (no universe assigned yet). */
  universeAddress: string | null;
  parentId: string | null;
  nodeIds: number[];
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  creator: string;
  /** Whether the creator intends to monetize (sell/license) this entity. */
  monetized: boolean;
  /** Rights declaration — required when monetized is true. */
  rightsDeclaration: RightsDeclaration | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new entity (server-generated fields omitted). */
export interface CreateEntityInput {
  name: string;
  description: string;
  kind: EntityKind;
  /** Optional — creator kinds can exist without a universe. */
  universeAddress?: string | null;
  parentId?: string | null;
  nodeIds?: number[];
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
  /** Whether the creator intends to monetize this entity. Defaults to false. */
  monetized?: boolean;
  /** Required when monetized is true. Must be 'original' or 'licensed'. */
  rightsDeclaration?: RightsDeclaration | null;
}

/** Input for updating an existing entity. */
export interface UpdateEntityInput {
  name?: string;
  description?: string;
  universeAddress?: string | null;
  parentId?: string | null;
  nodeIds?: number[];
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
  monetized?: boolean;
  rightsDeclaration?: RightsDeclaration | null;
}
