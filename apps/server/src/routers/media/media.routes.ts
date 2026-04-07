/**
 * Media attachments router — links uploaded files to worldbuilding entities
 * and universes in the hierarchy.
 *
 * Any uploaded file (via /api/upload or storage.*) can be attached to:
 *   - universe  — a deployed Universe contract address
 *   - entity    — any worldbuilding entity (person, place, thing, etc.)
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
  updateAttachment,
  deleteAttachment,
} from './media.handlers';

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address is required to attach media');
      }
      return createAttachment(ctx.user.address, input);
    }),

  /** Remove a media attachment. Only the creator can detach. */
  detach: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Wallet address is required to detach media');
      }
      await deleteAttachment(ctx.user.address, input.id);
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

  /** Update an attachment's label, category, or re-attach to a different target. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        category: mediaCategoryEnum.optional(),
        label: z.string().optional(),
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
});
