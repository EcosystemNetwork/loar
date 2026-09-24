/**
 * Lip-Sync Service
 *
 * Calls FAL.ai's lip-sync models to synchronize video with audio.
 * Supports `fal-ai/lipsync` (primary) and `fal-ai/sadtalker` (fallback).
 *
 * Provider health is tracked so the router can fall back gracefully.
 */
import * as fal from '@fal-ai/serverless-client';

// ── Types ────────────────────────────────────────────────────────────

export interface LipSyncOptions {
  videoUrl: string;
  audioUrl: string;
  model?: 'fal-ai/lipsync' | 'fal-ai/sadtalker';
  /** The caller's own fal.ai key (BYOK). Required — there is no platform fallback. */
  apiKey?: string;
}

export interface LipSyncResult {
  status: 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

// ── Provider health tracking ─────────────────────────────────────────

interface ProviderHealth {
  healthy: boolean;
  lastFailure: number;
  consecutiveFailures: number;
}

const HEALTH_RECOVERY_MS = 5 * 60 * 1000; // 5 minutes

// ── Service ──────────────────────────────────────────────────────────

class LipSyncService {
  private providerHealth: Record<string, ProviderHealth> = {};

  /**
   * The FAL client only has a global `fal.config({ credentials })`, so we set it
   * before each call (same tradeoff as `FalService.configureCall`). No `FAL_KEY`
   * env fallback — callers must route through `resolveProviderKey(uid, 'fal')`.
   */
  private configureCall(apiKey?: string): void {
    const key = apiKey?.trim();
    if (!key) {
      throw new Error(
        'No fal.ai API key available — add one at /settings/api-keys to use lip-sync.'
      );
    }
    fal.config({ credentials: key });
  }

  private getHealth(provider: string): ProviderHealth {
    if (!this.providerHealth[provider]) {
      this.providerHealth[provider] = {
        healthy: true,
        lastFailure: 0,
        consecutiveFailures: 0,
      };
    }
    // Auto-recover after cooldown
    const health = this.providerHealth[provider];
    if (!health.healthy && Date.now() - health.lastFailure > HEALTH_RECOVERY_MS) {
      health.healthy = true;
      health.consecutiveFailures = 0;
    }
    return health;
  }

  private markHealthy(provider: string): void {
    const health = this.getHealth(provider);
    health.healthy = true;
    health.consecutiveFailures = 0;
  }

  private markUnhealthy(provider: string): void {
    const health = this.getHealth(provider);
    health.consecutiveFailures += 1;
    health.lastFailure = Date.now();
    if (health.consecutiveFailures >= 3) {
      health.healthy = false;
    }
  }

  isProviderHealthy(provider: string): boolean {
    return this.getHealth(provider).healthy;
  }

  async sync(options: LipSyncOptions): Promise<LipSyncResult> {
    this.configureCall(options.apiKey);

    const primaryModel = options.model || 'fal-ai/lipsync';
    const fallbackModel: 'fal-ai/lipsync' | 'fal-ai/sadtalker' =
      primaryModel === 'fal-ai/lipsync' ? 'fal-ai/sadtalker' : 'fal-ai/lipsync';

    // Try primary, then fallback
    const modelsToTry = this.isProviderHealthy(primaryModel)
      ? [primaryModel, fallbackModel]
      : [fallbackModel, primaryModel];

    let lastError: string | undefined;

    for (const model of modelsToTry) {
      try {
        const result = await this.callModel(model, options);
        if (result.status === 'completed') {
          this.markHealthy(model);
          return result;
        }
        lastError = result.error;
        this.markUnhealthy(model);
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Unknown error';
        this.markUnhealthy(model);
      }
    }

    return {
      status: 'failed',
      error: lastError || 'All lip-sync providers failed',
    };
  }

  private async callModel(model: string, options: LipSyncOptions): Promise<LipSyncResult> {
    try {
      const input: Record<string, unknown> = {
        video_url: options.videoUrl,
        audio_url: options.audioUrl,
      };

      const result = await fal.subscribe(model, {
        input,
        logs: true,
      });

      const resultAny = result as any;
      const data = resultAny.data || resultAny;

      // Extract video URL from various response shapes
      let videoUrl: string | undefined;
      if (data.video?.url) {
        videoUrl = data.video.url;
      } else if (data.video_url) {
        videoUrl = data.video_url;
      } else if (data.url) {
        videoUrl = data.url;
      } else if (typeof data.video === 'string') {
        videoUrl = data.video;
      }

      if (!videoUrl) {
        return {
          status: 'failed',
          error: `No video URL in response. Keys: ${Object.keys(data).join(', ')}`,
        };
      }

      return {
        status: 'completed',
        videoUrl,
      };
    } catch (error) {
      console.error(`Lip-sync failed [${model}]:`, error);
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Lip-sync generation failed',
      };
    }
  }
}

export const lipSyncService = new LipSyncService();
