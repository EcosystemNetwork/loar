/**
 * Layer 12 — byok / metering / recommendations
 *
 * Probes the surfaces shipped in the 2026-05-17 Netflix-parity + BYOK
 * landing. Like the other layers, "pass" means the procedure path is
 * registered and responding — NOT_FOUND / BAD_REQUEST / UNAUTHORIZED on
 * a probe input is the expected outcome for protected procedures.
 *
 * Routers covered:
 *   - providers.*           (listProviders / listKeys / listModels / usage)
 *   - watchSessions.*       (myRecent — protected)
 *   - recommendations.*     (continueWatching / forMe — protected + public)
 *   - captions.translate    + listSupportedLanguages + getTranslation
 *
 * No mutations that would spend credits or write to providers — read-only
 * probes only.
 */

import type { SmokeConfig } from '../config.ts';
import { tRPCQuery } from '../client.ts';
import { check, type CheckResult } from '../reporter.ts';

export interface ByokLayerResult {
  checks: CheckResult[];
}

const FAKE_CAPTION_PROJECT_ID = '00000000-0000-4000-8000-000000000000';

async function probe(
  cfg: SmokeConfig,
  procedure: string,
  input: unknown,
  token?: string,
  acceptableCodes: string[] = ['NOT_FOUND', 'UNAUTHORIZED', 'BAD_REQUEST', 'FORBIDDEN']
): Promise<string> {
  try {
    const data = await tRPCQuery(cfg, procedure, input, token);
    if (Array.isArray(data)) return `ok → [${data.length}]`;
    if (data && typeof data === 'object') {
      const keys = Object.keys(data as Record<string, unknown>)
        .slice(0, 3)
        .join(',');
      return `ok → {${keys}}`;
    }
    return `ok → ${String(data).slice(0, 20)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/No procedure found on path/.test(msg)) {
      throw new Error(`ROUTER NOT REGISTERED: ${procedure}`);
    }
    for (const code of acceptableCodes) {
      if (msg.includes(code)) return `expected:${code}`;
    }
    throw err;
  }
}

export async function runByokLayer(cfg: SmokeConfig, jwt?: string): Promise<ByokLayerResult> {
  const checks: CheckResult[] = [];

  // ── providers.* ───────────────────────────────────────────────────
  checks.push(
    await check('providers.listProviders mounted', async () =>
      probe(cfg, 'providers.listProviders', undefined, jwt)
    )
  );
  checks.push(
    await check('providers.listKeys mounted', async () =>
      probe(cfg, 'providers.listKeys', undefined, jwt)
    )
  );
  checks.push(
    await check('providers.listModels mounted', async () =>
      probe(cfg, 'providers.listModels', undefined, jwt)
    )
  );
  checks.push(
    await check('providers.usage mounted', async () =>
      probe(cfg, 'providers.usage', undefined, jwt)
    )
  );

  // ── watchSessions.* ───────────────────────────────────────────────
  checks.push(
    await check('watchSessions.myRecent mounted', async () =>
      probe(cfg, 'watchSessions.myRecent', { limit: 1 }, jwt)
    )
  );

  // ── recommendations.* ─────────────────────────────────────────────
  checks.push(
    await check('recommendations.continueWatching mounted', async () =>
      probe(cfg, 'recommendations.continueWatching', { limit: 1 }, jwt)
    )
  );
  checks.push(
    await check('recommendations.forMe mounted (public)', async () =>
      // forMe is publicProcedure — anon-callable, should return [] not 401.
      probe(cfg, 'recommendations.forMe', { limit: 1 }, undefined, ['NOT_FOUND', 'BAD_REQUEST'])
    )
  );

  // ── captions translation surface ──────────────────────────────────
  checks.push(
    await check('captions.listSupportedLanguages mounted', async () =>
      probe(cfg, 'captions.listSupportedLanguages', undefined, jwt)
    )
  );
  checks.push(
    await check('captions.getTranslation mounted', async () =>
      // NOT_FOUND expected for a synthetic project id.
      probe(
        cfg,
        'captions.getTranslation',
        { captionProjectId: FAKE_CAPTION_PROJECT_ID, targetLanguage: 'es' },
        jwt
      )
    )
  );

  return { checks };
}
