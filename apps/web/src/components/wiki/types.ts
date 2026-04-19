/**
 * Shared types for the wiki feature surface.
 *
 * The backend Entity shape lives in apps/server/src/routers/entities/entities.types.ts;
 * this is the trimmed view the wiki UI consumes via tRPC.
 */

export type EntityKind =
  | 'person'
  | 'place'
  | 'thing'
  | 'faction'
  | 'event'
  | 'lore'
  | 'species'
  | 'vehicle'
  | 'technology'
  | 'organization'
  | 'moodboard'
  | 'style_pack'
  | 'timeline'
  | 'reality'
  | 'dimension'
  | 'plane'
  | 'realm'
  | 'domain';

export type RightsDeclaration = 'original' | 'licensed' | null;

export interface WikiEntity {
  id: string;
  name: string;
  description: string;
  kind: string;
  imageUrl: string | null;
  universeAddress: string | null;
  metadata: Record<string, unknown>;
  monetized?: boolean;
  rightsDeclaration?: RightsDeclaration;
  creator?: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
}

/** All wiki tab IDs — entity kinds plus the synthetic views. */
export type WikiTab =
  | EntityKind
  | 'gallery'
  | 'collection'
  | '3d-models'
  | 'character-profiles'
  | 'episodes'
  | 'audio'
  | 'graph'
  | 'event-timeline'
  | 'places-map'
  | 'az-index'
  | 'activity'
  | 'stats'
  | 'creators'
  | 'bookmarks';

export type WikiSort = 'newest' | 'oldest' | 'a-z' | 'z-a';
