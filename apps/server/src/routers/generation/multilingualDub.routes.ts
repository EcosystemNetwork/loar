/**
 * Multilingual Dubbing Router
 *
 * Wraps ElevenLabs' Dubbing API to translate finished episodes (or any
 * audio/video URL) into other languages. Translation is async on the
 * ElevenLabs side — we create the job and poll status until ready.
 *
 * Pricing: ElevenLabs dubbing is ~$1/minute. We bill credits per minute of
 * source duration × number of target languages.
 *
 * Collection: multilingualDubs
 *
 * Procedures:
 *   create   — kick off dubbing jobs for N target languages
 *   status   — poll one job, transition to complete/failed, return audio URL
 *   list     — by user / episode
 *   get      — one job
 *   publish  — attach the dubbed video as a languageTrack on the episode
 *   delete
 */

import { router, protectedProcedure, expensiveProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { elevenLabsService } from '../../services/elevenlabs';
import { firebaseStorageService } from '../../services/firebase-storage';
import { logFailedRefund } from '../../lib/refund-audit';
import { FieldValue } from 'firebase-admin/firestore';
import { TRPCError } from '@trpc/server';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';
import { getPlatformConfig } from '../../services/platformConfig';
import { withReservation } from '../../services/credits';

// ── Pricing ──────────────────────────────────────────────────────────

const LOAR_TO_USD = 0.01;
const DUBBING_USD_PER_MINUTE = 1.0;

async function getMargins() {
  const cfg = await getPlatformConfig();
  return { fiatMargin: cfg.fiatMargin, loarMargin: cfg.loarMargin };
}
function withFiat(usd: number, m: number) {
  return Math.round(usd * m * 100) / 100;
}
function toCredits(usd: number, m: number) {
  return Math.ceil(withFiat(usd, m) / LOAR_TO_USD);
}

// ── Collections ──────────────────────────────────────────────────────

const multilingualDubsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('multilingualDubs');
};

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

// ── Supported target languages (ElevenLabs supports more — this is the v1 list) ─

const SUPPORTED_LANGS = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'pl',
  'tr',
  'ru',
  'nl',
  'cs',
  'ar',
  'zh',
  'ja',
  'ko',
  'hi',
  'sv',
  'da',
  'fi',
  'no',
  'id',
  'ms',
  'ro',
  'sk',
  'el',
  'he',
  'th',
  'uk',
  'vi',
  'bg',
  'hr',
] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

// ── Credit helpers ───────────────────────────────────────────────────
//
// NOTE: `create` uses `withReservation` per target language (one reservation
// per ElevenLabs dub call). The polling `status` endpoint handles
// async-resolved provider failures that surface AFTER the reservation was
// reconciled, so it still needs a direct post-reconcile refund — implemented
// below with a raw `FieldValue.increment`. This is the same async-failure
// pattern flagged in `feedback_no_cutting_corners.md`.

async function refundCreditsAfterReconcile(
  userId: string,
  credits: number,
  jobId?: string
): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error(`multilingualDub refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'multilingualDub',
      generationId: jobId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

// ── Router ───────────────────────────────────────────────────────────

export const multilingualDubRouter = router({
  /**
   * Create dubbing jobs for one or more target languages. ElevenLabs runs
   * each language as a separate dub — we persist one doc per (source × lang).
   */
  create: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        sourceVideoUrl: z.string().url(),
        sourceLang: z.enum(SUPPORTED_LANGS).optional(),
        targetLangs: z.array(z.enum(SUPPORTED_LANGS)).min(1).max(20),
        durationSec: z
          .number()
          .min(1)
          .max(60 * 60 * 4), // up to 4h
        numSpeakers: z.number().min(1).max(20).optional(),
        episodeId: z.string().optional(),
        universeId: z.string().optional(),
        highestResolution: z.boolean().default(true),
        name: z.string().max(120).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        assertSafeExternalUrl(input.sourceVideoUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'sourceVideoUrl rejected',
        });
      }
      // De-dupe target langs (and drop source-lang if accidentally included).
      const targets = [...new Set(input.targetLangs)].filter((l) => l !== input.sourceLang);
      if (targets.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No valid target languages after de-duping with source.',
        });
      }

      const { fiatMargin } = await getMargins();
      const durationMin = input.durationSec / 60;
      const perLangCredits = Math.max(
        2,
        toCredits(DUBBING_USD_PER_MINUTE * durationMin, fiatMargin)
      );

      const { resolveProviderKey } = await import('../../lib/byok');
      const apiKey = await resolveProviderKey(ctx.user.uid, 'elevenlabs');

      const created: Array<{
        id: string;
        targetLang: SupportedLang;
        elevenLabsDubbingId: string;
      }> = [];

      const failures: Array<{ targetLang: SupportedLang; error: string }> = [];

      // One reservation per target language so a failure on lang A doesn't
      // strand credits charged for lang B. `withReservation` debits up front,
      // reconciles on success of the dub-job-creation call, or fully refunds
      // when the call throws.
      for (const lang of targets) {
        const id = randomUUID();
        try {
          await withReservation(
            {
              userId: ctx.user.uid,
              modelId: 'elevenlabs-dubbing',
              provider: 'elevenlabs',
              estimatedCredits: perLangCredits,
              byok: false,
              meta: {
                generationId: id,
                episodeId: input.episodeId ?? null,
                targetLang: lang,
              },
            },
            async () => {
              const res = await elevenLabsService.dubbing({
                sourceUrl: input.sourceVideoUrl,
                sourceLang: input.sourceLang,
                targetLang: lang,
                name: input.name ?? `LOAR dub → ${lang}`,
                numSpeakers: input.numSpeakers,
                highestResolution: input.highestResolution,
                apiKey,
              });

              await multilingualDubsCol()
                .doc(id)
                .set({
                  id,
                  userId: ctx.user.uid,
                  episodeId: input.episodeId ?? null,
                  universeId: input.universeId ?? null,
                  sourceVideoUrl: input.sourceVideoUrl,
                  sourceLang: input.sourceLang ?? null,
                  targetLang: lang,
                  elevenLabsDubbingId: res.dubbingId,
                  durationSec: input.durationSec,
                  status: 'dubbing',
                  creditsCharged: perLangCredits,
                  outputVideoUrl: null,
                  outputAudioUrl: null,
                  publishedToEpisode: false,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });

              created.push({ id, targetLang: lang, elevenLabsDubbingId: res.dubbingId });
              return { result: undefined };
            }
          );
        } catch (err) {
          failures.push({
            targetLang: lang,
            error: err instanceof Error ? err.message : 'Unknown',
          });
        }
      }

      return { jobs: created, failures, creditsCharged: perLangCredits * created.length };
    }),

  /**
   * Poll a single job. Promotes status `dubbing → dubbed` (then fetches the
   * output) or `dubbing → failed` (then refunds credits).
   */
  status: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = multilingualDubsCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      const data = snap.data() as Record<string, unknown>;
      if (data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your dubbing job' });
      }

      // Already terminal — return as-is.
      if (data.status === 'complete' || data.status === 'failed') {
        return data;
      }

      const { resolveProviderKey } = await import('../../lib/byok');
      const apiKey = await resolveProviderKey(ctx.user.uid, 'elevenlabs');
      const dubbingId = data.elevenLabsDubbingId as string;
      const targetLang = data.targetLang as string;

      const status = await elevenLabsService.getDubbingStatus(dubbingId, apiKey);

      if (status.status === 'dubbing') {
        await ref.update({ status: 'dubbing', updatedAt: new Date() });
        return { ...data, status: 'dubbing' };
      }

      if (status.status === 'failed') {
        await ref.update({
          status: 'failed',
          failureReason: status.error ?? 'ElevenLabs reported failure',
          updatedAt: new Date(),
        });
        // Refund — provider work didn't complete.
        await refundCreditsAfterReconcile(
          ctx.user.uid,
          (data.creditsCharged as number) ?? 0,
          input.id
        );
        return { ...data, status: 'failed', failureReason: status.error };
      }

      // status === 'dubbed' → fetch the output and persist.
      try {
        const video = await elevenLabsService
          .getDubbingVideo(dubbingId, targetLang, apiKey)
          .catch(() => null);
        let outputVideoUrl: string | null = null;
        let outputAudioUrl: string | null = null;

        if (video) {
          const key = await firebaseStorageService.upload(
            video.buffer,
            `dubs/${ctx.user.uid}/${input.id}.mp4`
          );
          outputVideoUrl = firebaseStorageService.getPublicUrl(key);
        } else {
          const audio = await elevenLabsService.getDubbingAudio(dubbingId, targetLang, apiKey);
          const key = await firebaseStorageService.upload(
            audio.buffer,
            `dubs/${ctx.user.uid}/${input.id}.mp3`
          );
          outputAudioUrl = firebaseStorageService.getPublicUrl(key);
        }

        await ref.update({
          status: 'complete',
          outputVideoUrl,
          outputAudioUrl,
          updatedAt: new Date(),
        });

        return { ...data, status: 'complete', outputVideoUrl, outputAudioUrl };
      } catch (err) {
        await ref.update({
          status: 'failed',
          failureReason: err instanceof Error ? err.message : 'Output fetch failed',
          updatedAt: new Date(),
        });
        await refundCreditsAfterReconcile(
          ctx.user.uid,
          (data.creditsCharged as number) ?? 0,
          input.id
        );
        throw err;
      }
    }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const snap = await multilingualDubsCol().doc(input.id).get();
    if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
    const data = snap.data() as Record<string, unknown>;
    if (data.userId !== ctx.user.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your job' });
    }
    return data;
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          episodeId: z.string().optional(),
          limit: z.number().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const params = input ?? { limit: 50 };
      let q = multilingualDubsCol().where('userId', '==', ctx.user.uid) as FirebaseFirestore.Query;
      if (params.episodeId) q = q.where('episodeId', '==', params.episodeId);
      const snap = await q
        .orderBy('createdAt', 'desc')
        .limit(params.limit ?? 50)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /**
   * Attach a completed dub as a languageTrack on its episode.
   * Idempotent: re-publishing the same job updates in place.
   */
  publish: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = multilingualDubsCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      const data = snap.data() as Record<string, unknown>;
      if (data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your job' });
      }
      if (data.status !== 'complete') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Job not complete' });
      }
      const episodeId = data.episodeId as string | null;
      if (!episodeId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Job is not bound to an episode' });
      }

      const epRef = db.collection('episodes').doc(episodeId);
      const epSnap = await epRef.get();
      if (!epSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Episode not found' });
      }
      const ep = epSnap.data() as Record<string, unknown>;
      const existing = (ep.languageTracks as Array<Record<string, unknown>> | undefined) ?? [];
      const lang = data.targetLang as string;
      const next = existing.filter((t) => t.lang !== lang);
      next.push({
        lang,
        videoUrl: data.outputVideoUrl ?? null,
        audioUrl: data.outputAudioUrl ?? null,
        dubbingJobId: input.id,
        elevenLabsDubbingId: data.elevenLabsDubbingId,
        addedAt: new Date(),
      });

      await epRef.update({ languageTracks: next, updatedAt: new Date() });
      await ref.update({ publishedToEpisode: true, updatedAt: new Date() });

      return { ok: true, languageTracks: next };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = multilingualDubsCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      const data = snap.data() as Record<string, unknown>;
      if (data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your job' });
      }
      await ref.delete();
      return { ok: true };
    }),

  supportedLanguages: protectedProcedure.query(() => ({
    languages: SUPPORTED_LANGS,
  })),

  estimateCost: protectedProcedure
    .input(z.object({ durationSec: z.number().min(1), targetLangs: z.number().min(1).max(20) }))
    .query(async ({ input }) => {
      const { fiatMargin } = await getMargins();
      const perLang = Math.max(
        2,
        toCredits(DUBBING_USD_PER_MINUTE * (input.durationSec / 60), fiatMargin)
      );
      return {
        perLanguageCredits: perLang,
        totalCredits: perLang * input.targetLangs,
      };
    }),
});
