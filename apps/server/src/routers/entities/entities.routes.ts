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
import {
  ENTITY_KINDS,
  CREATOR_KINDS,
  ENTITY_RELATION_TYPES,
  REFERENCE_SLOTS,
  IDENTITY_LOCKS,
  MAX_REFS_PER_SLOT,
} from './entities.types';
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
  swapNodesBetweenEntities,
  assertMintEligible,
  searchEntities,
  createRelation,
  deleteRelation,
  getEntityRelations,
  getUniverseRelations,
} from './entities.handlers';
import {
  setReferenceBundle,
  clearReferenceBundle,
  resolveReferenceBundle,
} from './entities.reference-bundle';
import {
  getVisualDescriptor,
  pinReferenceAsset,
  revertVisualDescriptor,
  getDescriptorHistory,
} from './entities.visual-descriptor';
import { geminiService } from '../../services/gemini';
import { triggerCoverImageGenerationAsync } from '../../services/entity-cover-image';
import { db } from '../../lib/firebase';

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
        // Values are intentionally `unknown` — visual-language kinds
        // (moodboard, style_pack) store arrays (referenceImages, tags,
        // styleKeywords) and numbers (defaultStrength). The Entity
        // interface already types metadata as Record<string, unknown>.
        metadata: z.record(z.string(), z.any()).optional(),
        monetized: z.boolean().default(false),
        rightsDeclaration: z.enum(['original', 'licensed']).nullish(),
        unstoppableDomain: z.string().max(100).nullish(),
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
          unstoppableDomain: input.unstoppableDomain ?? null,
        },
        ctx.user.address
      );

      // Auto-generate cover image if none was provided (fire-and-forget)
      if (!input.imageUrl && result.id) {
        triggerCoverImageGenerationAsync({
          id: result.id,
          name: input.name,
          description: input.description,
          kind: input.kind,
          metadata: (input.metadata || {}) as Record<string, unknown>,
        });
      }

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
        limit: z.number().int().positive().max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      const entities = await getEntitiesByCreator(input.creator, input.kind, input.limit);
      return { entities, total: entities.length };
    }),

  /** Get direct children of an entity. universeAddress no longer required. */
  children: publicProcedure
    .input(
      z.object({
        parentId: z.string().min(1),
        /** @deprecated No longer needed — kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
        limit: z.number().int().positive().max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      const children = await getChildEntities(input.parentId, input.limit);
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
        // Values are intentionally `unknown` — visual-language kinds
        // (moodboard, style_pack) store arrays (referenceImages, tags,
        // styleKeywords) and numbers (defaultStrength). The Entity
        // interface already types metadata as Record<string, unknown>.
        metadata: z.record(z.string(), z.any()).optional(),
        monetized: z.boolean().optional(),
        rightsDeclaration: z.enum(['original', 'licensed']).nullish(),
        unstoppableDomain: z.string().max(100).nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can update it');
      }
      const { entityId, universeAddress: _unused, ...updates } = input;
      const entity = await updateEntity(entityId, updates);
      return { success: true, data: entity };
    }),

  /** Delete an entity. Only the creator can delete. Fails if it has children. */
  delete: protectedProcedure
    .use(requirePermission('entities.update'))
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

  /** Associate an on-chain node ID with this entity. Only the creator can do this. */
  addNode: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(
      z.object({
        entityId: z.string().min(1),
        nodeId: z.number().int().nonnegative(),
        /** @deprecated Kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can modify node associations');
      }
      const entity = await addNodeToEntity(input.entityId, input.nodeId);
      return { success: true, data: entity };
    }),

  /** Remove an on-chain node ID from this entity. Only the creator can do this. */
  removeNode: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(
      z.object({
        entityId: z.string().min(1),
        nodeId: z.number().int().nonnegative(),
        /** @deprecated Kept for backwards compatibility. */
        universeAddress: ethereumAddress.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can modify node associations');
      }
      const entity = await removeNodeFromEntity(input.entityId, input.nodeId);
      return { success: true, data: entity };
    }),
  /** Swap node IDs between two entities. Only the creator (must own both) can do this. */
  swapNodes: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(
      z.object({
        entityIdA: z.string().min(1),
        nodeIdA: z.number().int().nonnegative(),
        entityIdB: z.string().min(1),
        nodeIdB: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [entityA, entityB] = await Promise.all([
        getEntity(input.entityIdA),
        getEntity(input.entityIdB),
      ]);
      if (!entityA) throw new Error('Entity A not found');
      if (!entityB) throw new Error('Entity B not found');
      const addr = ctx.user.address?.toLowerCase();
      if (entityA.creator?.toLowerCase() !== addr) {
        throw new Error('Forbidden: you must own entity A to swap nodes');
      }
      if (entityB.creator?.toLowerCase() !== addr) {
        throw new Error('Forbidden: you must own entity B to swap nodes');
      }
      const result = await swapNodesBetweenEntities(
        input.entityIdA,
        input.nodeIdA,
        input.entityIdB,
        input.nodeIdB
      );
      return { success: true, data: result };
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

  /** Search entities by name or description. */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        universeAddress: ethereumAddress.optional(),
        kind: entityKindSchema.optional(),
        limit: z.number().int().positive().max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const entities = await searchEntities(input);
      return { entities, total: entities.length };
    }),

  /**
   * List entities the current user has bookmarked (via social.like with targetType='entity').
   * Hydrates the entity records server-side so the wiki can render them in one round-trip.
   */
  myBookmarks: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).default(50),
        })
        .default({ limit: 50 })
    )
    .query(async ({ ctx, input }) => {
      if (!db) return { entities: [], total: 0 };
      const likesSnap = await db
        .collection('likes')
        .where('uid', '==', ctx.user.uid)
        .where('targetType', '==', 'entity')
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      const ids = likesSnap.docs.map((d) => d.data().targetId as string);
      if (ids.length === 0) return { entities: [], total: 0 };
      const entities = (await Promise.all(ids.map((id) => getEntity(id).catch(() => null)))).filter(
        (e): e is NonNullable<typeof e> => !!e
      );
      return { entities, total: entities.length };
    }),

  // ── Relationships ──────────────────────────────────────────────────

  /** Get all relationships for a specific entity. */
  relations: publicProcedure
    .input(z.object({ entityId: z.string().min(1) }))
    .query(async ({ input }) => {
      const relations = await getEntityRelations(input.entityId);
      return { relations };
    }),

  /** Get all relationships within a universe. */
  universeRelations: publicProcedure
    .input(z.object({ universeAddress: ethereumAddress }))
    .query(async ({ input }) => {
      const relations = await getUniverseRelations(input.universeAddress);
      return { relations };
    }),

  /** Create a relationship between two entities. */
  createRelation: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(
      z.object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
        type: z.enum(ENTITY_RELATION_TYPES as unknown as [string, ...string[]]),
        description: z.string().max(500).default(''),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Must own the source entity
      const source = await getEntity(input.sourceId);
      if (!source) throw new Error('Source entity not found');
      if (source.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: you must own the source entity to create relationships');
      }
      const relation = await createRelation(
        input.sourceId,
        input.targetId,
        input.type as any,
        input.description,
        ctx.user.address!
      );
      return { success: true, data: relation };
    }),

  /** Delete a relationship. Only the relationship creator or entity owner can delete. */
  deleteRelation: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(z.object({ relationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address required to delete relationships');
      }
      await deleteRelation(input.relationId, ctx.user.address);
      return { success: true };
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
    .mutation(async ({ input, ctx }) => {
      // Rate-limit: max 20 profile generations per user per hour
      if (db) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentCount = await db
          .collection('profileGenerations')
          .where('userId', '==', ctx.user.uid)
          .where('createdAt', '>=', oneHourAgo)
          .count()
          .get();
        if (recentCount.data().count >= 20) {
          throw new Error(
            'Rate limit exceeded: max 20 AI profile generations per hour. Please wait before trying again.'
          );
        }
        // Track this generation
        await db.collection('profileGenerations').add({
          userId: ctx.user.uid,
          name: input.name,
          kind: input.kind,
          createdAt: new Date(),
        });
      }

      const profile = await geminiService.generateEntityProfile(input.name, input.kind, input.hint);
      return profile;
    }),

  // ── Reference Bundles (Character Identity Lock + Multi-Reference Editing) ──

  /**
   * Get an entity's reference bundle, optionally merging ancestor bundles.
   * Returns null if neither the entity nor any ancestor has a bundle set.
   */
  getReferenceBundle: publicProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        /** Walk the parentId chain and merge inherited slots/locks. Defaults true. */
        includeInherited: z.boolean().default(true),
      })
    )
    .query(async ({ input }) => {
      const resolved = await resolveReferenceBundle(input.entityId, {
        includeInherited: input.includeInherited,
      });
      return { bundle: resolved };
    }),

  /** Set (replace) the reference bundle on an entity. Owner-only. */
  setReferenceBundle: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(
      z.object({
        entityId: z.string().min(1),
        slots: z
          .record(z.enum(REFERENCE_SLOTS), z.array(z.string().url()).max(MAX_REFS_PER_SLOT))
          .optional(),
        locks: z.record(z.enum(IDENTITY_LOCKS), z.boolean()).optional(),
        identityStrength: z.number().min(0).max(1).default(0.7),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can edit its reference bundle');
      }
      const bundle = await setReferenceBundle(input.entityId, {
        slots: input.slots ?? {},
        locks: input.locks ?? {},
        identityStrength: input.identityStrength,
      });
      return { success: true, bundle };
    }),

  /** Clear the reference bundle on an entity. Owner-only. */
  clearReferenceBundle: protectedProcedure
    .use(requirePermission('entities.update'))
    .input(z.object({ entityId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const existing = await getEntity(input.entityId);
      if (!existing) throw new Error('Entity not found');
      if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new Error('Forbidden: only the entity creator can edit its reference bundle');
      }
      await clearReferenceBundle(input.entityId);
      return { success: true };
    }),

  // ── Visual Descriptor (VLM canonical visual memory) ────────────────
  // See docs/prd-vlm-subsystem.md §12.1. Writes are driven by the VLM
  // pipeline (`vlm.proposals.accept`, `vlm.copilot.refreshVisualDescriptor`);
  // routes here cover reads + creator-managed actions (pin / revert).

  visualDescriptor: router({
    /** Read the current descriptor for an entity. Public. */
    get: publicProcedure
      .input(z.object({ entityId: z.string().min(1) }))
      .query(async ({ input }) => {
        const descriptor = await getVisualDescriptor(input.entityId);
        return { descriptor };
      }),

    /** List archived descriptor versions, newest first. Public. */
    history: publicProcedure
      .input(
        z.object({
          entityId: z.string().min(1),
          limit: z.number().int().positive().max(100).default(20),
        })
      )
      .query(async ({ input }) => {
        const history = await getDescriptorHistory(input.entityId, input.limit);
        return { history };
      }),

    /** Pin or unpin a reference asset so VLM auto-refresh cannot displace it. */
    pinAsset: protectedProcedure
      .use(requirePermission('entities.update'))
      .input(
        z.object({
          entityId: z.string().min(1),
          cid: z.string().min(1),
          pinned: z.boolean().default(true),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getEntity(input.entityId);
        if (!existing) throw new Error('Entity not found');
        if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
          throw new Error('Forbidden: only the entity creator can pin reference assets');
        }
        const descriptor = await pinReferenceAsset(input.entityId, input.cid, input.pinned);
        return { success: true, descriptor };
      }),

    /** Revert to a prior descriptor version. Creator-only. */
    revert: protectedProcedure
      .use(requirePermission('entities.update'))
      .input(
        z.object({
          entityId: z.string().min(1),
          version: z.number().int().positive(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getEntity(input.entityId);
        if (!existing) throw new Error('Entity not found');
        if (existing.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()) {
          throw new Error('Forbidden: only the entity creator can revert descriptor versions');
        }
        const descriptor = await revertVisualDescriptor(input.entityId, input.version);
        return { success: true, descriptor };
      }),
  }),
});

export type EntitiesRouter = typeof entitiesRouter;
