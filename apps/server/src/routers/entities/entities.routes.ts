/**
 * Entities tRPC router — CRUD for worldbuilding entities.
 *
 * Creator kinds (person, place, thing, faction, event, lore, species, vehicle,
 * technology, organization) can exist without a universe — universeAddress is
 * optional for those. Structural kinds (timeline, realm, etc.) retain the old
 * behaviour.
 *
 * All mutations require authentication. Reads are public.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router, requirePermission } from '../../lib/trpc';
import { ENTITY_KINDS, CREATOR_KINDS } from './entities.types';
import {
  createEntity,
  getEntity,
  getEntitiesByUniverse,
  getEntitiesByKind,
  getEntitiesByCreator,
  getChildEntities,
  updateEntity,
  deleteEntity,
  addNodeToEntity,
  removeNodeFromEntity,
  assertMintEligible,
} from './entities.handlers';
import { geminiService } from '../../services/gemini';

const entityKindSchema = z.enum(ENTITY_KINDS);

const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const entitiesRouter = router({
  /** Create a new entity. universeAddress is optional for creator kinds. */
  create: protectedProcedure
    .use(requirePermission('entities.create'))
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(5000).default(''),
        kind: entityKindSchema,
        universeAddress: ethereumAddress.nullish(),
        parentId: z.string().nullish(),
        nodeIds: z.array(z.number().int().nonnegative()).optional(),
        imageUrl: z.string().url().nullish(),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        monetized: z.boolean().default(false),
        rightsDeclaration: z.enum(['original', 'licensed']).nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address required to create entities');
      }
      const result = await createEntity(
        {
          name: input.name,
          description: input.description,
          kind: input.kind,
          universeAddress: input.universeAddress ?? null,
          parentId: input.parentId ?? null,
          nodeIds: input.nodeIds,
          imageUrl: input.imageUrl ?? null,
          metadata: input.metadata,
          monetized: input.monetized,
          rightsDeclaration: input.rightsDeclaration ?? null,
        },
        ctx.user.address
      );
      return { success: true, ...result };
    }),

  /** Get a single entity by ID. universeAddress is no longer required. */
  get: publicProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        /** @deprecated No longer needed — kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .query(async ({ input }) => {
      const entity = await getEntity(input.entityId);
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

  /**
   * List entities globally by kind — used by the wiki to show all people,
   * places, etc. across all universes.
   */
  listByKind: publicProcedure
    .input(
      z.object({
        kind: entityKindSchema,
        limit: z.number().int().positive().max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      const entities = await getEntitiesByKind(input.kind, input.limit);
      return { entities, total: entities.length };
    }),

  /** List entities created by a specific address. */
  listByCreator: publicProcedure
    .input(
      z.object({
        creator: z.string().min(1),
        kind: entityKindSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const entities = await getEntitiesByCreator(input.creator, input.kind);
      return { entities, total: entities.length };
    }),

  /** Get direct children of an entity. universeAddress no longer required. */
  children: publicProcedure
    .input(
      z.object({
        parentId: z.string().min(1),
        /** @deprecated No longer needed — kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .query(async ({ input }) => {
      const children = await getChildEntities(input.parentId);
      return { children, total: children.length };
    }),

  /** Update an existing entity. Only the creator can update. */
  update: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(
      z.object({
        entityId: z.string().min(1),
        /** @deprecated Kept for backwards compatibility — no longer used for routing. */
        universeAddress: ethereumAddress.optional(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        parentId: z.string().nullish(),
        nodeIds: z.array(z.number().int().nonnegative()).optional(),
        imageUrl: z.string().url().nullish(),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        monetized: z.boolean().optional(),
        rightsDeclaration: z.enum(['original', 'licensed']).nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can update it');
      }
      const { entityId, universeAddress: _unused, ...updates } = input;
      const entity = await updateEntity(entityId, {
        ...updates,
        parentId: updates.parentId ?? undefined,
        imageUrl: updates.imageUrl ?? undefined,
      });
      return { success: true, data: entity };
    }),

  /** Delete an entity. Only the creator can delete. Fails if it has children. */
  delete: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        /** @deprecated Kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can delete it');
      }
      await deleteEntity(input.entityId);
      return { success: true };
    }),

  /** Associate an on-chain node ID with this entity. */
  addNode: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        nodeId: z.number().int().nonnegative(),
        /** @deprecated Kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const entity = await addNodeToEntity(input.entityId, input.nodeId);
      return { success: true, data: entity };
    }),

  /** Remove an on-chain node ID from this entity. */
  removeNode: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        nodeId: z.number().int().nonnegative(),
        /** @deprecated Kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const entity = await removeNodeFromEntity(input.entityId, input.nodeId);
      return { success: true, data: entity };
    }),
  /** Check if an entity is eligible for NFT minting (monetized + rights declared). */
  mintEligibility: publicProcedure
    .input(z.object({ entityId: z.string().min(1) }))
    .query(async ({ input }) => {
      const entity = await getEntity(input.entityId);
      if (!entity) throw new Error('Entity not found');
      return {
        eligible: entity.monetized && !!entity.rightsDeclaration,
        monetized: entity.monetized,
        rightsDeclaration: entity.rightsDeclaration,
        reason: !entity.monetized
          ? 'Entity is not marked as monetized'
          : !entity.rightsDeclaration
            ? 'No rights declaration on file'
            : null,
      };
    }),

  /** Generate an AI profile (description + metadata) for a new or existing entity. */
  generateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        kind: entityKindSchema,
        hint: z.string().max(1000).default(''),
      })
    )
    .mutation(async ({ input }) => {
      const profile = await geminiService.generateEntityProfile(input.name, input.kind, input.hint);
      return profile;
    }),
});

export type EntitiesRouter = typeof entitiesRouter;
