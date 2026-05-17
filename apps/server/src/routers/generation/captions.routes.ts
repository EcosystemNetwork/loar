/**
 * Voice Studio Captions Router
 *
 * Custom caption pipeline for the Voice Studio:
 *   captions.transcribe  — Run ASR on an audio/video URL, persist a caption project
 *                          with editable segments. Charges credits.
 *   captions.save        — Persist user-edited segments to a caption project (no charge).
 *   captions.render      — Pure formatter: segments + style options → SRT/VTT/JSON.
 *                          No charge, no I/O — works on already-transcribed segments.
 *   captions.list        — User's caption projects.
 *   captions.get         — Single caption project by id.
 *   captions.delete      — Remove a caption project.
 *
 * Built on the same FAL Whisper backend as `lipsync.transcribe`, but scoped to
 * `generation.voice` permission and surfaced through Voice Studio.
 */
import { router, protectedProcedure, requirePermission, expensiveProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { transcriptionService } from '../../services/transcription';
import { trackQuests } from '../../services/quest-tracker';
import {
  renderCaptions,
  shapeSegments,
  type CaptionSegment,
  type CaptionFormat,
} from '../../lib/captions-format';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';
import { quoteCredits, getModelById } from '../../services/transcription-models';
import { reserve, reconcile, cancel } from '../../services/credits';

// ── Pricing ─────────────────────────────────────────────────────────
//
// Per-minute pricing comes from the transcription-models registry. The
// caller supplies an `expectedMinutes` hint; we reserve `quote × 1.20`
// up front and reconcile to the actual minutes derived from the
// FAL Whisper segment timestamps.

const DEFAULT_MODEL_ID = 'whisper-fal';
const DEFAULT_EXPECTED_MINUTES = 1;
const RESERVE_BUFFER = 1.2;

// ── Collections ─────────────────────────────────────────────────────

const captionProjectsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('captionProjects');
};

// ── Schemas ─────────────────────────────────────────────────────────

const wordSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().max(200),
});

const segmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().max(2000),
  speaker: z.string().max(64).nullish(),
  words: z.array(wordSchema).max(500).optional(),
});

const styleSchema = z.object({
  maxCharsPerLine: z.number().int().min(8).max(120).optional(),
  maxLinesPerCue: z.number().int().min(1).max(4).optional(),
  mergeGapSeconds: z.number().min(0).max(5).optional(),
  includeSpeakerLabels: z.boolean().optional(),
  wordHighlight: z.boolean().optional(),
});

// ── Router ──────────────────────────────────────────────────────────

export const captionsRouter = router({
  // ── Transcribe a source audio/video URL into editable segments ────

  transcribe: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        sourceUrl: z.string().url(),
        language: z.string().max(10).optional(),
        title: z.string().max(200).optional(),
        episodeId: z.string().optional(),
        projectId: z.string().optional(),
        /** Transcription model id from the transcription-models registry. */
        modelId: z.string().optional(),
        /**
         * Caller's best estimate of audio length, in minutes. Used to size
         * the credit reservation. The reservation is reconciled to actual
         * duration after the FAL response, so a low estimate triggers an
         * overrun debit (within the 1.20 buffer) and a high estimate
         * triggers a refund. Default: 1 minute (matches historical
         * flat 2-credit charge for whisper-fal).
         */
        expectedMinutes: z.number().positive().max(240).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // SSRF guard: refuse loopback / RFC1918 / IMDS / link-local hosts before
      // the transcription service dereferences the URL.
      try {
        assertSafeExternalUrl(input.sourceUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'sourceUrl rejected',
        });
      }

      const modelId = input.modelId ?? DEFAULT_MODEL_ID;
      const model = getModelById(modelId);
      if (!model || !model.isEnabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown or disabled transcription model: ${modelId}`,
        });
      }

      const captionProjectId = input.projectId ?? randomUUID();
      const startTime = Date.now();
      const expectedMinutes = input.expectedMinutes ?? DEFAULT_EXPECTED_MINUTES;
      const quoted = quoteCredits(modelId, expectedMinutes);
      const reserveCredits = Math.ceil(quoted * RESERVE_BUFFER);

      // Create or refresh the project record up front in 'running' state.
      await captionProjectsCol()
        .doc(captionProjectId)
        .set(
          {
            id: captionProjectId,
            userId: ctx.user.uid,
            episodeId: input.episodeId ?? null,
            title: input.title ?? 'Untitled captions',
            sourceUrl: input.sourceUrl,
            language: input.language ?? 'en',
            status: 'running',
            modelId,
            expectedMinutes,
            reservedCredits: reserveCredits,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      const { reservationId } = await reserve({
        userId: ctx.user.uid,
        modelId,
        provider: model.provider,
        estimatedCredits: reserveCredits,
        byok: false, // Phase 1: server pool only
        meta: { captionProjectId, episodeId: input.episodeId ?? null },
      });

      await captionProjectsCol().doc(captionProjectId).update({ reservationId });

      try {
        const result = await transcriptionService.transcribe({
          audioUrl: input.sourceUrl,
          language: input.language,
        });

        if (result.status === 'failed' || !result.segments || result.segments.length === 0) {
          throw new Error(result.error || 'Transcription failed — no segments returned');
        }

        const segments: CaptionSegment[] = result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          speaker: null,
        }));

        const latencyMs = Date.now() - startTime;

        // Derive actual audio minutes from the last segment's end timestamp.
        // FAL Whisper returns timestamps in seconds; convert to minutes and
        // round up (any partial minute charges as a full minute, matching
        // every other per-minute API on the market).
        const actualSeconds = segments[segments.length - 1]?.end ?? 0;
        const actualMinutes = Math.max(1, Math.ceil(actualSeconds / 60));
        const actualCredits = quoteCredits(modelId, actualMinutes);
        const reconciled = await reconcile({ reservationId, actualCredits });

        trackQuests(ctx.user.uid, [{ questId: 'first_captions' }]);

        await captionProjectsCol()
          .doc(captionProjectId)
          .update({
            status: 'completed',
            segments,
            text: result.text ?? null,
            detectedLanguage: result.language ?? null,
            actualMinutes,
            creditsCharged: actualCredits,
            reconcileStatus: reconciled.status,
            latencyMs,
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

        return {
          captionProjectId,
          status: 'completed' as const,
          segments,
          detectedLanguage: result.language ?? null,
          modelId,
          actualMinutes,
          creditsCharged: actualCredits,
          reservationId,
        };
      } catch (error) {
        await cancel(reservationId, error instanceof Error ? error.message : 'Unknown error');
        await captionProjectsCol()
          .doc(captionProjectId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        throw error;
      }
    }),

  // ── Persist user edits to a caption project ───────────────────────

  save: protectedProcedure
    .input(
      z.object({
        captionProjectId: z.string().uuid(),
        segments: z.array(segmentSchema).max(5000),
        title: z.string().max(200).optional(),
        style: styleSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = captionProjectsCol().doc(input.captionProjectId);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = snap.data() as { userId?: string } | undefined;
      if (data?.userId !== ctx.user.uid) throw new TRPCError({ code: 'FORBIDDEN' });

      await ref.update({
        segments: input.segments,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.style !== undefined ? { style: input.style } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const, captionProjectId: input.captionProjectId };
    }),

  // ── Pure render: segments + style → formatted string ──────────────

  render: protectedProcedure
    .input(
      z.object({
        segments: z.array(segmentSchema).min(1).max(5000),
        format: z.enum(['srt', 'vtt', 'json']).default('srt'),
        style: styleSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const rendered = renderCaptions(
        input.segments as CaptionSegment[],
        input.format as CaptionFormat,
        input.style
      );
      // Also return shaped segments so the UI can preview cue boundaries
      // without re-implementing the wrap/split logic on the client.
      const shaped = input.style
        ? shapeSegments(input.segments as CaptionSegment[], input.style)
        : (input.segments as CaptionSegment[]);
      return { format: input.format, rendered, shapedSegments: shaped };
    }),

  // ── List user's caption projects ──────────────────────────────────

  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          episodeId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      let q = captionProjectsCol().where('userId', '==', ctx.user.uid);
      if (input?.episodeId) q = q.where('episodeId', '==', input.episodeId);
      const snap = await q.orderBy('updatedAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: (data.title as string) ?? 'Untitled captions',
          status: (data.status as string) ?? 'unknown',
          sourceUrl: (data.sourceUrl as string) ?? null,
          language: (data.language as string) ?? null,
          detectedLanguage: (data.detectedLanguage as string | null) ?? null,
          episodeId: (data.episodeId as string | null) ?? null,
          segmentCount: Array.isArray(data.segments) ? (data.segments as unknown[]).length : 0,
        };
      });
    }),

  // ── Fetch a single caption project ────────────────────────────────

  get: protectedProcedure
    .input(z.object({ captionProjectId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const snap = await captionProjectsCol().doc(input.captionProjectId).get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = snap.data() as { userId?: string } & Record<string, unknown>;
      if (data.userId !== ctx.user.uid) throw new TRPCError({ code: 'FORBIDDEN' });
      return {
        id: snap.id,
        title: (data.title as string) ?? 'Untitled captions',
        status: (data.status as string) ?? 'unknown',
        sourceUrl: (data.sourceUrl as string) ?? null,
        language: (data.language as string) ?? null,
        detectedLanguage: (data.detectedLanguage as string | null) ?? null,
        episodeId: (data.episodeId as string | null) ?? null,
        segments: (data.segments as CaptionSegment[]) ?? [],
        style: (data.style as Record<string, unknown> | null) ?? null,
        failureReason: (data.failureReason as string | null) ?? null,
      };
    }),

  // ── Delete a caption project ──────────────────────────────────────

  delete: protectedProcedure
    .input(z.object({ captionProjectId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const ref = captionProjectsCol().doc(input.captionProjectId);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = snap.data() as { userId?: string } | undefined;
      if (data?.userId !== ctx.user.uid) throw new TRPCError({ code: 'FORBIDDEN' });
      await ref.delete();
      return { ok: true as const };
    }),
});
