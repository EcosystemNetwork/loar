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

/**
 * Short hierarchy-aware blurbs for the structural kinds. Surfaced at the top
 * of each structural tab so creators don't have to guess the difference
 * between Timeline / Reality / Dimension / Plane / Realm / Domain.
 *
 * Hierarchy reminder: Universe → Timeline → Reality → Dimension → Plane → Realm → Domain.
 */
export const STRUCTURAL_KIND_DESCRIPTIONS: Record<
  'timeline' | 'reality' | 'dimension' | 'plane' | 'realm' | 'domain',
  string
> = {
  timeline:
    'Alternate history branches inside a Universe — same world, different sequence of events. Use for what-ifs, season resets, or community-voted divergences.',
  reality:
    'Drastic alternate versions of the same Universe — different physics, genre, or tone (e.g. cyberpunk vs. medieval take on the same mythos). Bigger swing than a Timeline.',
  dimension:
    'Accessible spatial layers within a Reality — pocket worlds, hidden layers, underworld / overworld / void. "Places you can travel to."',
  plane:
    'Mystical or abstract layers — dream, astral, divine, memory. More fantasy-coded than a Dimension; lives inside a Dimension or Reality.',
  realm: 'Named territories, regions, kingdoms, or cities. The right kind for geography.',
  domain:
    'Ownership / influence zones inside a Realm — faction territory, deity sphere, character-controlled sectors. Useful for governance mechanics.',
};
