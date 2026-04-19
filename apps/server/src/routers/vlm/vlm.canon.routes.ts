/**
 * vlm.canon — consistency check against the universe bible.
 * Runs synchronously (uses gemini-2.5-flash, typically a few seconds).
 */

import { z } from 'zod';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { runCanonCheck } from '../../services/vlm';

export const vlmCanonRouter = router({
  check: protectedProcedure
    .input(
      z.object({
        extractionId: z.string(),
        universeAddress: z.string(),
        targetId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const exDoc = await db.collection('vlmExtractions').doc(input.extractionId).get();
      if (!exDoc.exists) throw new Error('Extraction not found');
      const extraction = exDoc.data() as any;
      const result = await runCanonCheck({
        extraction,
        universeAddress: input.universeAddress,
        targetId: input.targetId,
      });
      return result;
    }),

  getConflicts: publicProcedure
    .input(z.object({ targetId: z.string(), limit: z.number().min(1).max(20).default(5) }))
    .query(async ({ input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('canonConflicts')
        .where('targetId', '==', input.targetId)
        .orderBy('checkedAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});
