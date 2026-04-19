/**
 * vlm.recap — trailer beats, chapter markers, recap text, SEO, thumbnails.
 *
 * Sync call (cheap enough for Gemini Pro on short/medium videos). For very
 * long assets, prefer enqueuing via the VLM queue with kind='recap'.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { runRecap } from '../../services/vlm';

export const vlmRecapRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        mediaUrl: z.string().url(),
        assetType: z.enum(['video', 'image']).default('video'),
        mimeType: z.string().optional(),
        contentId: z.string().optional(),
        extractionId: z.string().optional(),
        targetDurationSec: z.number().positive().max(600).optional(),
        audience: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let extraction: any = undefined;
      if (input.extractionId && firebaseAvailable) {
        const d = await db.collection('vlmExtractions').doc(input.extractionId).get();
        if (d.exists) extraction = d.data();
      }
      const result = await runRecap({
        mediaUrl: input.mediaUrl,
        assetType: input.assetType,
        mimeType: input.mimeType,
        targetDurationSec: input.targetDurationSec,
        audience: input.audience,
        extraction,
      });
      if (firebaseAvailable) {
        await db.collection('vlmRecaps').add({
          creatorUid: ctx.user.uid.toLowerCase(),
          contentId: input.contentId ?? null,
          extractionId: input.extractionId ?? null,
          recap: result.recap,
          tokensUsed: result.tokensUsed,
          costUsd: result.costUsd,
          createdAt: new Date(),
        });
      }
      return result;
    }),
});
