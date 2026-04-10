/**
 * Private Section Router — Creator's Room for every universe
 *
 * Provides three sections within each universe's private area:
 *   - drafts:  Pre-publication workspace for entities/content
 *   - vault:   Hidden worldbuilding materials (lore, backstories)
 *   - notes:   Private plot notes and planning
 *
 * Access is tiered: admin > team > holders > none.
 * Each item has its own accessTier so vault items can be selectively
 * revealed to token holders while drafts stay team-only.
 *
 * Firestore collections:
 *   privateSectionConfig/{universeId}  — per-universe settings
 *   privateItems/{itemId}             — individual items
 */
import { protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import {
  resolveAccessLevel,
  meetsAccessTier,
  type AccessLevel,
  type PrivateSectionConfig,
} from './privateSection.access';

// ── Firestore collections ───────────────────────────────────────────

const configCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('privateSectionConfig');
};

const itemsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('privateItems');
};

// ── Zod schemas ─────────────────────────────────────────────────────

const sectionEnum = z.enum(['drafts', 'vault', 'notes']);
const accessTierEnum = z.enum(['team', 'holders', 'admin']);
const itemStatusEnum = z.enum(['draft', 'published', 'archived']);

const createItemSchema = z.object({
  universeId: z.string().min(1),
  section: sectionEnum,
  title: z.string().min(1).max(200),
  body: z.string().max(50000).default(''),
  mediaUrls: z.array(z.string().url()).max(20).default([]),
  kind: z.string().nullable().default(null),
  linkedEntityId: z.string().nullable().default(null),
  accessTier: accessTierEnum.default('team'),
});

const updateItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(50000).optional(),
  mediaUrls: z.array(z.string().url()).max(20).optional(),
  kind: z.string().nullable().optional(),
  linkedEntityId: z.string().nullable().optional(),
  accessTier: accessTierEnum.optional(),
  status: itemStatusEnum.optional(),
});

const listItemsSchema = z.object({
  universeId: z.string().min(1),
  section: sectionEnum.optional(),
  status: itemStatusEnum.optional(),
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// ── Router ──────────────────────────────────────────────────────────

export const privateSectionRouter = router({
  /**
   * Get private section config + caller's access level for a universe.
   */
  getConfig: protectedProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const id = input.universeId.toLowerCase();
      const accessLevel = await resolveAccessLevel(id, ctx.user.uid, ctx.user.address);

      if (accessLevel === 'none') {
        return { accessLevel: 'none' as const, config: null };
      }

      const doc = await configCol().doc(id).get();
      const config = doc.exists ? (doc.data() as PrivateSectionConfig) : null;

      return { accessLevel, config };
    }),

  /**
   * Update private section config (admin only).
   */
  updateConfig: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        vaultEnabled: z.boolean().optional(),
        notesEnabled: z.boolean().optional(),
        holderMinPercentage: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = input.universeId.toLowerCase();
      const accessLevel = await resolveAccessLevel(id, ctx.user.uid, ctx.user.address);

      if (accessLevel !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only universe admins can update config',
        });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.vaultEnabled !== undefined) updates.vaultEnabled = input.vaultEnabled;
      if (input.notesEnabled !== undefined) updates.notesEnabled = input.notesEnabled;
      if (input.holderMinPercentage !== undefined)
        updates.holderMinPercentage = input.holderMinPercentage;

      await configCol().doc(id).update(updates);
      return { ok: true };
    }),

  /**
   * Create a private item (drafts/vault/notes).
   * Requires at least team-level access.
   */
  createItem: protectedProcedure.input(createItemSchema).mutation(async ({ ctx, input }) => {
    const id = input.universeId.toLowerCase();
    const accessLevel = await resolveAccessLevel(id, ctx.user.uid, ctx.user.address);

    if (!meetsAccessTier(accessLevel, 'team')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Team membership required to create items',
      });
    }

    // Contributors can create in drafts and vault; moderators in notes only would be
    // an over-complication — all team members can create in any section.

    const itemId = randomUUID();
    const now = new Date();

    const itemData = {
      universeId: id,
      section: input.section,
      title: input.title,
      body: input.body,
      mediaUrls: input.mediaUrls,
      kind: input.kind,
      linkedEntityId: input.linkedEntityId,
      accessTier: input.accessTier,
      status: 'draft' as const,
      creatorUid: ctx.user.uid.toLowerCase(),
      createdAt: now,
      updatedAt: now,
    };

    await itemsCol().doc(itemId).set(itemData);
    return { ok: true, itemId, item: { id: itemId, ...itemData } };
  }),

  /**
   * Update an existing private item.
   * Creator of the item or universe admin can update.
   */
  updateItem: protectedProcedure.input(updateItemSchema).mutation(async ({ ctx, input }) => {
    const itemDoc = await itemsCol().doc(input.itemId).get();
    if (!itemDoc.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
    }

    const item = itemDoc.data()!;
    const accessLevel = await resolveAccessLevel(item.universeId, ctx.user.uid, ctx.user.address);

    const isCreator = item.creatorUid === ctx.user.uid.toLowerCase();
    if (!isCreator && accessLevel !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only item creator or admin can update' });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.body !== undefined) updates.body = input.body;
    if (input.mediaUrls !== undefined) updates.mediaUrls = input.mediaUrls;
    if (input.kind !== undefined) updates.kind = input.kind;
    if (input.linkedEntityId !== undefined) updates.linkedEntityId = input.linkedEntityId;
    if (input.accessTier !== undefined) updates.accessTier = input.accessTier;
    if (input.status !== undefined) updates.status = input.status;

    await itemsCol().doc(input.itemId).update(updates);
    return { ok: true };
  }),

  /**
   * Delete a private item. Creator or admin only.
   */
  deleteItem: protectedProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const itemDoc = await itemsCol().doc(input.itemId).get();
      if (!itemDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }

      const item = itemDoc.data()!;
      const accessLevel = await resolveAccessLevel(item.universeId, ctx.user.uid, ctx.user.address);

      const isCreator = item.creatorUid === ctx.user.uid.toLowerCase();
      if (!isCreator && accessLevel !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only item creator or admin can delete',
        });
      }

      await itemsCol().doc(input.itemId).delete();
      return { ok: true };
    }),

  /**
   * List private items for a universe, filtered by the caller's access tier.
   *
   * Access filtering:
   *   admin  → all items
   *   team   → items where accessTier in ['team', 'holders']
   *   holders → items where accessTier === 'holders'
   *   none   → empty array
   */
  listItems: protectedProcedure.input(listItemsSchema).query(async ({ ctx, input }) => {
    const id = input.universeId.toLowerCase();
    const accessLevel = await resolveAccessLevel(id, ctx.user.uid, ctx.user.address);

    if (accessLevel === 'none') {
      return { items: [], accessLevel };
    }

    let query = itemsCol()
      .where('universeId', '==', id)
      .orderBy('createdAt', 'desc')
      .limit(input.limit);

    if (input.section) {
      query = query.where('section', '==', input.section);
    }
    if (input.status) {
      query = query.where('status', '==', input.status);
    }
    if (input.cursor) {
      const cursorDoc = await itemsCol().doc(input.cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    let items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Filter by access tier
    if (accessLevel === 'holders') {
      items = items.filter((item: any) => item.accessTier === 'holders');
    } else if (accessLevel === 'team') {
      items = items.filter((item: any) => item.accessTier !== 'admin');
    }
    // admin sees everything

    return { items, accessLevel };
  }),

  /**
   * Get a single private item with access check.
   */
  getItem: protectedProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const itemDoc = await itemsCol().doc(input.itemId).get();
      if (!itemDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }

      const item = itemDoc.data()!;
      const accessLevel = await resolveAccessLevel(item.universeId, ctx.user.uid, ctx.user.address);

      if (!meetsAccessTier(accessLevel, item.accessTier)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient access for this item' });
      }

      return { item: { id: itemDoc.id, ...item }, accessLevel };
    }),

  /**
   * Publish a draft item — marks it as 'published'.
   * The frontend should then call the appropriate entity/content creation
   * endpoint to make it public. This just updates the status.
   * Admin or contributor only.
   */
  publishItem: protectedProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const itemDoc = await itemsCol().doc(input.itemId).get();
      if (!itemDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }

      const item = itemDoc.data()!;
      const accessLevel = await resolveAccessLevel(item.universeId, ctx.user.uid, ctx.user.address);

      if (!meetsAccessTier(accessLevel, 'team')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Team membership required to publish' });
      }

      if (item.status === 'published') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Item is already published' });
      }

      await itemsCol().doc(input.itemId).update({
        status: 'published',
        updatedAt: new Date(),
      });

      return { ok: true };
    }),
});
