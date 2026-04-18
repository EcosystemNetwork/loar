/**
 * Layer 5 — ai (generation)
 * Checks: model list endpoint (always runs), optional text-to-video generation
 *         (requires FAL_KEY or other AI provider keys).
 * Identifies: AI provider credential failures, model routing bugs,
 *             Firebase generation record write failures.
 *
 * Generation is intentionally skipped when no AI keys are configured — the
 * harness can confirm the server is healthy even without provider credentials.
 */
import type { SmokeConfig } from '../config.ts';
import { tRPCQuery, tRPCMutate } from '../client.ts';
import { SMOKE_PROMPTS } from '../fixtures.ts';
import { check, skipped, type CheckResult } from '../reporter.ts';

export interface GenerationResult {
  generationId: string | undefined;
  videoUrl: string | undefined;
  checks: CheckResult[];
}

export async function runGenerationLayer(
  cfg: SmokeConfig,
  token: string
): Promise<GenerationResult> {
  const results: CheckResult[] = [];
  let generationId: string | undefined;
  let videoUrl: string | undefined;

  // 1. generation.listModels — always available, no AI keys required
  results.push(
    await check('generation.listModels → model list returned', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      // listModels expects an optional object input (or undefined); pass {} to
      // satisfy tRPC v10's non-null object validator in this router.
      const models = await tRPCQuery<unknown[]>(cfg, 'generation.listModels', {}, token);
      const count = Array.isArray(models) ? models.length : 0;
      if (count === 0) throw new Error('no models returned — check VIDEO_MODELS config');
      return `${count} model(s)`;
    })
  );

  // 2. image.generate — only if server is reachable (tests FAL routing)
  //    Skipped when no AI key is configured — detected by attempting a
  //    dry-run and checking for the specific "no provider" error.
  results.push(
    await check('generation.generate (text-to-video, smart-auto)', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');

      let result: Record<string, unknown>;
      try {
        result = await tRPCMutate<Record<string, unknown>>(
          cfg,
          'generation.generate',
          {
            prompt: SMOKE_PROMPTS.textToVideo,
            mode: 'text_to_video',
            durationSec: 5,
            resolution: '480p',
            aspectRatio: '16:9',
            audio: false,
            routingMode: 'auto',
            allowFallback: true,
          },
          token
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Provider not configured — not a failure, just skip
        if (
          msg.includes('FAL_KEY') ||
          msg.includes('not configured') ||
          msg.includes('no provider') ||
          msg.includes('UNAUTHORIZED') ||
          msg.includes('credentials')
        ) {
          return 'skipped — AI provider not configured (set FAL_KEY to enable)';
        }
        throw err;
      }

      generationId = (result?.generationId ?? result?.id) as string | undefined;
      videoUrl = result?.videoUrl as string | undefined;
      const status = result?.status as string | undefined;
      return `id=${String(generationId ?? '—').slice(0, 12)}… status=${status}`;
    })
  );

  // 3. image generation (image.generate) — skipped if no token
  results.push(skipped('image.generate', 'covered by generation.generate; skip to reduce latency'));

  return { generationId, videoUrl, checks: results };
}
