/**
 * Anonymous Preview Generation — `POST /api/preview/generate`
 *
 * Public, wallet-less, one-shot video generation. Funnel-top experience so
 * a first-time visitor can "see what this thing does" before connecting a
 * wallet. Once they have a result, the response includes a hint to sign in
 * to save / canonize / mint.
 *
 * Hard constraints (anti-abuse / cost ceiling):
 *   • 3 generations per IP per 24h (configurable via PREVIEW_MAX_PER_DAY)
 *   • Locked to ltx-video at 5s / 512p / text-to-video — cheapest path
 *     (~$0.02 per call). Higher models / longer durations require auth.
 *   • Pays from the platform FAL_KEY (no BYOK, no credit reservation,
 *     no Firestore record, no gallery publish). The cost is platform CAC.
 *   • Prompt is sanitized and length-capped.
 *
 * The endpoint deliberately does NOT persist anything to Firestore —
 * keeping the anonymous flow truly anonymous and removing any storage
 * cost / GDPR surface for visitors who never convert.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { falService } from '../services/fal';
import { consumeRateLimit } from '../middleware/rate-limit';
import { sanitizePrompt } from '../lib/prompt-sanitize';

const previewRouter = new Hono();

const inputSchema = z.object({
  prompt: z.string().min(3).max(500),
});

/** Limits — overridable via env to tune cost ceiling without redeploy. */
const PREVIEW_MAX_PER_DAY = Number(process.env.PREVIEW_MAX_PER_DAY ?? '3');
const PREVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

previewRouter.post('/generate', async (c) => {
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0';

  const limit = await consumeRateLimit(`preview:${ip}`, PREVIEW_WINDOW_MS, PREVIEW_MAX_PER_DAY);
  if (limit.blocked) {
    return c.json(
      {
        error: 'PREVIEW_QUOTA_EXHAUSTED',
        message: `Anonymous previews are limited to ${PREVIEW_MAX_PER_DAY} per day. Connect a wallet to keep creating.`,
        signInHint: true,
      },
      429
    );
  }

  let body: z.infer<typeof inputSchema>;
  try {
    body = inputSchema.parse(await c.req.json());
  } catch (err) {
    return c.json(
      {
        error: 'INVALID_INPUT',
        message: err instanceof Error ? err.message : 'prompt is required (3-500 chars)',
      },
      400
    );
  }

  const cleanPrompt = sanitizePrompt(body.prompt);
  if (cleanPrompt.length < 3) {
    return c.json({ error: 'INVALID_INPUT', message: 'Prompt was rejected by safety filter' }, 400);
  }

  try {
    const result = await falService.generateVideo({
      prompt: cleanPrompt,
      model: 'fal-ai/ltx-video',
      // apiKey omitted → uses platform FAL_KEY
    });

    if (!result.videoUrl) {
      return c.json(
        {
          error: 'GENERATION_FAILED',
          message: result.error || 'Provider returned no video — try a different prompt',
          previewsRemaining: limit.remaining,
        },
        502
      );
    }

    return c.json({
      videoUrl: result.videoUrl,
      previewsRemaining: limit.remaining,
      signInHint:
        'Connect a wallet to save this clip, canonize it into a universe, or mint it as an episode NFT.',
    });
  } catch (err) {
    return c.json(
      {
        error: 'GENERATION_FAILED',
        message: err instanceof Error ? err.message : 'Generation crashed',
        previewsRemaining: limit.remaining,
      },
      502
    );
  }
});

export default previewRouter;
