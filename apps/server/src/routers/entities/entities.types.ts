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
  // Visual-language kinds — PRD 5 (Retexture, Moodboards, House Style Packs)
  'moodboard',
  'style_pack',
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
  'moodboard',
  'style_pack',
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
  // Visual-language kinds — live at the universe level, no structural parent
  moodboard: [null],
  style_pack: [null],
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
  moodboard: 'Moodboard',
  style_pack: 'Style Pack',
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
  moodboard: 'Moodboards',
  style_pack: 'Style Packs',
  timeline: 'Timelines',
  reality: 'Realities',
  dimension: 'Dimensions',
  plane: 'Planes',
  realm: 'Realms',
  domain: 'Domains',
};

/** Rights declaration for monetized entities. */
export type RightsDeclaration = 'original' | 'licensed';

// ── Reference Bundle (Character Identity Lock + Multi-Reference Editing) ──

/**
 * Reference slots for identity conditioning. Each slot holds one or more
 * reference image URLs that image/video generators consume to keep a subject
 * on-model across edits and generations.
 */
export const REFERENCE_SLOTS = ['character', 'outfit', 'prop', 'environment', 'style'] as const;
export type ReferenceSlot = (typeof REFERENCE_SLOTS)[number];

export const REFERENCE_SLOT_LABELS: Record<ReferenceSlot, string> = {
  character: 'Character',
  outfit: 'Outfit',
  prop: 'Prop',
  environment: 'Environment',
  style: 'Style',
};

/** Lock toggles that constrain which attributes must be preserved in outputs. */
export const IDENTITY_LOCKS = ['face', 'costume', 'colors', 'silhouette'] as const;
export type IdentityLock = (typeof IDENTITY_LOCKS)[number];

export const IDENTITY_LOCK_LABELS: Record<IdentityLock, string> = {
  face: 'Lock Face',
  costume: 'Lock Costume',
  colors: 'Lock Colors',
  silhouette: 'Lock Silhouette',
};

/** Maximum refs per slot — provider-agnostic ceiling. */
export const MAX_REFS_PER_SLOT = 3;

/**
 * Reference bundle attached to an entity. Child entities inherit from their
 * parent chain; explicit slot values on the child override inherited ones.
 */
export interface ReferenceBundle {
  /** Per-slot reference image URLs (already uploaded to LOAR storage). */
  slots: Partial<Record<ReferenceSlot, string[]>>;
  /** Which attributes must be preserved verbatim in outputs. */
  locks: Partial<Record<IdentityLock, boolean>>;
  /** Weighting for reference conditioning. 0..1. */
  identityStrength: number;
  updatedAt: Date;
}

/** Empty bundle used as a starting point client-side. */
export const EMPTY_REFERENCE_BUNDLE: ReferenceBundle = {
  slots: {},
  locks: {},
  identityStrength: 0.7,
  updatedAt: new Date(0),
};

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
  /** Optional Unstoppable Domains name (e.g. "mycharacter.crypto"). */
  unstoppableDomain: string | null;
  /** Reference bundle for identity lock + multi-reference editing. */
  referenceBundle: ReferenceBundle | null;
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
  /** Optional Unstoppable Domains name (e.g. "mycharacter.crypto"). */
  unstoppableDomain?: string | null;
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
  /** Optional Unstoppable Domains name (e.g. "mycharacter.crypto"). */
  unstoppableDomain?: string | null;
}

/** Relationship type between entities. */
export type EntityRelationType =
  | 'allied_with'
  | 'enemy_of'
  | 'member_of'
  | 'located_in'
  | 'created_by'
  | 'owns'
  | 'related_to'
  | 'appears_in'
  | 'rules'
  | 'uses';

export const ENTITY_RELATION_TYPES: EntityRelationType[] = [
  'allied_with',
  'enemy_of',
  'member_of',
  'located_in',
  'created_by',
  'owns',
  'related_to',
  'appears_in',
  'rules',
  'uses',
];

/** Human-readable labels for relation types. */
export const RELATION_LABELS: Record<EntityRelationType, string> = {
  allied_with: 'Allied With',
  enemy_of: 'Enemy Of',
  member_of: 'Member Of',
  located_in: 'Located In',
  created_by: 'Created By',
  owns: 'Owns',
  related_to: 'Related To',
  appears_in: 'Appears In',
  rules: 'Rules',
  uses: 'Uses',
};

/** Inverse relation types for bidirectional display. */
export const INVERSE_RELATIONS: Partial<Record<EntityRelationType, string>> = {
  allied_with: 'Allied With',
  enemy_of: 'Enemy Of',
  member_of: 'Has Member',
  located_in: 'Contains',
  created_by: 'Creator Of',
  owns: 'Owned By',
  related_to: 'Related To',
  appears_in: 'Features',
  rules: 'Ruled By',
  uses: 'Used By',
};

/**
 * Reference image stored on a moodboard or style pack.
 * `url` is the final public URL (Pinata/IPFS); `contentHash` is the SHA-256
 * canonical content hash from the storage manager.
 */
export interface StyleReferenceImage {
  url: string;
  contentHash?: string;
  note?: string;
}

/** Expected metadata shape for a moodboard entity. */
export interface MoodboardMetadata {
  /** Ordered list of reference images curated into this moodboard. */
  referenceImages?: StyleReferenceImage[];
  /** Free-form tags — "neon", "overcast", "low-contrast", etc. */
  tags?: string[];
  /** Short paragraph describing the intended feel. */
  notes?: string;
}

/** Expected metadata shape for a style_pack entity. */
export interface StylePackMetadata {
  /**
   * Named preset this pack is built on — anime, gritty-scifi, graphic-novel,
   * clay, painterly, vhs, etc. Free-form string; the UI surfaces common ones
   * via a datalist.
   */
  basePreset?: string;
  /** Style prompt fragment prepended when this pack is active. */
  stylePrompt?: string;
  /** Negative prompt fragment merged when this pack is active. */
  negativePrompt?: string;
  /** Short keywords describing the pack — "ink lines", "rim light". */
  styleKeywords?: string[];
  /** Reference images that communicate the pack's look. */
  referenceImages?: StyleReferenceImage[];
  /** Default 0..1 strength applied when a creator picks this pack. */
  defaultStrength?: number;
}

/** Firestore document for an entity relationship. */
export interface EntityRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: EntityRelationType;
  /** Optional description of how the relationship manifests. */
  description: string;
  /** Universe this relationship belongs to (for scoping). */
  universeAddress: string | null;
  creator: string;
  createdAt: Date;
}
