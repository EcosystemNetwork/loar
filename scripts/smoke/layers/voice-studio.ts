/**
 * Layer 11 — voice-studio
 *
 * Verifies the Voice Studio surface (voiceLibrary, dubbing, multilingualDub
 * routers + voice.cloneVoice extensions) is registered and responding. Mirrors
 * the editing-layer probe pattern: a check passes if the procedure path exists
 * regardless of the data shape (NOT_FOUND / UNAUTHORIZED / BAD_REQUEST are
 * expected outcomes for probe inputs).
 *
 * Mutations that would burn ElevenLabs credits (preview, generateLine,
 * multilingualDub.create) are gated behind ELEVENLABS_API_KEY + an explicit
 * SMOKE_VOICE_DEEP=1 flag — otherwise this layer stays on the cheap read path.
 */

import type { SmokeConfig } from '../config.ts';
import { tRPCQuery, tRPCMutate } from '../client.ts';
import { check, skipped, type CheckResult } from '../reporter.ts';

export interface VoiceStudioResult {
  checks: CheckResult[];
}

const FAKE_VOICE_LIBRARY_ID = 'smoke-probe-voice';
const FAKE_USER_VOICE_ID = 'smoke-probe-user-voice';
const FAKE_DUBBING_JOB_ID = 'smoke-probe-dubbing-job';
const FAKE_DUB_ID = 'smoke-probe-dub';

async function probeQuery(
  cfg: SmokeConfig,
  procedure: string,
  input: unknown,
  token?: string,
  acceptableCodes: string[] = ['NOT_FOUND', 'UNAUTHORIZED', 'BAD_REQUEST']
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
    if (/FAILED_PRECONDITION.*requires an index/.test(msg)) return 'known-index-needed';
    for (const code of acceptableCodes) {
      if (msg.includes(code)) return `expected:${code}`;
    }
    if (acceptableCodes.includes('NOT_FOUND') && /not found/i.test(msg)) {
      return 'expected:NOT_FOUND';
    }
    throw err;
  }
}

async function probeMutate(
  cfg: SmokeConfig,
  procedure: string,
  input: unknown,
  token?: string,
  acceptableCodes: string[] = ['NOT_FOUND', 'UNAUTHORIZED', 'BAD_REQUEST', 'FORBIDDEN']
): Promise<string> {
  try {
    const data = await tRPCMutate(cfg, procedure, input, token);
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
    if (acceptableCodes.includes('NOT_FOUND') && /not found/i.test(msg)) {
      return 'expected:NOT_FOUND';
    }
    throw err;
  }
}

export async function runVoiceStudioLayer(
  cfg: SmokeConfig,
  token: string
): Promise<VoiceStudioResult> {
  const results: CheckResult[] = [];

  // ── voiceLibrary (public list + user-scoped reads) ─────────────────
  results.push(
    await check('voiceLibrary.list — public catalog reachable', async () =>
      probeQuery(cfg, 'voiceLibrary.list', { limit: 5 })
    )
  );

  results.push(
    await check('voiceLibrary.get — fake id → NOT_FOUND', async () =>
      probeQuery(cfg, 'voiceLibrary.get', { id: FAKE_VOICE_LIBRARY_ID })
    )
  );

  results.push(
    await check('voiceLibrary.myVoices — returns user list', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeQuery(cfg, 'voiceLibrary.myVoices', {}, token);
    })
  );

  results.push(
    await check('voiceLibrary.deleteMyVoice — fake id → NOT_FOUND', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeMutate(cfg, 'voiceLibrary.deleteMyVoice', { id: FAKE_USER_VOICE_ID }, token);
    })
  );

  // ── dubbing (script-first episode dubbing) ─────────────────────────
  results.push(
    await check('dubbing.list — returns user list', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeQuery(cfg, 'dubbing.list', { limit: 5 }, token);
    })
  );

  results.push(
    await check('dubbing.get — fake id → NOT_FOUND', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeQuery(cfg, 'dubbing.get', { jobId: FAKE_DUBBING_JOB_ID }, token);
    })
  );

  results.push(
    await check('dubbing.composite — fake id → NOT_FOUND', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeMutate(
        cfg,
        'dubbing.composite',
        { jobId: FAKE_DUBBING_JOB_ID, mode: 'mux' },
        token
      );
    })
  );

  // ── multilingualDub (ElevenLabs Dubbing API wrapper) ───────────────
  results.push(
    await check('multilingualDub.supportedLanguages — returns lang list', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeQuery(cfg, 'multilingualDub.supportedLanguages', null, token);
    })
  );

  results.push(
    await check('multilingualDub.list — returns user list', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeQuery(cfg, 'multilingualDub.list', { limit: 5 }, token);
    })
  );

  results.push(
    await check('multilingualDub.estimateCost — computes credits', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      const data = await tRPCQuery<{ totalCredits: number; perLanguageCredits: number }>(
        cfg,
        'multilingualDub.estimateCost',
        { durationSec: 60, targetLangs: 2 },
        token
      );
      if (typeof data?.totalCredits !== 'number' || data.totalCredits <= 0) {
        throw new Error('estimateCost returned no credits — pricing config missing?');
      }
      return `${data.totalCredits} credits (60s × 2 langs)`;
    })
  );

  results.push(
    await check('multilingualDub.get — fake id → NOT_FOUND', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      return probeQuery(cfg, 'multilingualDub.get', { id: FAKE_DUB_ID }, token);
    })
  );

  // ── Deep path (only with ELEVENLABS_API_KEY + opt-in) ──────────────
  if (process.env.SMOKE_VOICE_DEEP === '1' && process.env.ELEVENLABS_API_KEY) {
    results.push(
      await check('voiceLibrary.preview — round-trip TTS', async () => {
        if (!token) throw new Error('no JWT — auth layer failed');
        // Use the first curated voice — bail if the library has not been seeded.
        const list = await tRPCQuery<Array<{ id: string; voiceId?: string }>>(
          cfg,
          'voiceLibrary.list',
          { limit: 1 }
        );
        if (!list?.length || !list[0]?.voiceId) {
          return 'skipped — voice library not seeded yet (run pnpm seed:voices)';
        }
        const res = await tRPCMutate<{ url: string }>(
          cfg,
          'voiceLibrary.preview',
          { voiceId: list[0].voiceId, text: 'Voice studio smoke check.' },
          token
        );
        if (!res?.url?.startsWith('http')) {
          throw new Error('preview returned no audio URL');
        }
        return `audio at ${res.url.slice(0, 64)}…`;
      })
    );
  } else {
    results.push(
      skipped(
        'voiceLibrary.preview (deep)',
        'set SMOKE_VOICE_DEEP=1 + ELEVENLABS_API_KEY to enable a real TTS round-trip'
      )
    );
  }

  return { checks: results };
}
