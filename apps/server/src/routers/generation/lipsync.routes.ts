/**
 * Lip-Sync & Captions Router
 *
 * AI-powered lip-sync, transcription, and auto-caption generation.
 *
 * Capabilities:
 *   lipsync.sync              — Synchronize video with audio (lip-sync)
 *   lipsync.transcribe        — Transcribe audio to text with timestamps
 *   lipsync.generateCaptions  — Auto-generate SRT/VTT/JSON captions from video
 *   lipsync.getHistory        — User's lip-sync/transcription/caption history
 *
 * Pricing:
 *   sync             5 credits
 *   transcribe       2 credits
 *   generateCaptions 3 credits
 */
import { router, protectedProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { lipSyncService } from '../../services/lipsync';
import { transcriptionService } from '../../services/transcription';
import { firebaseStorageService } from '../../services/firebase-storage';
import { trackQuests } from '../../services/quest-tracker';
import { emitActivity } from '../../services/activity';
import { logFailedRefund } from '../../lib/refund-audit';
import { publishToGallery } from '../../lib/gallery-publish';
import { extractVideoThumbnail } from '../../services/video-thumbnail';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { TRPCError } from '@trpc/server';

const clientTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
  .optional();

// ── Credit costs ────────────────────────────────────────────────────

const LIPSYNC_CREDITS = 5;
const TRANSCRIBE_CREDITS = 2;
const CAPTION_CREDITS = 3;

// ── Collections ─────────────────────────────────────────────────────

const lipsyncGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('lipsyncGenerations');
};

const transcriptionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('transcriptions');
};

const captionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('captions');
};

// ── Credit helpers ──────────────────────────────────────────────────

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

async function deductCredits(userId: string, credits: number): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(userId, credits);
  const ref = userCreditsCol().doc(userId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new Error(
        `Insufficient credits. Need ${credits}, have ${balance}. Purchase more to continue.`
      );
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(userId: string, credits: number, genId?: string): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  const { recordCreditsTx, recordAiGeneration } = await import('../../lib/metrics');
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
    recordCreditsTx('refund', 'success');
  } catch (err) {
    recordCreditsTx('refund', 'failure');
    console.error(`CRITICAL: Lipsync credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'lipsync',
      generationId: genId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
  recordAiGeneration('fal', 'lipsync', 'failure');
}

// ── Storage upload helper ───────────────────────────────────────────

async function uploadVideo(buffer: Buffer, filename: string): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, filename);
  return firebaseStorageService.getPublicUrl(key);
}

// ── Caption formatting helpers ──────────────────────────────────────

function formatTimeSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatTimeVTT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function segmentsToSRT(segments: Array<{ start: number; end: number; text: string }>): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}\n`
    )
    .join('\n');
}

function segmentsToVTT(segments: Array<{ start: number; end: number; text: string }>): string {
  const cues = segments
    .map((seg) => `${formatTimeVTT(seg.start)} --> ${formatTimeVTT(seg.end)}\n${seg.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${cues}`;
}

// ── Router ──────────────────────────────────────────────────────────

export const lipsyncRouter = router({
  // ── Lip-sync video with audio ─────────────────────────────────────

  sync: protectedProcedure
    .use(requirePermission('generation.lipsync'))
    .input(
      z.object({
        videoUrl: z.string().url(),
        audioUrl: z.string().url(),
        model: z.enum(['fal-ai/lipsync', 'fal-ai/sadtalker']).optional(),
        entityId: z.string().optional(),
        /** Lineage: upstream generation IDs for the source video and audio. */
        sourceVideoGenerationId: z.string().optional(),
        sourceAudioGenerationId: z.string().optional(),
        /** When false, caller will publish manually (e.g. talking-scene combo). */
        autoPublish: z.boolean().default(true),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();

      // Idempotency check before any credit deduction.
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: genId,
          procedure: 'lipsync.sync',
        });
        if (reservation?.existing) {
          const existing = await lipsyncGenerationsCol().doc(reservation.existing.jobId).get();
          const d = existing.exists ? (existing.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            videoUrl: (d.resultVideoUrl ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      // Validate webhookUrl early.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      const startTime = Date.now();
      const credits = LIPSYNC_CREDITS;

      // Save initial record
      await lipsyncGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          type: 'sync',
          model: input.model || 'fal-ai/lipsync',
          videoUrl: input.videoUrl,
          audioUrl: input.audioUrl,
          sourceVideoGenerationId: input.sourceVideoGenerationId || null,
          sourceAudioGenerationId: input.sourceAudioGenerationId || null,
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await lipsyncGenerationsCol().doc(genId).update({ status: 'running' });

        const result = await lipSyncService.sync({
          videoUrl: input.videoUrl,
          audioUrl: input.audioUrl,
          model: input.model,
        });

        if (result.status === 'failed' || !result.videoUrl) {
          throw new Error(result.error || 'Lip-sync failed — no video returned');
        }

        // Download and re-upload to Firebase Storage for permanence
        const videoRes = await fetch(result.videoUrl);
        if (!videoRes.ok) throw new Error('Failed to download synced video from provider');
        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
        const filename = `lipsync-${genId}.mp4`;
        const permanentUrl = await uploadVideo(videoBuffer, filename);

        const latencyMs = Date.now() - startTime;

        trackQuests(ctx.user.uid, [{ questId: 'first_lipsync' }]);

        emitActivity({
          actorUid: ctx.user.uid,
          eventType: 'ai_pipeline_completed',
          targetType: 'lipsync',
          targetId: genId,
          metadata: { model: input.model || 'fal-ai/lipsync' },
        });

        await lipsyncGenerationsCol().doc(genId).update({
          status: 'completed',
          resultVideoUrl: permanentUrl,
          latencyMs,
          completedAt: new Date(),
        });

        // Auto-publish to gallery — every clip auto-appears (per project policy)
        if (input.autoPublish) {
          try {
            const thumbnailUrl = await extractVideoThumbnail(permanentUrl, genId);
            await publishToGallery({
              creatorUid: ctx.user.uid,
              mediaUrl: permanentUrl,
              thumbnailUrl,
              mediaType: 'ai-video',
              title: 'Lip-Synced Clip',
              description: 'AI lip-sync of source video with synthesized audio',
              generationId: genId,
              generationModel: input.model || 'fal-ai/lipsync',
              parentGenerationId: input.sourceVideoGenerationId || null,
              sourceVideoGenerationId: input.sourceVideoGenerationId || null,
              sourceAudioGenerationId: input.sourceAudioGenerationId || null,
            });
          } catch (err) {
            console.error('[lipsync] gallery publish failed:', err);
          }
        }

        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.completed',
          jobId: genId,
          kind: 'video',
          payload: {
            operation: 'lipsync',
            status: 'completed',
            resultUrl: permanentUrl,
            modelUsed: input.model || 'fal-ai/lipsync',
            creditsCharged: credits,
          },
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          videoUrl: permanentUrl as string | null,
          creditsCharged: credits,
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
        await lipsyncGenerationsCol()
          .doc(genId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.failed',
          jobId: genId,
          kind: 'video',
          payload: {
            operation: 'lipsync',
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error;
      }
    }),

  // ── Transcribe audio ──────────────────────────────────────────────

  transcribe: protectedProcedure
    .use(requirePermission('generation.lipsync'))
    .input(
      z.object({
        audioUrl: z.string().url(),
        language: z.string().max(10).optional(),
        entityId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const transcriptionId = randomUUID();
      const startTime = Date.now();
      const credits = TRANSCRIBE_CREDITS;

      await transcriptionsCol()
        .doc(transcriptionId)
        .set({
          id: transcriptionId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          type: 'transcription',
          audioUrl: input.audioUrl,
          language: input.language || 'en',
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await transcriptionsCol().doc(transcriptionId).update({ status: 'running' });

        const result = await transcriptionService.transcribe({
          audioUrl: input.audioUrl,
          language: input.language,
        });

        if (result.status === 'failed' || (!result.text && !result.segments)) {
          throw new Error(result.error || 'Transcription failed — no text returned');
        }

        const latencyMs = Date.now() - startTime;

        trackQuests(ctx.user.uid, [{ questId: 'first_transcription' }]);

        await transcriptionsCol()
          .doc(transcriptionId)
          .update({
            status: 'completed',
            text: result.text || null,
            segments: result.segments || [],
            detectedLanguage: result.language || null,
            latencyMs,
            completedAt: new Date(),
          });

        return {
          transcriptionId,
          status: 'completed' as const,
          text: result.text,
          segments: result.segments,
          creditsCharged: credits,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, transcriptionId);
        await transcriptionsCol()
          .doc(transcriptionId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        throw error;
      }
    }),

  // ── Generate captions from video ──────────────────────────────────

  generateCaptions: protectedProcedure
    .use(requirePermission('generation.lipsync'))
    .input(
      z.object({
        videoUrl: z.string().url(),
        language: z.string().max(10).optional(),
        format: z.enum(['srt', 'vtt', 'json']).default('srt'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const captionId = randomUUID();
      const startTime = Date.now();
      const credits = CAPTION_CREDITS;

      await captionsCol()
        .doc(captionId)
        .set({
          id: captionId,
          userId: ctx.user.uid,
          type: 'caption',
          videoUrl: input.videoUrl,
          language: input.language || 'en',
          format: input.format,
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await captionsCol().doc(captionId).update({ status: 'running' });

        // Transcribe the video's audio (FAL Whisper accepts video URLs too)
        const result = await transcriptionService.transcribe({
          audioUrl: input.videoUrl,
          language: input.language,
        });

        if (result.status === 'failed' || !result.segments || result.segments.length === 0) {
          throw new Error(result.error || 'Caption generation failed — no segments returned');
        }

        // Format segments into requested caption format
        let captions: string;
        switch (input.format) {
          case 'vtt':
            captions = segmentsToVTT(result.segments);
            break;
          case 'json':
            captions = JSON.stringify(result.segments, null, 2);
            break;
          case 'srt':
          default:
            captions = segmentsToSRT(result.segments);
            break;
        }

        const latencyMs = Date.now() - startTime;

        trackQuests(ctx.user.uid, [{ questId: 'first_captions' }]);

        emitActivity({
          actorUid: ctx.user.uid,
          eventType: 'ai_pipeline_completed',
          targetType: 'caption',
          targetId: captionId,
          metadata: { format: input.format },
        });

        await captionsCol()
          .doc(captionId)
          .update({
            status: 'completed',
            captions,
            segments: result.segments,
            detectedLanguage: result.language || null,
            latencyMs,
            completedAt: new Date(),
          });

        return {
          captionId,
          status: 'completed' as const,
          captions,
          format: input.format,
          creditsCharged: credits,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, captionId);
        await captionsCol()
          .doc(captionId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        throw error;
      }
    }),

  // ── History ───────────────────────────────────────────────────────

  getHistory: protectedProcedure
    .input(
      z.object({
        type: z.enum(['sync', 'transcription', 'caption']).optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const results: Array<{ id: string; [key: string]: any }> = [];

      const shouldFetch = (t: string) => !input.type || input.type === t;

      if (shouldFetch('sync')) {
        const snap = await lipsyncGenerationsCol()
          .where('userId', '==', ctx.user.uid)
          .orderBy('createdAt', 'desc')
          .limit(input.limit)
          .get();
        snap.docs.forEach((doc) => results.push({ id: doc.id, type: 'sync', ...doc.data() }));
      }

      if (shouldFetch('transcription')) {
        const snap = await transcriptionsCol()
          .where('userId', '==', ctx.user.uid)
          .orderBy('createdAt', 'desc')
          .limit(input.limit)
          .get();
        snap.docs.forEach((doc) =>
          results.push({ id: doc.id, type: 'transcription', ...doc.data() })
        );
      }

      if (shouldFetch('caption')) {
        const snap = await captionsCol()
          .where('userId', '==', ctx.user.uid)
          .orderBy('createdAt', 'desc')
          .limit(input.limit)
          .get();
        snap.docs.forEach((doc) => results.push({ id: doc.id, type: 'caption', ...doc.data() }));
      }

      // Sort combined results by createdAt descending, then limit
      results.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.getTime?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.getTime?.() || 0;
        return bTime - aTime;
      });

      return results.slice(0, input.limit);
    }),
});
