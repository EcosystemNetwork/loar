/**
 * Universe Events Router
 *
 * Persists the universe timeline editor's scene/event data — title,
 * description, resolved media URLs, character selections, generation
 * prompts/settings, soundtrack, version history — so it survives a cleared
 * browser cache, a different device, or a teammate opening the same
 * universe. Previously this data lived only in `localStorage` (see
 * `useUniverseEvents` on the client), which meant it was never actually
 * durable.
 *
 * One doc per universe, keyed by event id within it — same per-field
 * dot-path merge approach as `graphLayouts` so two collaborators editing
 * different scenes at the same time don't clobber each other. Reads are
 * public (same visibility model as the graph/timeline itself); writes
 * require universe edit access.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { isUniverseCollaborator } from '../../lib/safe-admin';

const eventsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('universeEvents');
};

const docId = (universeId: string) => universeId.toLowerCase();

// Event blobs carry generation metadata (prompts, model ids, character ids,
// version history) that evolves independently of this router — validate the
// shape we rely on (a map keyed by event id) and let individual event
// payloads pass through.
const eventPatchSchema = z.record(
  z.string().min(1),
  z.union([z.record(z.string(), z.any()), z.null()])
);

export const universeEventsRouter = router({
  /** Fetch all scene/event data for a universe. Empty map if nothing saved yet. */
  get: publicProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input }) => {
      const snap = await eventsCol().doc(docId(input.universeId)).get();
      if (!snap.exists) return { events: {} as Record<string, unknown> };
      const data = snap.data()!;
      return { events: (data.events ?? {}) as Record<string, unknown> };
    }),

  /**
   * Upsert a patch of events for a universe. Keys map to a `null` value are
   * removed (e.g. scene deletion); everything else is merged onto whatever
   * is already saved via per-field dot-path updates, matching the merge
   * semantics `graphLayouts.save` uses for node positions.
   */
  upsert: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        events: eventPatchSchema.refine((e) => Object.keys(e).length > 0, {
          message: 'events must include at least one entry',
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const payloadSize = JSON.stringify(input.events).length;
      if (payloadSize > 768 * 1024) {
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Event patch exceeds 768 KiB' });
      }

      const caller = ctx.user.address ?? ctx.user.uid;
      const allowed = await isUniverseCollaborator(input.universeId, caller);
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not authorized to edit this universe',
        });
      }

      const ref = eventsCol().doc(docId(input.universeId));
      const now = new Date();
      const doc = await ref.get();

      if (doc.exists) {
        const patch: Record<string, unknown> = { updatedAt: now, updatedBy: caller };
        for (const [eventId, value] of Object.entries(input.events)) {
          patch[`events.${eventId}`] = value === null ? FieldValue.delete() : value;
        }
        await ref.update(patch);
      } else {
        const events: Record<string, unknown> = {};
        for (const [eventId, value] of Object.entries(input.events)) {
          if (value !== null) events[eventId] = value;
        }
        await ref.set({
          universeId: docId(input.universeId),
          events,
          updatedBy: caller,
          createdAt: now,
          updatedAt: now,
        });
      }

      return { ok: true };
    }),
});
