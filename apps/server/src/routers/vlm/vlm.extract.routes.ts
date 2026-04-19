/**
 * vlm.extract — enqueue video/image → structured lore extraction.
 *
 * .start enqueues a job; .status polls; .get returns the full extraction.
 * All writes live in Firestore collections (vlmJobs, vlmExtractions).
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { getVlmQueue } from '../../lib/queue';
import { consumeRateLimit } from '../../middleware/rate-limit';
import { getCostScope } from '../../services/cost-tracker';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_COUNT = Math.max(
  1,
  parseInt(process.env.VLM_EXTRACT_PER_USER_PER_HOUR || '10', 10)
);

async function enforceRateLimit(uid: string) {
  const { blocked } = await consumeRateLimit(
    `vlm:extract:${uid.toLowerCase()}`,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_COUNT
  );
  if (blocked) {
    throw new Error(`Rate limit exceeded: max ${RATE_LIMIT_COUNT} extractions per user per hour`);
  }
}

export const vlmExtractRouter = router({
  start: protectedProcedure
    .input(
      z.object({
        mediaUrl: z.string().url(),
        assetType: z.enum(['video', 'image']).default('video'),
        mimeType: z.string().optional(),
        contentId: z.string().optional(),
        generationId: z.string().optional(),
        universeAddress: z.string().nullish(),
        userNotes: z.string().max(2000).optional(),
        model: z.enum(['gemini-2.5-pro', 'gemini-2.5-flash']).default('gemini-2.5-pro'),
        force: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      await enforceRateLimit(ctx.user.uid);

      const jobId = `vlm_${randomUUID()}`;
      await db
        .collection('vlmJobs')
        .doc(jobId)
        .set({
          jobId,
          kind: 'extract',
          status: 'pending',
          creatorUid: ctx.user.uid.toLowerCase(),
          input: {
            assetType: input.assetType,
            mediaUrl: input.mediaUrl,
            mimeType: input.mimeType,
            contentId: input.contentId,
            generationId: input.generationId,
            universeAddress: input.universeAddress ?? null,
            options: {
              userNotes: input.userNotes,
              model: input.model,
              force: input.force,
            },
          },
          createdAt: new Date(),
        });

      const queue = getVlmQueue();
      const scope = getCostScope();
      await queue.add(
        'extract',
        {
          jobId,
          kind: 'extract',
          creatorUid: ctx.user.uid.toLowerCase(),
          scope: {
            userId: scope.userId ?? ctx.user.uid.toLowerCase(),
            apiKeyId: scope.apiKeyId ?? null,
            aiAgentId: scope.aiAgentId ?? null,
            universeAddress: input.universeAddress ?? null,
            route: 'trpc:vlm.extract.start',
            requestId: jobId,
          },
          input: {
            assetType: input.assetType,
            mediaUrl: input.mediaUrl,
            mimeType: input.mimeType,
            contentId: input.contentId,
            generationId: input.generationId,
            universeAddress: input.universeAddress ?? null,
            options: {
              userNotes: input.userNotes,
              model: input.model,
              force: input.force,
            },
          },
        },
        { jobId }
      );

      return { jobId };
    }),

  status: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const doc = await db.collection('vlmJobs').doc(input.jobId).get();
      if (!doc.exists) throw new Error('Job not found');
      const data = doc.data()!;
      if (
        data.creatorUid !== ctx.user.uid.toLowerCase() &&
        !data.input?.contentId // owners of content can read too
      ) {
        throw new Error('Forbidden');
      }
      // Cost details are admin-only; do not leak tokensUsed/costUsd to
      // the job creator. Admins query admin.cost.* for the full picture.
      return {
        jobId: input.jobId,
        status: data.status,
        kind: data.kind,
        outputRef: data.outputRef ?? null,
        error: data.error ?? null,
        createdAt: data.createdAt ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
      };
    }),

  get: publicProcedure.input(z.object({ extractionId: z.string() })).query(async ({ input }) => {
    if (!firebaseAvailable) throw new Error('Storage unavailable');
    const doc = await db.collection('vlmExtractions').doc(input.extractionId).get();
    if (!doc.exists) throw new Error('Extraction not found');
    return { id: doc.id, ...doc.data() };
  }),

  listForContent: publicProcedure
    .input(z.object({ contentId: z.string(), limit: z.number().min(1).max(20).default(5) }))
    .query(async ({ input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('vlmExtractions')
        .where('contentId', '==', input.contentId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});
