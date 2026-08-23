/**
 * Graph Layouts Router
 *
 * Persists user-arranged node positions for the app's ReactFlow-based graph
 * canvases (universe DAG, timeline flow editor, anatomy graph) so a manual
 * drag survives a reload instead of being overwritten by the next layout
 * recompute.
 *
 * One doc per (universeId, graphKey) — shared across everyone who views that
 * graph, same as the underlying graph data itself. `graphKey` namespaces
 * multiple canvases per universe (e.g. 'universe', `timeline:${timelineId}`,
 * 'anatomy') and is kept a plain string so a new canvas doesn't need a schema
 * change.
 *
 * Reads are public (positions aren't sensitive — same visibility model as the
 * graph itself). Writes require universe edit access, same chokepoint used
 * for editing any other universe content (isUniverseCollaborator).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { isUniverseCollaborator } from '../../lib/safe-admin';

const layoutsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('graphLayouts');
};

const positionSchema = z.object({ x: z.number(), y: z.number() });

const graphKeySchema = z.string().min(1).max(120);

const docId = (universeId: string, graphKey: string) => `${universeId.toLowerCase()}::${graphKey}`;

export const graphLayoutsRouter = router({
  /** Fetch saved node positions for a graph. Null if nothing saved yet. */
  get: publicProcedure
    .input(z.object({ universeId: z.string().min(1), graphKey: graphKeySchema }))
    .query(async ({ input }) => {
      const snap = await layoutsCol().doc(docId(input.universeId, input.graphKey)).get();
      if (!snap.exists) return null;
      const data = snap.data()!;
      return {
        positions: (data.positions ?? {}) as Record<string, { x: number; y: number }>,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    }),

  /**
   * Upsert node positions for a graph. Accepts a partial patch — only the
   * nodes that moved — and merges them onto whatever is already saved via
   * per-field dot-path updates, so two collaborators dragging different
   * nodes around the same time don't clobber each other.
   */
  save: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        graphKey: graphKeySchema,
        positions: z.record(z.string(), positionSchema).refine((p) => Object.keys(p).length > 0, {
          message: 'positions must include at least one node',
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const payloadSize = JSON.stringify(input.positions).length;
      if (payloadSize > 256 * 1024) {
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Layout exceeds 256 KiB' });
      }

      const caller = ctx.user.address ?? ctx.user.uid;
      const allowed = await isUniverseCollaborator(input.universeId, caller);
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not authorized to edit this universe',
        });
      }

      const ref = layoutsCol().doc(docId(input.universeId, input.graphKey));
      const now = new Date();
      const doc = await ref.get();

      if (doc.exists) {
        const patch: Record<string, unknown> = { updatedAt: now, updatedBy: caller };
        for (const [nodeId, pos] of Object.entries(input.positions)) {
          patch[`positions.${nodeId}`] = pos;
        }
        await ref.update(patch);
      } else {
        await ref.set({
          universeId: input.universeId.toLowerCase(),
          graphKey: input.graphKey,
          positions: input.positions,
          updatedBy: caller,
          createdAt: now,
          updatedAt: now,
        });
      }

      return { ok: true };
    }),
});
