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
  // Real-person likeness kinds (PRD 8: Verified Likeness Marketplace).
  // Separate from `person` (which is a fictional character in a universe) —
  // these represent a real creator's own biometric likeness, listed for
  // sale / lease / license through likenessMarketplace.
  'voice',
  'likeness',
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

/**
 * Real-person likeness kinds — kept separate from CREATOR_KINDS so the wiki /
 * universe surfaces (which expect fictional content) don't accidentally render
 * a creator's real biometric assets alongside their stories. Likeness entities
 * surface exclusively in the Likeness Marketplace.
 */
export const LIKENESS_KINDS: EntityKind[] = ['voice', 'likeness'];

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
  // Likeness kinds — owned directly by the creator, no universe relationship
  voice: [null],
  likeness: [null],
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
  voice: 'Voice',
  likeness: 'Likeness',
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
  voice: 'Voices',
  likeness: 'Likenesses',
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

// ── Visual Descriptor (VLM canonical visual memory — PRD VLM subsystem §12) ──

/**
 * Role a reference asset plays in describing an entity's canonical look.
 * Used by the generation pipeline to select the right conditioning input.
 */
export const DESCRIPTOR_REFERENCE_ROLES = [
  'identity',
  'outfit',
  'location',
  'prop',
  'emblem',
] as const;
export type DescriptorReferenceRole = (typeof DESCRIPTOR_REFERENCE_ROLES)[number];

/** Hard cap on reference assets stored on a descriptor (matches PRD §12.1). */
export const MAX_DESCRIPTOR_REFERENCES = 8;

/**
 * A single reference asset carried on a descriptor — a canonical frame / pose
 * / emblem used as image conditioning for future generations.
 */
export interface DescriptorReferenceAsset {
  /** Content-addressed ID (Pinata/Lighthouse). */
  cid: string;
  /** Gateway URL at time of write. */
  mediaUrl: string;
  /** Source content (gallery item) this frame was extracted from. */
  sourceContentId?: string;
  /** Scene index within the source, when applicable. */
  sourceSceneIndex?: number;
  /** What this asset contributes to the descriptor. */
  role: DescriptorReferenceRole;
  /** Higher priority = preferred for conditioning when the cap is hit. */
  priority: number;
  /** Creator-pinned assets cannot be displaced by VLM auto-refresh. */
  pinnedByCreator?: boolean;
}

/**
 * VLM-maintained canonical visual record for an entity. Written initially when
 * an entity proposal is accepted and refreshed as new canon extractions
 * accumulate evidence. Prior versions archive to the `descriptorHistory`
 * subcollection so creators can revert.
 */
export interface EntityVisualDescriptor {
  /** Monotonically increasing; bumped on every accepted change. */
  version: number;
  /** Paragraph-form description injected into generation prompts. */
  canonicalDescription: string;
  /** Structured features (kind-specific keys). */
  attributes: Record<string, string | string[]>;
  /** Pinned reference frames passed to the model as image conditioning. */
  referenceAssets: DescriptorReferenceAsset[];
  lastUpdatedBy: 'vlm' | 'creator' | 'admin';
  updatedAt: Date;
  /** Extraction that produced this version, when written by the VLM pipeline. */
  sourceExtractionId?: string;
}

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
  /** VLM-maintained canonical visual memory — see PRD VLM subsystem §12. */
  visualDescriptor: EntityVisualDescriptor | null;
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

// ── Likeness Marketplace (PRD 8: Verified Likeness Marketplace) ───────────

/**
 * Modalities a `likeness` entity can include. A multimodal likeness lists
 * multiple values; a voice-only listing uses the `voice` kind instead so the
 * marketplace browse can filter quickly without inspecting metadata.
 */
export const LIKENESS_MODALITIES = ['face', 'body', 'video', '3d', 'full'] as const;
export type LikenessModality = (typeof LIKENESS_MODALITIES)[number];

/** Metadata shape for a `voice` entity. */
export interface VoiceEntityMetadata {
  /** ElevenLabs voice_id this entity wraps. */
  elevenLabsVoiceId: string;
  /** How the underlying voice was created. */
  source: 'clone' | 'design';
  /** Auto-rendered preview (rehosted to Pinata). */
  previewUrl?: string;
  /** Original audio uploads that produced the clone. */
  sourceSampleUrls?: string[];
  gender?: 'male' | 'female' | 'neutral';
  age?: 'young' | 'middle_aged' | 'old';
  accent?: string;
  /** BCP-47 locale tag, e.g. "en-US". */
  locale?: string;
  /** Free-form descriptor tags. */
  tags?: string[];
}

/** Metadata shape for a `likeness` entity (face / body / video / 3d / full). */
export interface LikenessEntityMetadata {
  modalities: LikenessModality[];
  /** Reference images of the face. */
  faceImageUrls?: string[];
  /** Reference images of the body / pose. */
  bodyImageUrls?: string[];
  /** Idle / expression video clips. */
  videoUrls?: string[];
  /** Optional 3D scan asset. */
  threeDAssetUrl?: string;
  /** Optional companion voice entity (so a full likeness bundles voice). */
  linkedVoiceEntityId?: string;
  /** Self-reported subject demographics — surfaced as filters. */
  gender?: string;
  ethnicity?: string;
  approximateAge?: number;
  /** True for a real human; false for an AI persona / fictional digital twin. */
  realPerson: boolean;
}

// ── Consent attestation ───────────────────────────────────────────────────

/**
 * Allowed use cases a creator can opt their likeness into. The marketplace
 * surfaces each as a separate license-scope toggle so buyers can only request
 * uses the rights holder explicitly authorized.
 */
export const LIKENESS_USE_CASES = [
  'narrative_film',
  'advertising',
  'gaming',
  'education',
  'documentary',
  'social_media',
  'music_video',
  'audiobook',
  'voice_assistant',
  'dubbing',
] as const;
export type LikenessUseCase = (typeof LIKENESS_USE_CASES)[number];

/** Hard prohibitions enforced server-side regardless of buyer license terms. */
export const LIKENESS_PROHIBITIONS = [
  'political',
  'adult',
  'hate_speech',
  'defamatory',
  'misleading_endorsement',
  'illegal_activity',
] as const;
export type LikenessProhibition = (typeof LIKENESS_PROHIBITIONS)[number];

/**
 * Consent attestation captured before an entity can be listed for sale /
 * lease / license. Persisted to `likenessConsents/{entityId}/{revisionId}`.
 *
 * For Phase 1 we accept a click-through attestation (the creator's
 * authenticated wallet + a literal acknowledgement string) — Phase 4 will
 * add KYC, liveness verification, and a signed message of the attestation
 * hash to upgrade `verified` to true.
 */
export interface LikenessConsent {
  /** UUID for this consent revision. */
  id: string;
  /** Entity this consent is attached to. */
  entityId: string;
  /** Wallet address of the rights holder (the creator). */
  rightsHolderAddress: string;
  /** Server uid of the rights holder. */
  rightsHolderUid: string;
  /** Modalities this consent authorizes. */
  modalities: LikenessModality[];
  /** Use cases the rights holder opts in to. */
  allowedUseCases: LikenessUseCase[];
  /** Hard "never these uses" overrides — defaults to the full prohibition set. */
  prohibitions: LikenessProhibition[];
  /** Buy / lease / license each toggled independently. */
  permitSale: boolean;
  permitLease: boolean;
  permitLicense: boolean;
  /** Subject is a real living person (default true). False for AI personas. */
  realPerson: boolean;
  /** True only after KYC + liveness + biometric match (Phase 4). */
  verified: boolean;
  /** Literal acknowledgement text the user clicked through. */
  attestationText: string;
  /** Optional EIP-191 signature of `attestationText` for stronger non-repudiation. */
  attestationSignature?: string;
  /** Marketplace status — `frozen` blocks new deals; `revoked` is irreversible. */
  status: 'active' | 'frozen' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}

/** The canonical attestation text v1 — copy in lockstep with `submitConsent`. */
export const LIKENESS_ATTESTATION_TEXT_V1 =
  'I confirm that the biometric likeness (voice, face, body, or other identifying features) ' +
  'represented by this asset is either my own or that I hold all rights necessary to commercialize ' +
  'it. I authorize LOAR to make this asset available on the Likeness Marketplace under the ' +
  'modalities, use cases, and deal types I have selected, and I understand that buyers may use the ' +
  'asset only within those terms. I acknowledge that on-chain hashes cannot be deleted, and that ' +
  'revoking consent affects future deals only — existing licenses remain valid until expiry. ' +
  'I understand that LOAR may freeze or remove this listing if it is found to be unauthorized, ' +
  'and that misuse may carry legal liability.';

// ── Listings + Deals ──────────────────────────────────────────────────────

export const LIKENESS_DEAL_TYPES = ['BUY', 'LEASE', 'LICENSE'] as const;
export type LikenessDealType = (typeof LIKENESS_DEAL_TYPES)[number];

/** Firestore shape for a marketplace listing. */
export interface LikenessListing {
  id: string;
  entityId: string;
  entityKind: 'voice' | 'likeness';
  /** Snapshot of the consent that authorized the listing (immutable per revision). */
  consentId: string;
  sellerUid: string;
  sellerAddress: string;
  /** Display fields copied from the entity at create time so browse is cheap. */
  title: string;
  description: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  modalities: LikenessModality[];
  /** Wei-as-string for big-money safety. "0" means "deal type disabled". */
  buyPriceWei: string;
  leasePricePerDayWei: string;
  licenseFeeWei: string;
  /** Ongoing royalty bps for LICENSE deals (0-5000). */
  licenseRoyaltyBps: number;
  /** Maximum days a single lease/license can run. Capped at 365 (matches contract). */
  maxDurationDays: number;
  /** Listing is hidden from browse when false. */
  active: boolean;
  totalSales: number;
  totalRevenueWei: string;
  // ── Phase 1.5: on-chain ContentLicensing.sol mirror ────────────────────
  /** bytes32 contentHash registered with ContentLicensing.sol. Null until publishOnChain. */
  onChainContentHash: string | null;
  /** Chain ID the registration lives on (11155111 = Sepolia, 84532 = Base Sepolia). */
  onChainChainId: number | null;
  /** ContentLicensing contract address on `onChainChainId`. */
  onChainContentLicensingAddress: string | null;
  /** Hash of the registerContent transaction (proves the listing is live on-chain). */
  onChainRegisterTxHash: string | null;
  /** Hash of the setRightsWithCreatorSig transaction submitted by the operator. */
  onChainRightsTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Firestore shape for an executed deal. */
export interface LikenessDeal {
  id: string;
  listingId: string;
  entityId: string;
  dealType: LikenessDealType;
  sellerUid: string;
  sellerAddress: string;
  buyerUid: string;
  buyerAddress: string;
  pricePaidWei: string;
  durationDays: number | null;
  /** Lease/License expiry. Null for BUY. */
  endTime: Date | null;
  txHash: string;
  /** ACTIVE → EXPIRED via checkAccess or off-chain sweep. */
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  /** Buyer's use-case declaration at deal time. Must be within the listing's allowed set. */
  declaredUseCase: LikenessUseCase;
  startTime: Date;
  /** True when the tx was routed through ContentLicensing.sol (vs. direct transfer). */
  onChain: boolean;
  /** On-chain dealId from ContentLicensing.sol — used for hasAccessFast queries. */
  onChainDealId: string | null;
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
