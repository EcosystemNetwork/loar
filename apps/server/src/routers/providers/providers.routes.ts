/**
 * Providers Router — BYOK key management + model catalog discovery.
 *
 * Endpoints:
 *   providers.listProviders   — Static list of supported providers + docs URL.
 *   providers.listKeys        — User's keys (fingerprint + status only, no plaintext).
 *   providers.upsertKey       — Add or replace a key. Server tests the key against
 *                               the provider before persisting; bad keys never hit disk.
 *   providers.setKeyEnabled   — Toggle a stored key on/off without deleting.
 *   providers.deleteKey       — Remove a stored key.
 *   providers.listModels      — Transcription model catalog with `usableByMe` flag
 *                               that accounts for the user's BYOK keys + server pool.
 *   providers.usage           — Recent BYOK-vs-server-pool stats for this user.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../../lib/trpc';
import {
  KNOWN_PROVIDERS,
  PROVIDER_REGISTRY,
  isKnownProvider,
  listForUser,
  upsert,
  setEnabled,
  remove,
  serverPoolAvailable,
} from '../../services/provider-keys';
import { TRANSCRIPTION_MODELS, getVisibleModels } from '../../services/transcription-models';
import { db } from '../../lib/firebase';
import { getControls, getPerCallCeilings } from '../../services/cost-tracker';
import { VIDEO_MODELS } from '../../services/video-models';
import { IMAGE_MODELS } from '../../services/image-models';
import { AUDIO_MODELS } from '../../services/audio-models';
import { TTS_MODELS } from '../../services/tts-models';
import { LLM_MODELS } from '../../services/llm-models';
import { THREED_MODELS } from '../../services/threed-models';

const providerIdSchema = z.enum(KNOWN_PROVIDERS as [string, ...string[]]);

export const providersRouter = router({
  // ── Static provider catalog ───────────────────────────────────────

  listProviders: protectedProcedure.query(() => {
    return KNOWN_PROVIDERS.map((id) => ({
      id,
      displayName: PROVIDER_REGISTRY[id].displayName,
      apiKeyDocsUrl: PROVIDER_REGISTRY[id].apiKeyDocsUrl,
      serverPoolAvailable: serverPoolAvailable(id),
    }));
  }),

  // ── User key management ───────────────────────────────────────────

  listKeys: protectedProcedure.query(async ({ ctx }) => {
    return listForUser(ctx.user.uid);
  }),

  upsertKey: protectedProcedure
    .input(
      z.object({
        provider: providerIdSchema,
        apiKey: z.string().min(10).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await upsert(ctx.user.uid, input.provider, input.apiKey);
      } catch (err) {
        // Never echo the key — only the provider message.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Key upsert failed',
        });
      }
    }),

  setKeyEnabled: protectedProcedure
    .input(
      z.object({
        provider: providerIdSchema,
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!isKnownProvider(input.provider)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown provider' });
      }
      await setEnabled(ctx.user.uid, input.provider, input.enabled);
      return { ok: true as const };
    }),

  deleteKey: protectedProcedure
    .input(z.object({ provider: providerIdSchema }))
    .mutation(async ({ input, ctx }) => {
      if (!isKnownProvider(input.provider)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown provider' });
      }
      await remove(ctx.user.uid, input.provider);
      return { ok: true as const };
    }),

  // ── Transcription model catalog (capability-aware) ────────────────

  listModels: protectedProcedure.query(async ({ ctx }) => {
    // Which providers does this user have a (enabled) key for?
    const userKeys = await listForUser(ctx.user.uid);
    const byokProviders = new Set(userKeys.filter((k) => k.enabled).map((k) => k.provider));
    return getVisibleModels().map((m) => {
      const hasByok = byokProviders.has(m.provider as any);
      const hasServer = m.serverPoolAvailable && serverPoolAvailable(m.provider as any);
      return {
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        shortDescription: m.shortDescription,
        capabilities: {
          wordTimings: m.supportsWordTimings,
          diarize: m.supportsDiarize,
          translate: m.supportsTranslate,
        },
        qualityTier: m.qualityTier,
        speedTier: m.speedTier,
        priceTier: m.priceTier,
        creditCostPerMinute: m.creditCostPerMinute,
        maxAudioMinutes: m.maxAudioMinutes,
        tags: m.tags,
        bestFor: m.bestFor,
        /** True when the user can dispatch to this model right now. */
        usableByMe: hasByok || hasServer,
        /** Why it's unusable — surface to the UI for the disabled tooltip. */
        unusableReason:
          hasByok || hasServer
            ? null
            : `Add a ${PROVIDER_REGISTRY[m.provider as keyof typeof PROVIDER_REGISTRY]?.displayName ?? m.provider} API key in Settings to enable this model.`,
        sourceOnDispatch: hasByok ? ('byok' as const) : hasServer ? ('server' as const) : null,
      };
    });
  }),

  // ── Usage summary (last 30 days, BYOK split) ──────────────────────

  usage: protectedProcedure.query(async ({ ctx }) => {
    if (!db) return { totalCredits: 0, byokCredits: 0, byProvider: [], windowDays: 30 };
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const snap = await db
      .collection('creditReservations')
      .where('userId', '==', ctx.user.uid)
      .where('createdAt', '>=', since)
      .get();
    const rows = snap.docs.map((d) => d.data() as Record<string, unknown>);
    const byProviderMap = new Map<
      string,
      { totalCredits: number; calls: number; byokCalls: number }
    >();
    let totalCredits = 0;
    let byokCredits = 0;
    for (const r of rows) {
      const provider = (r.provider as string) ?? 'unknown';
      const actual = (r.actualCredits as number) ?? (r.reservedCredits as number) ?? 0;
      const byok = !!r.byok;
      totalCredits += actual;
      if (byok) byokCredits += actual;
      const cur = byProviderMap.get(provider) ?? { totalCredits: 0, calls: 0, byokCalls: 0 };
      cur.totalCredits += actual;
      cur.calls += 1;
      if (byok) cur.byokCalls += 1;
      byProviderMap.set(provider, cur);
    }
    return {
      totalCredits,
      byokCredits,
      windowDays: 30,
      byProvider: Array.from(byProviderMap.entries()).map(([provider, stats]) => ({
        provider,
        ...stats,
      })),
    };
  }),

  // ── Health probe ─────────────────────────────────────────────────
  // Single ops endpoint that surfaces registry counts, server-pool key
  // availability per provider, current admin kill-switch state, and the
  // per-call cost ceilings. Used by monitoring + readiness checks so ops
  // can confirm "model matrix is healthy" without scraping logs.

  health: protectedProcedure.query(async () => {
    const controls = await getControls();
    const ceilings = getPerCallCeilings();
    return {
      registries: {
        video: VIDEO_MODELS.length,
        image: IMAGE_MODELS.length,
        audio: AUDIO_MODELS.length,
        transcription: TRANSCRIPTION_MODELS.length,
        tts: TTS_MODELS.length,
        llm: LLM_MODELS.length,
        threed: THREED_MODELS.length,
      },
      providers: KNOWN_PROVIDERS.map((id) => ({
        id,
        serverPoolAvailable: serverPoolAvailable(id),
        paused: controls.pausedProviders.includes(id),
      })),
      controls: {
        pausedProviders: controls.pausedProviders,
        platformDailyCapUsd: controls.caps.platformDailyUsd,
      },
      perCallCeilingsUsd: ceilings,
      ts: new Date().toISOString(),
    };
  }),
});
