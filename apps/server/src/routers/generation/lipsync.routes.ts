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
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error(`CRITICAL: Lipsync credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'lipsync',
      generationId: genId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
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
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
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
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
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

        return {
          generationId: genId,
          status: 'completed' as const,
          videoUrl: permanentUrl,
          creditsCharged: credits,
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
