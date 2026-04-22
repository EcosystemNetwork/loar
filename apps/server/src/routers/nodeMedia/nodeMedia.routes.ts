/**
 * Node Media Overrides Router
 *
 * Off-chain overrides for on-chain timeline node video links. The Universe
 * contract's `setMedia` is `onlyAdmin`-gated on older deployed versions, so
 * when a media URL rots (e.g. a signed CDN link expires, a host disappears)
 * and the admin is the Governor contract, an on-chain fix requires a
 * governance proposal. This router lets a universe admin patch the rendered
 * video link off-chain without touching the immutable on-chain content hash
 * or event history.
 *
 * Read order in the frontend:
 *   1. override (if present)  ← this router
 *   2. Ponder nodeContent.videoLink (event-derived, immutable)
 *   3. on-chain contentHash (fallback, rarely renderable)
 *
 * Collection: `nodeMediaOverrides`
 *   doc id:   `{universeAddress_lower}:{nodeId}`
 *   fields:
 *     universeAddress: string (lowercase)
 *     nodeId:          number
 *     videoLink:       string? (final rendered URL — IPFS gateway or signed URL)
 *     hidden:          boolean? (true hides the node from the rendered timeline —
 *                       used when original content can't be recovered)
 *     reason:          string? (why this override was set)
 *     updatedAt:       Date
 *     updatedBy:       string (admin wallet lowercase)
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { TRPCError } from '@trpc/server';

const col = () => {
  if (!db) throw new Error('Firebase not configured');
  return db.collection('nodeMediaOverrides');
};

const docId = (universeAddress: string, nodeId: number) =>
  `${universeAddress.toLowerCase()}:${nodeId}`;

export const nodeMediaRouter = router({
  /** List all media overrides for a universe (public — same visibility as the videos themselves). */
  list: publicProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input }) => {
      const universeAddress = input.universeId.toLowerCase();
      const snap = await col().where('universeAddress', '==', universeAddress).get();
      const overrides: Record<
        number,
        { videoLink?: string; hidden?: boolean; reason?: string; updatedAt: number }
      > = {};
      for (const doc of snap.docs) {
        const d = doc.data();
        overrides[d.nodeId as number] = {
          videoLink: (d.videoLink as string | undefined) || undefined,
          hidden: d.hidden === true ? true : undefined,
          reason: d.reason as string | undefined,
          updatedAt:
            d.updatedAt instanceof Date
              ? d.updatedAt.getTime()
              : Number(d.updatedAt?._seconds ?? 0) * 1000,
        };
      }
      return { overrides };
    }),

  /** Set a media override — universe admin only. Either `videoLink` or `hidden` must be provided. */
  setOverride: protectedProcedure
    .input(
      z
        .object({
          universeId: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected on-chain universe address'),
          nodeId: z.number().int().positive(),
          videoLink: z.string().url().optional(),
          hidden: z.boolean().optional(),
          reason: z.string().max(500).optional(),
        })
        .refine((d) => d.videoLink != null || d.hidden != null, {
          message: 'Provide videoLink or hidden',
        })
    )
    .mutation(async ({ ctx, input }) => {
      const caller = ctx.user.address ?? ctx.user.uid;
      if (!caller) throw new TRPCError({ code: 'UNAUTHORIZED' });

      if (!(await isUniverseAdmin(input.universeId, caller))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can set a media override',
        });
      }

      const id = docId(input.universeId, input.nodeId);
      const record: Record<string, unknown> = {
        universeAddress: input.universeId.toLowerCase(),
        nodeId: input.nodeId,
        reason: input.reason ?? '',
        updatedAt: new Date(),
        updatedBy: caller.toLowerCase(),
      };
      if (input.videoLink !== undefined) record.videoLink = input.videoLink;
      if (input.hidden !== undefined) record.hidden = input.hidden;
      await col().doc(id).set(record, { merge: true });
      return { ok: true, id };
    }),

  /** Clear a media override — universe admin only. */
  clearOverride: protectedProcedure
    .input(
      z.object({
        universeId: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        nodeId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caller = ctx.user.address ?? ctx.user.uid;
      if (!caller) throw new TRPCError({ code: 'UNAUTHORIZED' });
      if (!(await isUniverseAdmin(input.universeId, caller))) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await col().doc(docId(input.universeId, input.nodeId)).delete();
      return { ok: true };
    }),
});
