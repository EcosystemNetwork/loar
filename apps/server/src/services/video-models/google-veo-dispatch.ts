/**
 * Google-Direct Veo dispatch with same-provider tier fallback.
 *
 * The AI Studio Veo surface (generativelanguage.googleapis.com) tracks quota
 * per model id, not per project as a whole. A 429 RESOURCE_EXHAUSTED on one
 * Veo tier (e.g. `veo-3.1-generate-preview`) does not mean every tier is
 * exhausted, so on a quota/rate-limit error this walks down to the next
 * enabled Google-Direct Veo model (best quality first, then cheapest) before
 * giving up. Deliberately stays within the `google` provider — no
 * cross-provider (FAL/ByteDance/etc.) fallback — so it behaves correctly for
 * deployments that only have a Google API key configured.
 *
 * Shared by the inline dispatch path (generation.routes.ts) and the
 * queue-based worker (generation.worker.ts) so both get the same resilience.
 */
import { veoGenerate, type VeoGenerateOptions } from '../gemini';
import { VIDEO_MODELS } from './registry';
import type { VideoModelConfig, VideoGenerationMode } from './types';

const QUALITY_RANK: Record<string, number> = { draft: 1, standard: 2, premium: 3 };

// Primary attempt + up to this many same-provider fallback tiers.
const MAX_FALLBACK_TRIES = 2;

function isGoogleQuotaError(message: string | undefined): boolean {
  if (!message) return false;
  return /RESOURCE_EXHAUSTED|\b429\b/i.test(message);
}

// Local duplicate of generation.routes.ts's snapToSupportedDuration — kept
// separate rather than imported to avoid coupling this module (used by the
// worker) to the tRPC router file.
function snapToSupportedDuration(want: number | undefined, supported?: number[]): number {
  const opts = supported && supported.length ? supported : [8];
  const target = want ?? opts[opts.length - 1];
  return opts.reduce(
    (best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best),
    opts[0]
  );
}

function googleFallbackCandidates(
  primaryId: string,
  mode: VideoGenerationMode
): VideoModelConfig[] {
  return VIDEO_MODELS.filter(
    (m) => m.provider === 'google' && m.isEnabled && m.id !== primaryId && m.mode.includes(mode)
  ).sort((a, b) => {
    const qualityDiff = (QUALITY_RANK[b.qualityTier] || 0) - (QUALITY_RANK[a.qualityTier] || 0);
    if (qualityDiff !== 0) return qualityDiff;
    return a.creditCost - b.creditCost;
  });
}

export interface GoogleVeoDispatchInput {
  prompt: string;
  imageUrl?: string;
  durationSec?: number;
  resolution?: '720p' | '1080p' | '4k';
  aspectRatio?: '16:9' | '9:16';
  audio?: boolean;
  mode: VideoGenerationMode;
  signal?: AbortSignal;
}

export interface GoogleVeoDispatchResult {
  status: string;
  videoUrl?: string;
  error?: string;
  name?: string;
  /** The Google Veo model id actually used — differs from the requested one on fallback. */
  modelUsed: string;
  wasFallback: boolean;
}

export async function dispatchGoogleVeo(
  primary: VideoModelConfig,
  input: GoogleVeoDispatchInput,
  apiKey: string
): Promise<GoogleVeoDispatchResult> {
  const chain = [primary, ...googleFallbackCandidates(primary.id, input.mode)].slice(
    0,
    1 + MAX_FALLBACK_TRIES
  );

  let lastError: string | undefined;
  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];
    const isLast = i === chain.length - 1;
    try {
      const veoDuration = snapToSupportedDuration(input.durationSec, candidate.supportedDurations);
      const resolution: '720p' | '1080p' | '4k' =
        input.resolution === '4k' && candidate.supports4k
          ? '4k'
          : input.resolution === '1080p' && candidate.supports1080p
            ? '1080p'
            : '720p';
      const opts: VeoGenerateOptions = {
        apiKey,
        model: candidate.googleModelId || 'veo-3.1-generate-preview',
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        durationSec: veoDuration,
        resolution,
        aspectRatio: input.aspectRatio === '9:16' ? '9:16' : '16:9',
        withAudio: candidate.supportsAudio && input.audio,
        signal: input.signal,
      };
      const result = await veoGenerate(opts);

      if (result.status === 'completed') {
        return { ...result, modelUsed: candidate.id, wasFallback: i > 0 };
      }

      lastError = result.error;
      if (!isGoogleQuotaError(result.error) || isLast) {
        return { ...result, modelUsed: candidate.id, wasFallback: i > 0 };
      }
      console.warn(
        `[google-veo] ${candidate.id} hit quota (${(result.error ?? '').slice(0, 120)}) — trying next Google tier`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gemini Veo API error';
      lastError = message;
      if (!isGoogleQuotaError(message) || isLast) {
        return { status: 'failed', error: message, modelUsed: candidate.id, wasFallback: i > 0 };
      }
      console.warn(
        `[google-veo] ${candidate.id} hit quota (${message.slice(0, 120)}) — trying next Google tier`
      );
    }
  }

  return {
    status: 'failed',
    error: lastError ?? 'Gemini Veo API error',
    modelUsed: primary.id,
    wasFallback: false,
  };
}
