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
  thing: 'Thing',
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

/** Get a single entity by ID. */
export function useEntity(universeAddress: string | undefined, entityId: string | undefined) {
  return useQuery({
    ...trpc.entities.get.queryOptions({
      universeAddress: universeAddress as `0x${string}`,
      entityId: entityId!,
    }),
    enabled: !!universeAddress && !!entityId,
  });
}

/** Get direct children of an entity. */
export function useChildEntities(
  universeAddress: string | undefined,
  parentId: string | undefined
) {
  return useQuery({
    ...trpc.entities.children.queryOptions({
      universeAddress: universeAddress as `0x${string}`,
      parentId: parentId!,
    }),
    enabled: !!universeAddress && !!parentId,
  });
}

/** Create a new entity. Invalidates entity queries on success. */
export function useCreateEntity(universeAddress: string | undefined) {
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
    }) =>
      trpcClient.entities.create.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Update an existing entity. */
export function useUpdateEntity(universeAddress: string | undefined) {
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
    }) =>
      trpcClient.entities.update.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Delete an entity. */
export function useDeleteEntity(universeAddress: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entityId: string) =>
      trpcClient.entities.delete.mutate({
        universeAddress: universeAddress as `0x${string}`,
        entityId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Associate an on-chain node with an entity. */
export function useAddNodeToEntity(universeAddress: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { entityId: string; nodeId: number }) =>
      trpcClient.entities.addNode.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
    },
  });
}

/** Remove an on-chain node from an entity. */
export function useRemoveNodeFromEntity(universeAddress: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { entityId: string; nodeId: number }) =>
      trpcClient.entities.removeNode.mutate({
        ...input,
        universeAddress: universeAddress as `0x${string}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['entities']] });
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
