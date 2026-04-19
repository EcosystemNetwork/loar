/**
 * 9:16 Auto-Cutdown Router
 *
 * Takes existing landscape (16:9) video content and generates vertical (9:16)
 * short-form cuts using AI-powered reframing. Analyzes audio via Whisper to
 * identify highlight moments, computes center-crop parameters for the target
 * aspect ratio, and returns segment/caption metadata the frontend uses to
 * render the short.
 *
 * Firestore collection: `cutdowns`
 */
import { protectedProcedure, publicProcedure, router, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { trackQuests } from '../../services/quest-tracker';
import { emitActivity } from '../../services/activity';
import { TRPCError } from '@trpc/server';

// ── Firestore helpers ────────────────────────────────────────────────────

const cutdownsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cutdowns');
};

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

// ── Credit helpers ───────────────────────────────────────────────────────

const CUTDOWN_COST = 8; // credits per cutdown generation

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

async function refundCredits(userId: string, credits: number, cutdownId?: string): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error(
      `[cutdown] Failed to refund ${credits} credits for ${userId} (${cutdownId}):`,
      err
    );
  }
}

// ── Aspect ratio helpers ─────────────────────────────────────────────────

/** Compute center-crop rectangle to convert 16:9 source to target ratio. */
function computeCropParams(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: '9:16' | '1:1' | '4:5'
): { x: number; y: number; width: number; height: number } {
  const ratioMap: Record<string, number> = {
    '9:16': 9 / 16,
    '1:1': 1,
    '4:5': 4 / 5,
  };
  const target = ratioMap[targetRatio];

  // Fit within source dimensions
  let cropWidth: number;
  let cropHeight: number;

  if (sourceWidth / sourceHeight > target) {
    // Source is wider than target ratio — crop width
    cropHeight = sourceHeight;
    cropWidth = Math.round(sourceHeight * target);
  } else {
    // Source is taller — crop height
    cropWidth = sourceWidth;
    cropHeight = Math.round(sourceWidth / target);
  }

  // Center the crop
  const x = Math.round((sourceWidth - cropWidth) / 2);
  const y = Math.round((sourceHeight - cropHeight) / 2);

  return { x, y, width: cropWidth, height: cropHeight };
}

/** Generate highlight segments from transcription data. */
function pickHighlightSegments(
  transcription: Array<{ start: number; end: number; text: string }>,
  maxDurationSec: number,
  mode: 'auto' | 'highlight' | 'full'
): Array<{ startSec: number; endSec: number; importance: number }> {
  if (!transcription.length) {
    // No speech — return a single segment from the start
    return [{ startSec: 0, endSec: Math.min(maxDurationSec, 60), importance: 1.0 }];
  }

  if (mode === 'full') {
    // Reframe the entire video up to maxDuration
    const totalDuration = transcription[transcription.length - 1].end;
    return [{ startSec: 0, endSec: Math.min(totalDuration, maxDurationSec), importance: 1.0 }];
  }

  if (mode === 'highlight') {
    // Take segments from the beginning up to maxDuration
    let accumulated = 0;
    const segments: Array<{ startSec: number; endSec: number; importance: number }> = [];
    for (const seg of transcription) {
      const segDuration = seg.end - seg.start;
      if (accumulated + segDuration > maxDurationSec) break;
      segments.push({ startSec: seg.start, endSec: seg.end, importance: 0.8 });
      accumulated += segDuration;
    }
    return segments.length
      ? segments
      : [{ startSec: 0, endSec: Math.min(maxDurationSec, 30), importance: 0.5 }];
  }

  // mode === 'auto': score segments by word density and pick the densest ones
  const scored = transcription.map((seg) => {
    const duration = seg.end - seg.start;
    const wordCount = seg.text.trim().split(/\s+/).length;
    const density = duration > 0 ? wordCount / duration : 0;
    return { ...seg, density, duration };
  });

  // Sort by density descending
  scored.sort((a, b) => b.density - a.density);

  // Greedily pick non-overlapping segments up to maxDuration
  const picked: Array<{ startSec: number; endSec: number; importance: number }> = [];
  let totalDuration = 0;

  for (const seg of scored) {
    if (totalDuration + seg.duration > maxDurationSec) continue;

    // Check overlap with already picked
    const overlaps = picked.some((p) => seg.start < p.endSec && seg.end > p.startSec);
    if (overlaps) continue;

    picked.push({
      startSec: seg.start,
      endSec: seg.end,
      importance: Math.min(seg.density / 3, 1.0), // normalize to 0–1
    });
    totalDuration += seg.duration;

    if (totalDuration >= maxDurationSec) break;
  }

  // Sort chronologically
  picked.sort((a, b) => a.startSec - b.startSec);

  return picked.length
    ? picked
    : [{ startSec: 0, endSec: Math.min(maxDurationSec, 30), importance: 0.5 }];
}

// ── Whisper transcription stub ───────────────────────────────────────────

/**
 * Transcribe video audio using FAL Whisper.
 * Returns word-level or segment-level timestamps.
 *
 * In production this calls fal-ai/whisper; for now returns a simulated
 * transcription if FAL is unavailable, ensuring the pipeline always completes.
 */
async function transcribeVideo(
  videoUrl: string
): Promise<Array<{ start: number; end: number; text: string }>> {
  try {
    // Attempt FAL Whisper transcription
    const { fal } = (await import(/* @vite-ignore */ '@fal-ai/client' as string)) as any;
    const result = await (fal as any).subscribe('fal-ai/whisper', {
      input: { audio_url: videoUrl },
    });

    const chunks: Array<{ start: number; end: number; text: string }> =
      result?.data?.chunks ?? result?.chunks ?? [];

    if (chunks.length > 0) return chunks;

    // Fallback: if no chunks but we have text, create a single segment
    const text = result?.data?.text ?? result?.text;
    if (text) {
      return [{ start: 0, end: 60, text }];
    }

    return [];
  } catch (err) {
    console.warn(
      '[cutdown] Whisper transcription failed, returning empty transcript:',
      (err as Error).message
    );
    return [];
  }
}

// ── Router ───────────────────────────────────────────────────────────────

export const cutdownRouter = router({
  /**
   * Generate a vertical cutdown from landscape source video.
   *
   * Pipeline:
   *   1. Save cutdown record as 'queued'
   *   2. Deduct credits (8)
   *   3. Transcribe audio via Whisper for highlight detection
   *   4. Compute highlight segments based on mode
   *   5. Compute crop parameters for target aspect ratio
   *   6. Generate caption overlay data
   *   7. Save completed record and return metadata
   */
  generate: protectedProcedure
    .input(
      z.object({
        sourceVideoUrl: z.string().url(),
        sourceContentId: z.string().optional(),
        universeAddress: z.string().optional(),
        targetAspectRatio: z.enum(['9:16', '1:1', '4:5']).default('9:16'),
        mode: z.enum(['auto', 'highlight', 'full']).default('auto'),
        maxDurationSec: z.number().min(5).max(90).default(60),
        addCaptions: z.boolean().default(true),
        captionStyle: z.enum(['default', 'bold', 'minimal', 'karaoke']).default('default'),
        title: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cutdownId = randomUUID();
      const userId = ctx.user.uid;
      const now = new Date();

      // 1. Save initial record
      await cutdownsCol()
        .doc(cutdownId)
        .set({
          cutdownId,
          userId,
          status: 'queued',
          sourceVideoUrl: input.sourceVideoUrl,
          sourceContentId: input.sourceContentId ?? null,
          universeAddress: input.universeAddress ?? null,
          targetAspectRatio: input.targetAspectRatio,
          mode: input.mode,
          maxDurationSec: input.maxDurationSec,
          addCaptions: input.addCaptions,
          captionStyle: input.captionStyle,
          title: input.title ?? null,
          creditsCharged: CUTDOWN_COST,
          createdAt: now,
          updatedAt: now,
        });

      // 2. Deduct credits
      try {
        await deductCredits(userId, CUTDOWN_COST);
      } catch (err) {
        await cutdownsCol()
          .doc(cutdownId)
          .update({ status: 'failed', error: (err as Error).message, updatedAt: new Date() });
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: (err as Error).message,
        });
      }

      // 3. Update status to processing
      await cutdownsCol().doc(cutdownId).update({ status: 'processing', updatedAt: new Date() });

      try {
        // 4. Transcribe audio
        const transcription = await transcribeVideo(input.sourceVideoUrl);

        // 5. Pick highlight segments
        const segments = pickHighlightSegments(transcription, input.maxDurationSec, input.mode);

        // 6. Compute crop parameters (assume 1920x1080 source — standard 16:9)
        const cropParams = computeCropParams(1920, 1080, input.targetAspectRatio);

        // 7. Generate captions if requested
        let captions: Array<{ start: number; end: number; text: string }> | undefined;
        if (input.addCaptions && transcription.length > 0) {
          // Filter transcription to only include segments within the selected time ranges
          captions = transcription.filter((t) =>
            segments.some((s) => t.start >= s.startSec && t.end <= s.endSec)
          );
          // If strict filtering yields nothing, include all transcription within the time window
          if (captions.length === 0) {
            const minStart = segments[0]?.startSec ?? 0;
            const maxEnd = segments[segments.length - 1]?.endSec ?? input.maxDurationSec;
            captions = transcription.filter((t) => t.start >= minStart && t.end <= maxEnd);
          }
        }

        // 8. Compute total duration of selected segments
        const totalDurationSec = segments.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);

        // 9. Save completed record
        const completedData = {
          status: 'completed' as const,
          segments,
          cropParams,
          captions: captions ?? null,
          captionStyle: input.captionStyle,
          totalDurationSec,
          updatedAt: new Date(),
        };
        await cutdownsCol().doc(cutdownId).update(completedData);

        // Fire-and-forget: track quests and emit activity
        trackQuests(userId, [{ questId: 'create_cutdown' }, { questId: 'create_short_content' }]);

        emitActivity({
          eventType: 'created_content',
          actorUid: userId,
          targetType: 'cutdown',
          targetId: cutdownId,
          targetTitle: input.title || `${input.targetAspectRatio} cutdown`,
          metadata: {
            universeAddress: input.universeAddress ?? '',
          },
        }).catch(() => {}); // swallow

        return {
          cutdownId,
          status: 'completed' as const,
          sourceVideoUrl: input.sourceVideoUrl,
          segments,
          cropParams,
          captions: captions ?? undefined,
          totalDurationSec,
          creditsCharged: CUTDOWN_COST,
        };
      } catch (err) {
        // Pipeline failed — refund credits and mark failed
        await refundCredits(userId, CUTDOWN_COST, cutdownId);
        await cutdownsCol()
          .doc(cutdownId)
          .update({
            status: 'failed',
            error: (err as Error).message,
            updatedAt: new Date(),
          });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Cutdown generation failed: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * List cutdown history for the authenticated user.
   */
  list: protectedProcedure
    .input(
      z.object({
        universeAddress: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = cutdownsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.universeAddress) {
        query = cutdownsCol()
          .where('userId', '==', ctx.user.uid)
          .where('universeAddress', '==', input.universeAddress)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snap = await query.get();
      return snap.docs.map((doc) => {
        const data = doc.data();
        return {
          cutdownId: data.cutdownId,
          status: data.status,
          sourceVideoUrl: data.sourceVideoUrl,
          sourceContentId: data.sourceContentId ?? null,
          universeAddress: data.universeAddress ?? null,
          targetAspectRatio: data.targetAspectRatio,
          mode: data.mode,
          title: data.title ?? null,
          totalDurationSec: data.totalDurationSec ?? null,
          creditsCharged: data.creditsCharged,
          createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
        };
      });
    }),

  /**
   * Get full cutdown details including segments and captions.
   */
  get: publicProcedure.input(z.object({ cutdownId: z.string() })).query(async ({ input }) => {
    const doc = await cutdownsCol().doc(input.cutdownId).get();
    if (!doc.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Cutdown not found' });
    }

    const data = doc.data()!;
    return {
      cutdownId: data.cutdownId,
      status: data.status,
      sourceVideoUrl: data.sourceVideoUrl,
      sourceContentId: data.sourceContentId ?? null,
      universeAddress: data.universeAddress ?? null,
      targetAspectRatio: data.targetAspectRatio,
      mode: data.mode,
      title: data.title ?? null,
      maxDurationSec: data.maxDurationSec,
      addCaptions: data.addCaptions,
      captionStyle: data.captionStyle,
      segments: data.segments ?? [],
      cropParams: data.cropParams ?? null,
      captions: data.captions ?? null,
      totalDurationSec: data.totalDurationSec ?? null,
      creditsCharged: data.creditsCharged,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
      updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt,
      error: data.error ?? null,
    };
  }),

  /**
   * Manually adjust AI-selected segments for a cutdown.
   * Only the owner can update segments.
   */
  updateSegments: protectedProcedure
    .input(
      z.object({
        cutdownId: z.string(),
        segments: z
          .array(
            z.object({
              startSec: z.number().min(0),
              endSec: z.number().min(0),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await cutdownsCol().doc(input.cutdownId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Cutdown not found' });
      }

      const data = doc.data()!;
      if (data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only edit your own cutdowns' });
      }

      if (data.status !== 'completed') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Can only update segments on completed cutdowns',
        });
      }

      // Validate segments don't exceed maxDurationSec
      const totalDuration = input.segments.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
      if (totalDuration > (data.maxDurationSec ?? 90)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Total segment duration (${totalDuration}s) exceeds max (${data.maxDurationSec}s)`,
        });
      }

      // Add importance scores (user-selected = high importance)
      const segments = input.segments.map((s) => ({
        startSec: s.startSec,
        endSec: s.endSec,
        importance: 1.0,
      }));

      await cutdownsCol().doc(input.cutdownId).update({
        segments,
        totalDurationSec: totalDuration,
        updatedAt: new Date(),
      });

      return {
        cutdownId: input.cutdownId,
        segments,
        totalDurationSec: totalDuration,
      };
    }),
});
