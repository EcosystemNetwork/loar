/**
 * Hooks for the narrative ontology entity hierarchy.
 *
 * Uses tRPC + React Query to manage entities (Timeline, Reality, Dimension,
 * Plane, Realm, Domain) within a Universe.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '../utils/trpc';

/** All entity kinds — creator-facing + structural. */
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
  // Visual-language kinds — PRD 5
  'moodboard',
  'style_pack',
  // Real-person likeness kinds — PRD 8 (Verified Likeness Marketplace)
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

/** Creator-facing kinds shown in the Create hub and Wiki. */
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

/** Top-level structural kinds shown as first-class in the universe editor. */
export const PRIMARY_KINDS: EntityKind[] = ['timeline', 'realm'];

/** Secondary/advanced structural kinds. */
export const SECONDARY_KINDS: EntityKind[] = ['reality', 'dimension', 'plane', 'domain'];

export type RightsDeclaration = 'original' | 'licensed';

// ── Likeness Marketplace mirrors (kept in lockstep with server schemas) ────

export const LIKENESS_MODALITIES = ['face', 'body', 'video', '3d', 'full'] as const;
export type LikenessModality = (typeof LIKENESS_MODALITIES)[number];

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

export const LIKENESS_USE_CASE_LABELS: Record<LikenessUseCase, string> = {
  narrative_film: 'Narrative film / TV',
  advertising: 'Advertising',
  gaming: 'Gaming / interactive',
  education: 'Education',
  documentary: 'Documentary',
  social_media: 'Social media',
  music_video: 'Music video',
  audiobook: 'Audiobook',
  voice_assistant: 'Voice assistant',
  dubbing: 'Dubbing',
};

export const LIKENESS_PROHIBITIONS = [
  'political',
  'adult',
  'hate_speech',
  'defamatory',
  'misleading_endorsement',
  'illegal_activity',
] as const;
export type LikenessProhibition = (typeof LIKENESS_PROHIBITIONS)[number];

export const LIKENESS_PROHIBITION_LABELS: Record<LikenessProhibition, string> = {
  political: 'Political content',
  adult: 'Adult / sexual content',
  hate_speech: 'Hate speech',
  defamatory: 'Defamatory content',
  misleading_endorsement: 'Misleading endorsements',
  illegal_activity: 'Illegal activity',
};

export const LIKENESS_DEAL_TYPES = ['BUY', 'LEASE', 'LICENSE'] as const;
export type LikenessDealType = (typeof LIKENESS_DEAL_TYPES)[number];

/**
 * Click-through attestation text — must match the server's
 * `LIKENESS_ATTESTATION_TEXT_V1` exactly. Bumping this version requires a
 * coordinated server + client release.
 */
export const LIKENESS_ATTESTATION_TEXT_V1 =
  'I confirm that the biometric likeness (voice, face, body, or other identifying features) ' +
  'represented by this asset is either my own or that I hold all rights necessary to commercialize ' +
  'it. I authorize LOAR to make this asset available on the Likeness Marketplace under the ' +
  'modalities, use cases, and deal types I have selected, and I understand that buyers may use the ' +
  'asset only within those terms. I acknowledge that on-chain hashes cannot be deleted, and that ' +
  'revoking consent affects future deals only — existing licenses remain valid until expiry. ' +
  'I understand that LOAR may freeze or remove this listing if it is found to be unauthorized, ' +
  'and that misuse may carry legal liability.';

export interface Entity {
  id: string;
  name: string;
  description: string;
  kind: EntityKind;
  universeAddress: string | null;
  parentId: string | null;
  nodeIds: number[];
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  creator: string;
  monetized: boolean;
  rightsDeclaration: RightsDeclaration | null;
  unstoppableDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List all entities for a universe, optionally filtered by kind. */
export function useEntities(universeAddress: string | undefined, kind?: EntityKind) {
  return useQuery({
    ...trpc.entities.list.queryOptions({
      universeAddress: universeAddress as `0x${string}`,
      kind,
    }),
    enabled: !!universeAddress,
  });
}
