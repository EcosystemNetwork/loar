/**
 * Layer — model-matrix
 *
 * Verifies the model-matrix aggregator is consistent end-to-end:
 *
 *   1. Every registry loads + exposes the required helpers + non-empty rows.
 *   2. Every row's pricing math is internally consistent (fiat ≥ provider,
 *      loar ≥ provider, credits > 0 unless explicitly free).
 *   3. Every distinct `provider` in a registry has a known BYOK entry in
 *      `provider-keys/registry`.
 *   4. Each dispatcher (TTS / LLM / 3D) imports cleanly and rejects unknown
 *      model ids with the expected error.
 *   5. Each in-router branch's required adapter is importable.
 *
 * This is a *static integrity* smoke — no live provider calls. To exercise
 * a live provider, set the matching env var and call its dispatcher directly
 * (see `model-matrix.live.ts` (TODO) for that variant).
 */
import { check, type CheckResult } from '../reporter.ts';

export interface ModelMatrixLayerResult {
  checks: CheckResult[];
}

/** Resolve from `scripts/smoke/layers/` up to repo root, then into apps/server/src. */
const SERVER = '../../../apps/server/src';

interface RegistrySpec {
  module: string;
  rowsExport: string;
  /** Optional helper exports we expect to find. */
  helperExports?: string[];
}

const REGISTRIES: RegistrySpec[] = [
  {
    module: `${SERVER}/services/video-models/registry`,
    rowsExport: 'VIDEO_MODELS',
    helperExports: ['getModelById', 'getEnabledModels'],
  },
  {
    module: `${SERVER}/services/image-models/registry`,
    rowsExport: 'IMAGE_MODELS',
    helperExports: ['getImageModelById', 'getEnabledImageModels'],
  },
  {
    module: `${SERVER}/services/editing-models/registry`,
    rowsExport: 'EDITING_MODELS',
    helperExports: ['getEditingModelById', 'getEnabledEditingModels'],
  },
  {
    module: `${SERVER}/services/audio-models/registry`,
    rowsExport: 'AUDIO_MODELS',
    helperExports: ['getModelById', 'getEnabledModels'],
  },
  {
    module: `${SERVER}/services/transcription-models/registry`,
    rowsExport: 'TRANSCRIPTION_MODELS',
    helperExports: ['getModelById', 'getEnabledModels'],
  },
  {
    module: `${SERVER}/services/tts-models/registry`,
    rowsExport: 'TTS_MODELS',
    helperExports: ['getTtsModelById', 'getEnabledTtsModels', 'quoteTtsCredits'],
  },
  {
    module: `${SERVER}/services/llm-models/registry`,
    rowsExport: 'LLM_MODELS',
    helperExports: ['getLlmModelById', 'getEnabledLlmModels'],
  },
  {
    module: `${SERVER}/services/threed-models/registry`,
    rowsExport: 'THREED_MODELS',
    helperExports: ['getThreedModelById', 'getEnabledThreedModels', 'getModelsByTask'],
  },
];

interface MinimalRow {
  id: string;
  provider: string;
  isEnabled?: boolean;
  // Per-unit pricing keys vary across registries — collect them all.
  providerCostUsd?: number;
  providerCostUsdPerMinute?: number;
  providerCostUsdPerMillionChars?: number;
  providerInputUsdPerMtok?: number;
  fiatPriceUsd?: number;
  fiatPriceUsdPerMinute?: number;
  fiatPriceUsdPerMillionChars?: number;
  fiatInputUsdPerMtok?: number;
  loarPriceUsd?: number;
  loarPriceUsdPerMinute?: number;
  loarPriceUsdPerMillionChars?: number;
  loarInputUsdPerMtok?: number;
  creditCost?: number;
  creditCostPerImage?: number;
  creditCostPerMinute?: number;
  creditCostPer1kChars?: number;
  creditCostPer1kInputTokens?: number;
}

/** Pull the provider cost out of whatever shape the registry uses. */
function providerCostOf(r: MinimalRow): number | undefined {
  return (
    r.providerCostUsd ??
    r.providerCostUsdPerMinute ??
    r.providerCostUsdPerMillionChars ??
    r.providerInputUsdPerMtok
  );
}

function fiatPriceOf(r: MinimalRow): number | undefined {
  return (
    r.fiatPriceUsd ??
    r.fiatPriceUsdPerMinute ??
    r.fiatPriceUsdPerMillionChars ??
    r.fiatInputUsdPerMtok
  );
}

function loarPriceOf(r: MinimalRow): number | undefined {
  return (
    r.loarPriceUsd ??
    r.loarPriceUsdPerMinute ??
    r.loarPriceUsdPerMillionChars ??
    r.loarInputUsdPerMtok
  );
}

function creditCostOf(r: MinimalRow): number | undefined {
  return (
    r.creditCost ??
    r.creditCostPerImage ??
    r.creditCostPerMinute ??
    r.creditCostPer1kChars ??
    r.creditCostPer1kInputTokens
  );
}

export async function runModelMatrixLayer(): Promise<ModelMatrixLayerResult> {
  const checks: CheckResult[] = [];
  const providerSeen = new Set<string>();
  let totalRows = 0;

  // ── 1. Registry loadability + helper exports + row integrity ──────
  for (const spec of REGISTRIES) {
    const label = spec.rowsExport;
    // eslint-disable-next-line no-await-in-loop
    checks.push(
      // eslint-disable-next-line no-await-in-loop
      await check(`${label} loads + integrity`, async () => {
        const mod: Record<string, unknown> = await import(spec.module);
        const rows = mod[spec.rowsExport] as MinimalRow[] | undefined;
        if (!Array.isArray(rows)) {
          throw new Error(`${spec.rowsExport} is not an array`);
        }
        if (rows.length === 0) {
          throw new Error(`${spec.rowsExport} is empty`);
        }
        for (const h of spec.helperExports ?? []) {
          if (typeof mod[h] !== 'function') {
            throw new Error(`Missing helper export: ${h}`);
          }
        }

        let badPricing = 0;
        let missingFields = 0;
        // Rounding tolerance: registries use 2-decimal USD rounding on the
        // margin math, so any cost ≤ $0.01 can legitimately round to $0.00.
        // Only flag inversions above the rounding floor.
        const ROUND_FLOOR = 0.01;
        for (const r of rows) {
          if (!r.id || !r.provider) {
            missingFields++;
            continue;
          }
          providerSeen.add(r.provider);
          const p = providerCostOf(r);
          const f = fiatPriceOf(r);
          const l = loarPriceOf(r);
          const c = creditCostOf(r);
          if (p !== undefined && p > ROUND_FLOOR) {
            if (f !== undefined && f < p) badPricing++;
            if (l !== undefined && l < p) badPricing++;
            if (c !== undefined && c <= 0) badPricing++;
          }
        }
        if (missingFields > 0 || badPricing > 0) {
          throw new Error(
            `${missingFields} rows missing id/provider, ${badPricing} pricing inversions`
          );
        }
        totalRows += rows.length;
        return `${rows.length} rows`;
      })
    );
  }

  checks.push(
    await check('total registry rows', async () => `${totalRows} rows across 8 registries`)
  );

  // ── 2. Every distinct provider is in the BYOK registry ─────────────
  checks.push(
    await check('every provider has a BYOK entry', async () => {
      const { PROVIDER_REGISTRY } = (await import(`${SERVER}/services/provider-keys/registry`)) as {
        PROVIDER_REGISTRY: Record<string, unknown>;
      };
      const known = new Set(Object.keys(PROVIDER_REGISTRY));
      // Some registry rows use `provider: 'comfyui'` or `'meshy'` that
      // aren't BYOK-managed in the same way; explicitly allow-list those.
      const allow = new Set(['comfyui']);
      const missing: string[] = [];
      for (const p of providerSeen) {
        if (allow.has(p)) continue;
        if (!known.has(p)) missing.push(p);
      }
      if (missing.length > 0) {
        throw new Error(`unknown to provider-keys: ${missing.join(', ')}`);
      }
      return `${providerSeen.size} providers ✓`;
    })
  );

  // ── 3. Dispatchers import + reject unknown ids ─────────────────────
  checks.push(
    await check('dispatchTts rejects unknown id', async () => {
      const { dispatchTts } = (await import(`${SERVER}/services/tts-models`)) as {
        dispatchTts: (i: { modelId: string; text: string }) => Promise<unknown>;
      };
      try {
        await dispatchTts({ modelId: '__nonexistent__', text: 'x' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Unknown TTS model')) return 'rejects ✓';
        throw new Error(`wrong error: ${msg.slice(0, 80)}`);
      }
      throw new Error('did not throw');
    })
  );

  checks.push(
    await check('dispatchLlm rejects unknown id', async () => {
      const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
        dispatchLlm: (i: { modelId: string; messages: unknown[] }) => Promise<unknown>;
      };
      try {
        await dispatchLlm({ modelId: '__nonexistent__', messages: [] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Unknown LLM model')) return 'rejects ✓';
        throw new Error(`wrong error: ${msg.slice(0, 80)}`);
      }
      throw new Error('did not throw');
    })
  );

  checks.push(
    await check('dispatchThreed rejects unknown id', async () => {
      const { dispatchThreed } = (await import(`${SERVER}/services/threed-models`)) as {
        dispatchThreed: (i: { modelId: string }) => Promise<unknown>;
      };
      try {
        await dispatchThreed({ modelId: '__nonexistent__' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Unknown 3D model')) return 'rejects ✓';
        throw new Error(`wrong error: ${msg.slice(0, 80)}`);
      }
      throw new Error('did not throw');
    })
  );

  // ── 4. Service adapters importable ─────────────────────────────────
  const ADAPTERS: Array<{ label: string; module: string; expect: string }> = [
    { label: 'openai service', module: `${SERVER}/services/openai`, expect: 'openAIService' },
    {
      label: 'elevenlabs service',
      module: `${SERVER}/services/elevenlabs`,
      expect: 'elevenLabsService',
    },
    {
      label: 'gemini BYOK chat',
      module: `${SERVER}/services/gemini`,
      expect: 'geminiChat',
    },
    {
      label: 'gemini Veo',
      module: `${SERVER}/services/gemini`,
      expect: 'veoGenerate',
    },
    {
      label: 'gemini Lyria',
      module: `${SERVER}/services/gemini`,
      expect: 'lyriaGenerate',
    },
    {
      label: 'bytedance service',
      module: `${SERVER}/services/bytedance`,
      expect: 'bytedanceService',
    },
    { label: 'zai service', module: `${SERVER}/services/zai`, expect: 'zaiService' },
    { label: 'meshy service', module: `${SERVER}/services/meshy`, expect: 'meshyService' },
    { label: 'fal service', module: `${SERVER}/services/fal`, expect: 'falService' },
  ];

  for (const a of ADAPTERS) {
    // eslint-disable-next-line no-await-in-loop
    checks.push(
      // eslint-disable-next-line no-await-in-loop
      await check(`${a.label} adapter loads (${a.expect})`, async () => {
        const mod: Record<string, unknown> = await import(a.module);
        if (mod[a.expect] === undefined) {
          throw new Error(`expected export "${a.expect}" not found`);
        }
        return 'ok';
      })
    );
  }

  // ── 5. Caption backend dispatch includes OpenAI backends ───────────
  checks.push(
    await check('caption dispatch lists OpenAI backends', async () => {
      const { listBackendIds } = (await import(`${SERVER}/services/captions-backend/dispatch`)) as {
        listBackendIds: () => string[];
      };
      const ids = listBackendIds();
      const expected = [
        'gpt-4o-transcribe-openai',
        'gpt-4o-transcribe-diarize-openai',
        'gpt-4o-mini-transcribe-openai',
        'whisper-1-openai',
      ];
      const missing = expected.filter((m) => !ids.includes(m));
      if (missing.length > 0) {
        throw new Error(`missing backends: ${missing.join(', ')}`);
      }
      return `${ids.length} total, all OpenAI variants ✓`;
    })
  );

  // ── 6. Spot-check: signature rows must exist after recent work ──────
  const SPOT_ROWS: Array<{ label: string; registry: string; rowsExport: string; id: string }> = [
    {
      label: 'sora-2-pro-openai in video',
      registry: `${SERVER}/services/video-models/registry`,
      rowsExport: 'VIDEO_MODELS',
      id: 'sora-2-pro-openai',
    },
    {
      label: 'veo-31-preview-google in video',
      registry: `${SERVER}/services/video-models/registry`,
      rowsExport: 'VIDEO_MODELS',
      id: 'veo-31-preview-google',
    },
    {
      label: 'gpt-image-15 in image',
      registry: `${SERVER}/services/image-models/registry`,
      rowsExport: 'IMAGE_MODELS',
      id: 'gpt-image-15',
    },
    {
      label: 'nano-banana-2 fixed to gemini-3.1 in image',
      registry: `${SERVER}/services/image-models/registry`,
      rowsExport: 'IMAGE_MODELS',
      id: 'nano-banana-2',
    },
    {
      label: 'elevenlabs-music-direct in audio',
      registry: `${SERVER}/services/audio-models/registry`,
      rowsExport: 'AUDIO_MODELS',
      id: 'elevenlabs-music-direct',
    },
    {
      label: 'lyria-3-pro-google in audio',
      registry: `${SERVER}/services/audio-models/registry`,
      rowsExport: 'AUDIO_MODELS',
      id: 'lyria-3-pro-google',
    },
    {
      label: 'gpt-4o-transcribe-diarize-openai in transcription',
      registry: `${SERVER}/services/transcription-models/registry`,
      rowsExport: 'TRANSCRIPTION_MODELS',
      id: 'gpt-4o-transcribe-diarize-openai',
    },
    {
      label: 'gpt-4o-mini-tts in tts',
      registry: `${SERVER}/services/tts-models/registry`,
      rowsExport: 'TTS_MODELS',
      id: 'gpt-4o-mini-tts',
    },
    {
      label: 'gpt-5 in llm',
      registry: `${SERVER}/services/llm-models/registry`,
      rowsExport: 'LLM_MODELS',
      id: 'gpt-5',
    },
    {
      label: 'glm-4-6v in llm (canon-check default)',
      registry: `${SERVER}/services/llm-models/registry`,
      rowsExport: 'LLM_MODELS',
      id: 'glm-4-6v',
    },
    {
      label: 'meshy-rigging in threed',
      registry: `${SERVER}/services/threed-models/registry`,
      rowsExport: 'THREED_MODELS',
      id: 'meshy-rigging',
    },
  ];

  for (const spot of SPOT_ROWS) {
    // eslint-disable-next-line no-await-in-loop
    checks.push(
      // eslint-disable-next-line no-await-in-loop
      await check(spot.label, async () => {
        const mod: Record<string, unknown> = await import(spot.registry);
        const rows = mod[spot.rowsExport] as Array<{ id: string }>;
        if (!rows.find((r) => r.id === spot.id)) {
          throw new Error(`row "${spot.id}" missing`);
        }
        return 'present ✓';
      })
    );
  }

  // ── 6b. Every transcription row has a caption backend ───────────────
  checks.push(
    await check('every transcription row has a caption backend', async () => {
      const { TRANSCRIPTION_MODELS } = (await import(
        `${SERVER}/services/transcription-models/registry`
      )) as { TRANSCRIPTION_MODELS: Array<{ id: string; isEnabled?: boolean }> };
      const { listBackendIds } = (await import(`${SERVER}/services/captions-backend/dispatch`)) as {
        listBackendIds: () => string[];
      };
      const known = new Set(listBackendIds());
      const stranded = TRANSCRIPTION_MODELS.filter((m) => m.isEnabled !== false).filter(
        (m) => !known.has(m.id)
      );
      if (stranded.length > 0) {
        throw new Error(`stranded: ${stranded.map((r) => r.id).join(', ')}`);
      }
      return `${TRANSCRIPTION_MODELS.length} rows ✓`;
    })
  );

  // ── 7. Nano Banana correctness regression ──────────────────────────
  checks.push(
    await check('Nano Banana naming follows Google docs', async () => {
      const { IMAGE_MODELS } = (await import(`${SERVER}/services/image-models/registry`)) as {
        IMAGE_MODELS: Array<{ id: string; googleModelId?: string }>;
      };
      const nb2 = IMAGE_MODELS.find((m) => m.id === 'nano-banana-2');
      const nbProGoogle = IMAGE_MODELS.find((m) => m.id === 'nano-banana-pro-google');
      const nbGa = IMAGE_MODELS.find((m) => m.id === 'nano-banana-google-ga');
      if (nb2?.googleModelId !== 'gemini-3.1-flash-image-preview') {
        throw new Error(
          `nano-banana-2 should point at gemini-3.1-flash-image-preview, got ${nb2?.googleModelId}`
        );
      }
      if (nbProGoogle?.googleModelId !== 'gemini-3-pro-image-preview') {
        throw new Error(
          `nano-banana-pro-google should point at gemini-3-pro-image-preview, got ${nbProGoogle?.googleModelId}`
        );
      }
      if (nbGa?.googleModelId !== 'gemini-2.5-flash-image') {
        throw new Error(
          `nano-banana-google-ga should point at gemini-2.5-flash-image, got ${nbGa?.googleModelId}`
        );
      }
      return '3 rows correctly mapped ✓';
    })
  );

  return { checks };
}
