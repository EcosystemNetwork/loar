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
];

/** Top-level structural kinds shown as first-class in the universe editor. */
export const PRIMARY_KINDS: EntityKind[] = ['timeline', 'realm'];

/** Secondary/advanced structural kinds. */
export const SECONDARY_KINDS: EntityKind[] = ['reality', 'dimension', 'plane', 'domain'];

/** Display labels for each entity kind. */
export const ENTITY_LABELS: Record<EntityKind, string> = {
  person: 'Person',
  place: 'Place',
  thing: 'Thing / Artifact',
  faction: 'Faction',
  event: 'Event',
  lore: 'Lore',
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

/** Action labels for creating each entity kind. */
export const ENTITY_ACTIONS: Record<EntityKind, string> = {
  person: 'Create Person',
  place: 'Create Place',
  thing: 'Create Thing',
  faction: 'Create Faction',
  event: 'Create Event',
  lore: 'Add Lore',
  species: 'Create Species',
  vehicle: 'Create Vehicle',
  technology: 'Create Technology',
  organization: 'Create Organization',
  timeline: 'Add Timeline',
  reality: 'Create Alternate Reality',
  dimension: 'Open New Dimension',
  plane: 'Manifest Plane',
  realm: 'Add Realm',
  domain: 'Assign Domain Control',
};

export type RightsDeclaration = 'original' | 'licensed';

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

/** Get a single entity by ID. universeAddress is optional (deprecated). */
export function useEntity(entityId: string | undefined, universeAddress?: string) {
  return useQuery({
    ...trpc.entities.get.queryOptions({
      entityId: entityId!,
      universeAddress: universeAddress as `0x${string}` | undefined,
    }),
    enabled: !!entityId,
  });
}

/** Get direct children of an entity. universeAddress is optional (deprecated). */
export function useChildEntities(parentId: string | undefined, universeAddress?: string) {
  return useQuery({
    ...trpc.entities.children.queryOptions({
      parentId: parentId!,
      universeAddress: universeAddress as `0x${string}` | undefined,
    }),
    enabled: !!parentId,
  });
}

/** Create a new entity. Invalidates entity queries on success. */
export function useCreateEntity(universeAddress?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      name: string;
      description: string;
      kind: EntityKind;
      parentId?: string | null;
      nodeIds?: number[];
      imageUrl?: string | null;
      metadata?: Record<string, string | number | boolean | null>;
      monetized?: boolean;
      rightsDeclaration?: RightsDeclaration | null;
    }) =>
      trpcClient.entities.create.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}` | undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Update an existing entity. */
export function useUpdateEntity(universeAddress?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      entityId: string;
      name?: string;
      description?: string;
      parentId?: string | null;
      nodeIds?: number[];
      imageUrl?: string | null;
      metadata?: Record<string, string | number | boolean | null>;
      monetized?: boolean;
      rightsDeclaration?: RightsDeclaration | null;
    }) =>
      trpcClient.entities.update.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}` | undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Delete an entity. */
export function useDeleteEntity(universeAddress?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entityId: string) =>
      trpcClient.entities.delete.mutate({
        universeAddress: universeAddress as `0x${string}` | undefined,
        entityId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Associate an on-chain node with an entity. */
export function useAddNodeToEntity(universeAddress?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { entityId: string; nodeId: number }) =>
      trpcClient.entities.addNode.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}` | undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Remove an on-chain node from an entity. */
export function useRemoveNodeFromEntity(universeAddress?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { entityId: string; nodeId: number }) =>
      trpcClient.entities.removeNode.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}` | undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Swap node IDs between two entities (off-chain counterpart to Universe.swapNodes). */
export function useSwapNodesBetweenEntities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      entityIdA: string;
      nodeIdA: number;
      entityIdB: string;
      nodeIdB: number;
    }) => trpcClient.entities.swapNodes.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Search entities by name/description across all kinds. */
export function useEntitySearch(query: string, universeAddress?: string) {
  return useQuery({
    queryKey: ['entity-search', query, universeAddress],
    queryFn: () =>
      trpcClient.entities.search.query({
        query,
        universeAddress: universeAddress as `0x${string}` | undefined,
        limit: 30,
      }),
    enabled: query.length >= 2,
  });
}

/** Get all relationships for a specific entity. */
export function useEntityRelations(entityId: string | undefined) {
  return useQuery({
    queryKey: ['entity-relations', entityId],
    queryFn: () => trpcClient.entities.relations.query({ entityId: entityId! }),
    enabled: !!entityId,
  });
}

/** Create a relationship between two entities. */
export function useCreateRelation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      sourceId: string;
      targetId: string;
      type: string;
      description?: string;
    }) => trpcClient.entities.createRelation.mutate(input as any),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['entity-relations', variables.sourceId] });
      queryClient.invalidateQueries({ queryKey: ['entity-relations', variables.targetId] });
    },
  });
}

/** Delete a relationship. */
export function useDeleteRelation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (relationId: string) => trpcClient.entities.deleteRelation.mutate({ relationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-relations'] });
    },
  });
}

/**
 * Build a tree structure from a flat list of entities.
 * Returns root entities (parentId === null) with nested children.
 */
export function buildEntityTree(entities: Entity[]): (Entity & { children: Entity[] })[] {
  const map = new Map<string, Entity & { children: Entity[] }>();
  const roots: (Entity & { children: Entity[] })[] = [];

  // First pass: wrap each entity with a children array
  for (const entity of entities) {
    map.set(entity.id, { ...entity, children: [] });
  }

  // Second pass: link parents to children
  for (const entity of entities) {
    const node = map.get(entity.id)!;
    if (entity.parentId && map.has(entity.parentId)) {
      map.get(entity.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
