/**
 * Entities tRPC router — CRUD for narrative hierarchy entities.
 *
 * All mutations require authentication (protectedProcedure).
 * Reads are public so the narrative structure is browsable.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { ENTITY_KINDS } from './entities.types';
import {
  createEntity,
  getEntity,
  getEntitiesByUniverse,
  getChildEntities,
  updateEntity,
  deleteEntity,
  addNodeToEntity,
  removeNodeFromEntity,
} from './entities.handlers';

const entityKindSchema = z.enum(ENTITY_KINDS);

const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const entitiesRouter = router({
  /** Create a new entity within a universe. */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).default(''),
        kind: entityKindSchema,
        universeAddress: ethereumAddress,
        parentId: z.string().nullish(),
        nodeIds: z.array(z.number().int().nonnegative()).optional(),
        imageUrl: z.string().url().nullish(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await createEntity(
        {
          name: input.name,
          description: input.description,
          kind: input.kind,
          universeAddress: input.universeAddress,
          parentId: input.parentId ?? null,
          nodeIds: input.nodeIds,
          imageUrl: input.imageUrl ?? null,
          metadata: input.metadata,
        },
        ctx.user.address
      );
      return { success: true, ...result };
    }),

  /** Get a single entity by ID. */
  get: publicProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        entityId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const entity = await getEntity(input.universeAddress, input.entityId);
      if (!entity) throw new Error('Entity not found');
      return entity;
    }),

  /** List all entities for a universe, optionally filtered by kind. */
  list: publicProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        kind: entityKindSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const entities = await getEntitiesByUniverse(input.universeAddress, input.kind);
      return { entities, total: entities.length };
    }),

  /** Get direct children of an entity. */
  children: publicProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        parentId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const children = await getChildEntities(input.universeAddress, input.parentId);
      return { children, total: children.length };
    }),

  /** Update an existing entity. */
  update: protectedProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        entityId: z.string().min(1),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        parentId: z.string().nullish(),
        nodeIds: z.array(z.number().int().nonnegative()).optional(),
        imageUrl: z.string().url().nullish(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { universeAddress, entityId, ...updates } = input;
      const entity = await updateEntity(universeAddress, entityId, {
        ...updates,
        parentId: updates.parentId ?? undefined,
        imageUrl: updates.imageUrl ?? undefined,
      });
      return { success: true, data: entity };
    }),

  /** Delete an entity. Fails if it has children. */
  delete: protectedProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        entityId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await deleteEntity(input.universeAddress, input.entityId);
      return { success: true };
    }),

  /** Associate an on-chain node ID with this entity. */
  addNode: protectedProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        entityId: z.string().min(1),
        nodeId: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ input }) => {
      const entity = await addNodeToEntity(input.universeAddress, input.entityId, input.nodeId);
      return { success: true, data: entity };
    }),

  /** Remove an on-chain node ID from this entity. */
  removeNode: protectedProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        entityId: z.string().min(1),
        nodeId: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ input }) => {
      const entity = await removeNodeFromEntity(
        input.universeAddress,
        input.entityId,
        input.nodeId
      );
      return { success: true, data: entity };
    }),
});

export type EntitiesRouter = typeof entitiesRouter;
