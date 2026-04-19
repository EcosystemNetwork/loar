/**
 * vlm.governance — draft a canon proposal from an extraction.
 * Output is stored in `canonProposalDrafts/{id}`; actually putting it on-chain
 * or into the tRPC `governance.*` flow is a separate, explicit action.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { runGovernanceDraft } from '../../services/vlm';

export const vlmGovernanceRouter = router({
  draftProposal: protectedProcedure
    .input(
      z.object({
        extractionId: z.string(),
        universeAddress: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const exDoc = await db.collection('vlmExtractions').doc(input.extractionId).get();
      if (!exDoc.exists) throw new Error('Extraction not found');
      const extraction = exDoc.data() as any;
      if (extraction.creatorUid && extraction.creatorUid !== ctx.user.uid.toLowerCase()) {
        throw new Error('You can only draft proposals for your own extractions');
      }
      const draft = await runGovernanceDraft({
        extraction,
        universeAddress: input.universeAddress,
        creatorUid: ctx.user.uid.toLowerCase(),
      });
      return draft;
    }),

  listDrafts: protectedProcedure
    .input(
      z.object({
        universeAddress: z.string(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('canonProposalDrafts')
        .where('universeAddress', '==', input.universeAddress)
        .where('creatorUid', '==', ctx.user.uid.toLowerCase())
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});
