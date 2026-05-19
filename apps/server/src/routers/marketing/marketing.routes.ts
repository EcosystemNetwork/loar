/**
 * Marketing Router — Marketing Studio surface.
 *
 * Templates over the existing generate pipeline. The hard work (model
 * routing, credit reservation, fallback, gallery publish) all happens
 * downstream in `generation.generate` — this router just resolves a
 * named ad format + product description into the right primitives and
 * delegates via `appRouter.createCaller`.
 *
 * Endpoints:
 *   listFormats   — public catalog for the studio picker
 *   resolveFormat — preview the resolved prompt + primitives without firing
 *   generate      — fire the generate call with the resolved payload
 */

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import {
  AD_FORMATS,
  getAdFormat,
  listAdFormats,
  resolveAdFormat,
} from '../../services/marketing/ad-formats';
import { geminiService, type AdDecomposition } from '../../services/gemini';

const generateInputSchema = z.object({
  formatId: z.string().min(1),
  /** What you're advertising — gets spliced into the format's scaffold. */
  product: z.string().min(3).max(500),
  /** Optional user-supplied prompt suffix appended after the scaffold. */
  promptExtra: z.string().max(500).optional(),
});

export const marketingRouter = router({
  listFormats: publicProcedure.query(() => listAdFormats()),

  /**
   * Preview the resolved prompt + primitives for a (format, product) pair.
   * Public — does not spend credits, useful for the picker to show a
   * preview tooltip without locking the user into a generation.
   */
  resolveFormat: publicProcedure.input(generateInputSchema).query(({ input }) => {
    const resolved = resolveAdFormat(input.formatId, input.product);
    if (!resolved) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown ad format '${input.formatId}'` });
    }
    const prompt = input.promptExtra
      ? `${resolved.prompt}. ${input.promptExtra.trim()}`
      : resolved.prompt;
    return { ...resolved, prompt };
  }),

  /**
   * Generate an ad clip using the chosen format. Fire-and-forget at the
   * generation layer — the underlying `generation.generate` mutation
   * blocks until the provider returns, so the response includes the
   * video URL on success.
   */
  generate: protectedProcedure.input(generateInputSchema).mutation(
    async ({
      input,
      ctx,
    }): Promise<{
      generationId: string;
      videoUrl: string | null;
      modelUsed: string | null;
      status: string;
      formatId: string;
      formatLabel: string;
      channel: string;
      goal: string;
      aspectRatio: string;
      vfxQueue: string[];
    }> => {
      const resolved = resolveAdFormat(input.formatId, input.product);
      if (!resolved) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Unknown ad format '${input.formatId}'`,
        });
      }
      const prompt = input.promptExtra
        ? `${resolved.prompt}. ${input.promptExtra.trim()}`
        : resolved.prompt;

      // Lazy import → break the index → marketingRouter → index cycle.
      // Cast through `any` to drop the recursive AppRouter type back to
      // a callable surface — same trick as services/series-arc/orchestrator.ts.
      const { appRouter } = (await import('../index')) as any;
      const caller = appRouter.createCaller({ user: ctx.user, clientIp: ctx.clientIp });

      const result = await caller.generation.generate({
        prompt,
        mode: 'text_to_video',
        durationSec: resolved.durationSec,
        resolution: '720p',
        aspectRatio: resolved.aspectRatio,
        audio: false,
        routingMode: 'auto',
        cameraPreset: resolved.cameraPreset,
        cameraIntensity: resolved.cameraIntensity,
        stylePreset: resolved.stylePreset,
        shotPresetId: resolved.shotPreset,
      });

      const format = getAdFormat(input.formatId)!;
      return {
        generationId: result.generationId,
        videoUrl: result.videoUrl ?? null,
        modelUsed: result.modelUsed ?? null,
        status: result.status,
        formatId: input.formatId,
        formatLabel: format.label,
        channel: format.channel,
        goal: format.goal,
        aspectRatio: resolved.aspectRatio,
        // VFX presets to chain after generate completes (worker is real now —
        // see services/scene-controls/vfx.ts + sceneControls.applyVfx).
        vfxQueue: resolved.vfx,
      };
    }
  ),

  // ── Ad Reference recreator ──────────────────────────────────────────
  //
  // Two-step flow:
  //   1. decomposeAd(videoUrl)        → VLM produces a structured shot recipe
  //   2. recreateAd(recipe, product)  → synthesize a prompt that swaps the
  //                                      source product for the caller's,
  //                                      then dispatch through generation.generate
  //
  // Decomposition is protected (it spends Gemini tokens on a video upload).
  // Recreate is also protected (it spends generation credits).

  decomposeAd: protectedProcedure
    .input(z.object({ videoUrl: z.string().url() }))
    .mutation(async ({ input }): Promise<AdDecomposition> => {
      try {
        return await geminiService.decomposeAdVideo(input.videoUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Ad decomposition failed',
        });
      }
    }),

  recreateAd: protectedProcedure
    .input(
      z.object({
        recipe: z.object({
          hookDescription: z.string(),
          beats: z.array(
            z.object({
              description: z.string(),
              durationEstimateSec: z.number(),
              cameraMove: z.string(),
              framing: z.string(),
            })
          ),
          styleCues: z.array(z.string()).default([]),
          palette: z.array(z.string()).default([]),
          aspectRatio: z.string(),
          pacing: z.string(),
          mood: z.string(),
          totalDurationSec: z.number(),
        }),
        product: z.string().min(3).max(500),
      })
    )
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{
        generationId: string;
        videoUrl: string | null;
        status: string;
        sourcePrompt: string;
      }> => {
        const { recipe, product } = input;

        // Synthesize a prompt that follows the source ad's structure but
        // substitutes the user's product. Beats are concatenated narratively
        // so the model treats the whole ad as a single shot story.
        const hookLine = `Hook: ${recipe.hookDescription.replace(/the product/gi, product.trim())}.`;
        const beatLines = recipe.beats
          .map(
            (b, i) =>
              `Beat ${i + 1} (${b.framing}, ${b.cameraMove}): ${b.description.replace(/the product/gi, product.trim())}.`
          )
          .join(' ');
        const styleLine =
          recipe.styleCues.length > 0 ? ` Style: ${recipe.styleCues.join(', ')}.` : '';
        const paletteLine =
          recipe.palette.length > 0 ? ` Palette: ${recipe.palette.join(', ')}.` : '';
        const moodLine = recipe.mood ? ` Overall mood: ${recipe.mood}.` : '';

        const synthesized = `Recreate this ad for "${product.trim()}". ${hookLine} ${beatLines}${styleLine}${paletteLine}${moodLine} Pacing: ${recipe.pacing}.`;

        // Normalize aspect ratio + duration to what our generate pipeline accepts.
        const allowedAspect = new Set(['16:9', '9:16', '1:1', '4:5']);
        const aspectRatio = allowedAspect.has(recipe.aspectRatio) ? recipe.aspectRatio : '9:16';
        const allowedDurations = [5, 6, 8, 10];
        const durationSec =
          allowedDurations.find((d) => d >= Math.min(10, Math.max(5, recipe.totalDurationSec))) ??
          8;

        const { appRouter } = (await import('../index')) as any;
        const caller = appRouter.createCaller({ user: ctx.user, clientIp: ctx.clientIp });

        const result = await caller.generation.generate({
          prompt: synthesized,
          mode: 'text_to_video',
          durationSec,
          resolution: '720p',
          aspectRatio,
          audio: false,
          routingMode: 'auto',
        });

        return {
          generationId: result.generationId,
          videoUrl: result.videoUrl ?? null,
          status: result.status,
          sourcePrompt: synthesized,
        };
      }
    ),
});

export { AD_FORMATS };
