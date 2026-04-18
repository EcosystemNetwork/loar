/**
 * Media attachments router — links uploaded files to worldbuilding entities
 * and universes in the hierarchy.
 *
 * Any uploaded file (via /api/upload or storage.*) can be attached to:
 *   - universe  — a deployed Universe contract address
 *   - entity    — any worldbuilding entity (person, place, thing, etc.)
 *
 * Attachments support:
 *   - Categories: image, video, music, sound, environment, 3d, texture,
 *     animation, rig, document, design, other
 *   - Sub-categories: finer classification (e.g. diffuse/normal for textures)
 *   - Versioning: track iterations of the same asset
 *   - Variants: group alternate styles (anime vs realistic, battle armor vs casual)
 *   - Sort ordering: manual asset arrangement within categories
 *
 * Attachments are stored in the `mediaAttachments` Firestore collection.
 */
import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../../lib/trpc';
import { MEDIA_CATEGORIES, ATTACHMENT_TARGET_TYPES } from './media.types';
import {
  createAttachment,
  getAttachmentsByTarget,
  getAttachmentsByCreator,
  getVariants,
  updateAttachment,
  reorderAttachments,
  deleteAttachment,
} from './media.handlers';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { db } from '../../lib/firebase';

const mediaCategoryEnum = z.enum(MEDIA_CATEGORIES);
const targetTypeEnum = z.enum(ATTACHMENT_TARGET_TYPES);

export const mediaRouter = router({
  /** Attach an uploaded file (by contentHash) to a universe or entity. */
  attach: protectedProcedure
    .input(
      z.object({
        contentHash: z.string().min(1),
        originalFilename: z.string(),
        mimeType: z.string(),
        size: z.number().nonnegative(),
        url: z.string().url(),
        targetType: targetTypeEnum,
        targetId: z.string().min(1),
        targetName: z.string(),
        category: mediaCategoryEnum,
        label: z.string(),
        subCategory: z.string().nullish(),
        version: z.number().int().positive().optional(),
        variantOf: z.string().nullish(),
        variantLabel: z.string().nullish(),
        sortOrder: z.number().int().optional(),
        generationId: z.string().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address is required to attach media');
      }
      return createAttachment(ctx.user.address, input);
    }),

  /** Remove a media attachment. Creator or universe manager can detach. */
  detach: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address is required to detach media');
      }

      // Look up attachment to check universe admin status
      const attachDoc = await db.collection('mediaAttachments').doc(input.id).get();
      if (!attachDoc.exists) throw new Error('Attachment not found');
      const data = attachDoc.data()!;

      let adminStatus = false;
      const caller = ctx.user.address.toLowerCase();
      const isCreator = data.creator === caller;

      if (!isCreator) {
        // Resolve the universe address for this attachment
        let universeId: string | undefined;
        if (data.targetType === 'universe') {
          universeId = data.targetId;
        } else if (data.targetType === 'entity') {
          const entityDoc = await db.collection('entities').doc(data.targetId).get();
          universeId = entityDoc.data()?.universeAddress ?? undefined;
        }

        if (universeId) {
          adminStatus = await isUniverseAdmin(universeId, caller);
        }
      }

      await deleteAttachment(caller, input.id, { isUniverseAdmin: adminStatus });
      return { ok: true };
    }),

  /** List all media attached to a specific universe or entity. */
  listByTarget: publicProcedure
    .input(
      z.object({
        targetType: targetTypeEnum,
        targetId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      return getAttachmentsByTarget(input.targetType, input.targetId);
    }),

  /** List all media attached by a creator address. */
  listByCreator: publicProcedure
    .input(z.object({ creator: z.string().min(1) }))
    .query(async ({ input }) => {
      return getAttachmentsByCreator(input.creator);
    }),

  /** Get all variants of a specific attachment. */
  variants: publicProcedure
    .input(z.object({ attachmentId: z.string().min(1) }))
    .query(async ({ input }) => {
      return getVariants(input.attachmentId);
    }),

  /** Update an attachment's label, category, variant info, or re-attach to a different target. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        category: mediaCategoryEnum.optional(),
        label: z.string().optional(),
        subCategory: z.string().nullish(),
        version: z.number().int().positive().optional(),
        variantOf: z.string().nullish(),
        variantLabel: z.string().nullish(),
        sortOrder: z.number().int().optional(),
        targetType: targetTypeEnum.optional(),
        targetId: z.string().optional(),
        targetName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address is required to update media');
      }
      return updateAttachment(ctx.user.address, input);
    }),

  /** Batch-update sort order for multiple attachments at once. */
  reorder: protectedProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            id: z.string().min(1),
            sortOrder: z.number().int(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address is required to reorder media');
      }
      await reorderAttachments(ctx.user.address, input.items);
      return { ok: true };
    }),
});
