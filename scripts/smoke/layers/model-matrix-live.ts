/**
 * Layer — model-matrix-live
 *
 * Live provider round-trips. The static `model-matrix` layer verifies
 * wiring; this layer verifies the wiring + real provider auth + response
 * parsing actually work, with real keys. It's opt-in because some calls
 * cost real money.
 *
 * Run modes:
 *   pnpm smoke SMOKE_LAYER=model-matrix-live           (no-op; opt-in only)
 *   SMOKE_LIVE=1 pnpm smoke SMOKE_LAYER=matrix-live    (free + cheap LLM only)
 *   SMOKE_LIVE_PAID=1 pnpm smoke SMOKE_LAYER=matrix-live  (image/audio/video too)
 *
 * Per-provider behaviour:
 *   - Free tier (Z.AI glm-4.5-flash, GLM-4.6V Flash): always runs when SMOKE_LIVE
 *   - Sub-penny LLMs (Groq llama-3.1-8b-instant, OpenAI gpt-5-nano, Gemini
 *     2.5 Flash Lite, Doubao Seed 2.0 Lite): runs when SMOKE_LIVE and key set
 *   - Image / video / music / 3D (cents+ per call): runs when SMOKE_LIVE_PAID
 *     and key set
 *   - Anything without a key is skipped, not failed
 *
 * Each check reports estimated provider cost in the detail string so you
 * know what the run is costing you.
 */
import { check, skipped, type CheckResult } from '../reporter.ts';

const SERVER = '../../../apps/server/src';

export interface ModelMatrixLiveResult {
  checks: CheckResult[];
}

const LIVE = process.env.SMOKE_LIVE === '1' || process.env.SMOKE_LIVE_PAID === '1';
const LIVE_PAID = process.env.SMOKE_LIVE_PAID === '1';

function hasKey(envVar: string): boolean {
  const v = process.env[envVar];
  return typeof v === 'string' && v.trim().length > 0;
}

// Cheap canary prompt: 1-2 tokens out of a 3-token in. Picks the smallest
// possible response from every chat provider.
const CHAT_MESSAGES = [{ role: 'user' as const, content: 'Reply with exactly: ok' }];

export async function runModelMatrixLiveLayer(): Promise<ModelMatrixLiveResult> {
  const checks: CheckResult[] = [];

  if (!LIVE) {
    checks.push(
      skipped(
        'live layer disabled',
        'set SMOKE_LIVE=1 for free+cheap, SMOKE_LIVE_PAID=1 for image/video/audio'
      )
    );
    return { checks };
  }

  // ── 1. Z.AI free tier — always runnable when key set ─────────────────
  checks.push(
    !hasKey('ZAI_API_KEY')
      ? skipped('zai glm-4.5-flash (free)', 'no ZAI_API_KEY')
      : await check('zai glm-4.5-flash (free)', async () => {
          const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
            dispatchLlm: (i: unknown) => Promise<{ text: string }>;
          };
          const r = await dispatchLlm({
            modelId: 'glm-4-5-flash',
            messages: CHAT_MESSAGES,
            maxTokens: 8,
          });
          if (!r.text || r.text.length === 0) throw new Error('empty response');
          return `~$0.00 (free tier) — "${r.text.slice(0, 40)}"`;
        })
  );

  checks.push(
    !hasKey('ZAI_API_KEY')
      ? skipped('zai glm-4.6v-flash (free, vision)', 'no ZAI_API_KEY')
      : await check('zai glm-4.6v-flash (free, vision)', async () => {
          const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
            dispatchLlm: (i: unknown) => Promise<{ text: string }>;
          };
          const r = await dispatchLlm({
            modelId: 'glm-4-6v-flash',
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: 'Reply with exactly: ok' }],
              },
            ],
            maxTokens: 8,
          });
          if (!r.text || r.text.length === 0) throw new Error('empty response');
          return `~$0.00 (free) — "${r.text.slice(0, 40)}"`;
        })
  );

  // ── 2. Sub-penny LLMs (OpenAI / Google / Doubao / Groq) ──────────────
  checks.push(
    !hasKey('OPENAI_API_KEY')
      ? skipped('openai gpt-5-nano (~$0.0001)', 'no OPENAI_API_KEY')
      : await check('openai gpt-5-nano (~$0.0001)', async () => {
          const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
            dispatchLlm: (i: unknown) => Promise<{
              text: string;
              usage: { promptTokens?: number; completionTokens?: number };
            }>;
          };
          const r = await dispatchLlm({
            modelId: 'gpt-5-nano',
            messages: CHAT_MESSAGES,
            maxTokens: 8,
          });
          if (!r.text) throw new Error('empty response');
          const cost = (
            ((r.usage.promptTokens ?? 0) * 0.05 + (r.usage.completionTokens ?? 0) * 0.4) /
            1_000_000
          ).toFixed(6);
          return `$${cost} — "${r.text.slice(0, 40)}"`;
        })
  );

  checks.push(
    !hasKey('GOOGLE_API_KEY')
      ? skipped('gemini-2.5-flash-lite (~$0.0001)', 'no GOOGLE_API_KEY')
      : await check('gemini-2.5-flash-lite (~$0.0001)', async () => {
          const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
            dispatchLlm: (i: unknown) => Promise<{
              text: string;
              usage: { promptTokens?: number; completionTokens?: number };
            }>;
          };
          const r = await dispatchLlm({
            modelId: 'gemini-2-5-flash-lite',
            messages: CHAT_MESSAGES,
            maxTokens: 8,
          });
          if (!r.text) throw new Error('empty response');
          const cost = (
            ((r.usage.promptTokens ?? 0) * 0.1 + (r.usage.completionTokens ?? 0) * 0.4) /
            1_000_000
          ).toFixed(6);
          return `$${cost} — "${r.text.slice(0, 40)}"`;
        })
  );

  checks.push(
    !hasKey('BYTEDANCE_API_KEY')
      ? skipped('doubao seed-2-0-lite (~$0.0001)', 'no BYTEDANCE_API_KEY')
      : await check('doubao seed-2-0-lite (~$0.0001)', async () => {
          const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
            dispatchLlm: (i: unknown) => Promise<{ text: string }>;
          };
          const r = await dispatchLlm({
            modelId: 'doubao-seed-2-0-lite',
            messages: CHAT_MESSAGES,
            maxTokens: 8,
          });
          if (!r.text) throw new Error('empty response');
          return `~$0.0001 — "${r.text.slice(0, 40)}"`;
        })
  );

  checks.push(
    !hasKey('GROQ_API_KEY')
      ? skipped('groq llama-3.1-8b-instant (~$0.0001)', 'no GROQ_API_KEY')
      : await check('groq llama-3.1-8b-instant (~$0.0001)', async () => {
          const { dispatchLlm } = (await import(`${SERVER}/services/llm-models`)) as {
            dispatchLlm: (i: unknown) => Promise<{
              text: string;
              usage: { promptTokens?: number; completionTokens?: number };
            }>;
          };
          const r = await dispatchLlm({
            modelId: 'llama-3-1-8b-instant-groq',
            messages: CHAT_MESSAGES,
            maxTokens: 8,
          });
          if (!r.text) throw new Error('empty response');
          const cost = (
            ((r.usage.promptTokens ?? 0) * 0.05 + (r.usage.completionTokens ?? 0) * 0.08) /
            1_000_000
          ).toFixed(6);
          return `$${cost} — "${r.text.slice(0, 40)}"`;
        })
  );

  // ── 3. PAID — image / audio / TTS / video. Opt-in via SMOKE_LIVE_PAID. ─
  if (!LIVE_PAID) {
    checks.push(
      skipped(
        'paid checks skipped',
        'set SMOKE_LIVE_PAID=1 to exercise image/audio/video providers'
      )
    );
    return { checks };
  }

  // OpenAI gpt-image-1-mini — cheapest OpenAI image (~$0.012)
  checks.push(
    !hasKey('OPENAI_API_KEY')
      ? skipped('openai gpt-image-1-mini (~$0.012)', 'no OPENAI_API_KEY')
      : await check('openai gpt-image-1-mini (~$0.012)', async () => {
          const { openAIService } = (await import(`${SERVER}/services/openai`)) as {
            openAIService: {
              generateImage: (
                i: unknown
              ) => Promise<{ all: Array<{ url?: string; b64_json?: string }> }>;
            };
          };
          const r = await openAIService.generateImage({
            model: 'gpt-image-1-mini',
            prompt: 'a single small black dot on white',
            n: 1,
            size: '1024x1024',
            responseFormat: 'url',
          });
          if (r.all.length === 0) throw new Error('no images returned');
          return `1 image, ${r.all[0].url ? 'url' : 'b64'} ✓`;
        })
  );

  // ElevenLabs TTS — single short phrase (~$0.001 with Flash v2.5)
  checks.push(
    !hasKey('ELEVENLABS_API_KEY')
      ? skipped('elevenlabs flash v2.5 tts (~$0.001)', 'no ELEVENLABS_API_KEY')
      : await check('elevenlabs flash v2.5 tts (~$0.001)', async () => {
          const { dispatchTts } = (await import(`${SERVER}/services/tts-models`)) as {
            dispatchTts: (i: unknown) => Promise<{ audioBuffer: Buffer; contentType: string }>;
          };
          const r = await dispatchTts({
            modelId: 'eleven-flash-v25',
            text: 'ok',
          });
          if (r.audioBuffer.length === 0) throw new Error('empty audio buffer');
          return `${r.audioBuffer.length} bytes ${r.contentType} ✓`;
        })
  );

  // OpenAI tts-1 — single phrase ($0.000015 / char × 2 ≈ $0.00003)
  checks.push(
    !hasKey('OPENAI_API_KEY')
      ? skipped('openai gpt-4o-mini-tts (~$0.0001)', 'no OPENAI_API_KEY')
      : await check('openai gpt-4o-mini-tts (~$0.0001)', async () => {
          const { dispatchTts } = (await import(`${SERVER}/services/tts-models`)) as {
            dispatchTts: (i: unknown) => Promise<{ audioBuffer: Buffer; contentType: string }>;
          };
          const r = await dispatchTts({
            modelId: 'gpt-4o-mini-tts',
            text: 'ok',
          });
          if (r.audioBuffer.length === 0) throw new Error('empty audio buffer');
          return `${r.audioBuffer.length} bytes ✓`;
        })
  );

  // Deepgram Aura-2 — single short phrase ($0.00006)
  checks.push(
    !hasKey('DEEPGRAM_API_KEY')
      ? skipped('deepgram aura-2 tts (~$0.0001)', 'no DEEPGRAM_API_KEY')
      : await check('deepgram aura-2 tts (~$0.0001)', async () => {
          const { dispatchTts } = (await import(`${SERVER}/services/tts-models`)) as {
            dispatchTts: (i: unknown) => Promise<{ audioBuffer: Buffer; contentType: string }>;
          };
          const r = await dispatchTts({
            modelId: 'aura-2-deepgram',
            text: 'ok',
            voiceId: 'aura-2-thalia-en',
          });
          if (r.audioBuffer.length === 0) throw new Error('empty audio buffer');
          return `${r.audioBuffer.length} bytes ✓`;
        })
  );

  // Imagen 4 Fast — cheapest Imagen ($0.02/image)
  checks.push(
    !hasKey('GOOGLE_API_KEY')
      ? skipped('google imagen-4 fast (~$0.02)', 'no GOOGLE_API_KEY')
      : await check('google imagen-4 fast (~$0.02)', async () => {
          const { googleImagenService } = (await import(`${SERVER}/services/google-imagen`)) as {
            googleImagenService: {
              generate: (i: unknown) => Promise<{ images: Array<{ base64: string }> }>;
            };
          };
          const r = await googleImagenService.generate({
            model: 'imagen-4.0-fast-generate-001',
            prompt: 'a single black dot on white background',
            numberOfImages: 1,
            aspectRatio: '1:1',
          });
          if (r.images.length === 0) throw new Error('no images returned');
          return `1 image, ${r.images[0].base64.length} bytes b64 ✓`;
        })
  );

  return { checks };
}
