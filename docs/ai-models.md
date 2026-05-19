# AI Model Matrix

Every model the LOAR platform calls, what feature it powers, and where in the
code it's wired. Refreshed by hand — keep in sync when adding or removing a
model from `apps/server/src/services/fal/fal.ts`,
`apps/server/src/services/google-imagen.ts`,
`apps/server/src/routers/zai/zai.routes.ts`, or any router under
`apps/server/src/routers/generation/`.

> **Concrete pricing lives in [pricing.md](pricing.md)** — auto-generated from
> the registries under `apps/server/src/services/*-models/registry.ts`. Lists
> every model with provider cost, fiat price, $LOAR price, and credit cost.
> Regenerate with `pnpm docs:pricing` after any registry change.

**Headline:** ~70 distinct model IDs across 8 providers — fal AI (the bulk),
Google (Vertex Imagen + Gemini), OpenAI, Anthropic, ElevenLabs, ByteDance
(direct + via fal), Z.AI (BYOK), Meshy. Smart-auto picks the model per
generation by quality / speed / cost preference; users can override.

> Cost tiers are relative buckets reflected in the platform's pricing matrix,
> not exact USD per call. Premium = top-end quality (Veo 3.1 Pro, Sora 2 Pro,
> FLUX 2 Pro, Imagen 4 Ultra). Standard = the default mid tier. Budget = fast,
> cheap fallback (Kokoro TTS, FLUX Schnell, Nano Banana, Wan 2.5 lite).

---

## Video generation

Routed through `apps/server/src/services/fal/fal.ts` and
`apps/server/src/routers/generation/generation.routes.ts`. All variants below
have a text-to-video (`-t2v`) and / or image-to-video (`-i2v`) form.

| Model family    | Variants in code                                                             | Provider         | Purpose                                                                                                            | Tier     |
| --------------- | ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| **Veo 3.1**     | full / lite / std × t2v / i2v (6 IDs)                                        | Google           | Premium video tier. Default for cinematic universe scenes when the user picks "best quality" routing.              | Premium  |
| **Sora 2**      | sora2-t2v, sora2-i2v, sora2-pro-t2v, sora2-pro-i2v                           | OpenAI           | Premium tier alongside Veo 3.1.                                                                                    | Premium  |
| **Kling**       | kling-t2v, kling-i2v, kling3-i2v, kling-video-v3, v2.5-turbo/pro             | Kuaishou         | Mid-tier video. Also drives the per-universe hero clip rail on the landing page (`scripts/regen-hero-clip.ts:34`). | Standard |
| **Seedance 2**  | seedance2-{t2v,i2v,fast-t2v,fast-i2v,ref,fast-ref}                           | ByteDance        | Reference-image-aware video (the `-ref` variants pin to a character / location image for continuity).              | Standard |
| **Wan**         | wan25-t2v, wan25-i2v, wan27-t2v, wan27-i2v                                   | Alibaba          | Auto-route fallback when premium tiers are saturated or out of budget.                                             | Standard |
| **PixVerse v6** | pixverse-v6-t2v, pixverse-v6-i2v                                             | PixVerse         | Auto-route alternate.                                                                                              | Standard |
| **Runway Gen3** | runway-gen3                                                                  | Runway           | Auto-route alternate.                                                                                              | Standard |
| **LTX**         | ltx-video                                                                    | Lightrix         | Budget fallback.                                                                                                   | Budget   |
| **HunYuan**     | hunyuan                                                                      | Tencent          | Budget fallback.                                                                                                   | Budget   |
| **CogVideoX**   | cogvideox, cogvideox-3                                                       | Zhipu            | Budget fallback.                                                                                                   | Budget   |
| **ViduQ1**      | viduq1-t2v, viduq1-i2v (`apps/server/src/routers/zai/zai.routes.ts:256,264`) | Vidu / Z.AI BYOK | Surfaced when the user supplies their own Z.AI key in the BYOK lab.                                                | Standard |

**Total video IDs in code: ~32.**

## Image generation

Routed through `apps/server/src/routers/generation/image.routes.ts` and
`apps/server/src/services/google-imagen.ts`.

| Model family    | Variants in code                                                                                                                      | Provider  | Purpose                                                                                                                       | Tier     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| **FLUX**        | schnell, dev, pro, 1.1 Pro, 2 Pro, kontext-pro (+ inpaint)                                                                            | BFL       | Default text-to-image stack. `kontext-pro` is used for image-to-image edits / inpaint; FLUX 2 Pro is the premium stills tier. | All      |
| **Imagen 4**    | imagen-4.0-generate-001, imagen-4.0-ultra-generate-001, imagen-4.0-fast-generate-001 (`apps/server/src/services/google-imagen.ts:13`) | Google    | Premium photographic stills via Vertex; preferred when entity portraits need real-world photorealism.                         | Premium  |
| **Nano Banana** | nano-banana, nano-banana-2, nano-banana-pro                                                                                           | fal       | Fast, cheap text-to-image; `pro` powers outpaint / reframe in `apps/server/src/routers/outpaint/outpaint.routes.ts:24`.       | Budget   |
| **Recraft V4**  | recraft-v4                                                                                                                            | Recraft   | Stylized illustration / vector look.                                                                                          | Standard |
| **Ideogram V3** | ideogram-v3                                                                                                                           | Ideogram  | Text-rendering-strong images (logos, posters, in-image typography).                                                           | Standard |
| **Seedream V5** | seedream-v5, seedream-5-direct (`apps/server/src/services/bytedance.ts`)                                                              | ByteDance | Cinematic stills; `seedream-5-direct` hits ByteDance directly, the other goes through fal.                                    | Standard |
| **GPT Image**   | gpt-image                                                                                                                             | OpenAI    | Image alternate, commonly used for character-sheet + concept compositions.                                                    | Standard |
| **Qwen Image**  | qwen-image                                                                                                                            | Alibaba   | BYOK image alternate.                                                                                                         | Standard |
| **GLM Image**   | glm-image (`apps/server/src/routers/zai/zai.routes.ts:9`)                                                                             | Z.AI BYOK | Surfaced in the BYOK lab.                                                                                                     | Standard |

**Total image IDs in code: ~17.**

## Audio generation

Routed through `apps/server/src/routers/audio/audio.routes.ts`,
`apps/server/src/routers/voice/voice.routes.ts`,
`apps/server/src/routers/talking-scene/talking-scene.routes.ts`,
`apps/server/src/services/transcription.ts`, and
`apps/server/src/services/bytedance.ts`.

| Model                                             | Provider          | Purpose                                                                                                                                   | Tier     |
| ------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **stable-audio (`fal-ai/stable-audio`)**          | Stability via fal | Episode theme / ambient music. Used in `scripts/fill-audio-and-voices.ts:53` to attach a `themeAudioUrl` to canon episodes.               | Standard |
| **MusicGen Large + Stereo Large**                 | Meta via fal      | Long-form music generation (`apps/server/src/routers/audio/audio.routes.ts:14`).                                                          | Standard |
| **ElevenLabs voices**                             | ElevenLabs        | Character dialogue in talking scenes (`apps/server/src/routers/talking-scene/talking-scene.routes.ts:136`), voice cloning / voice design. | Premium  |
| **Kokoro TTS (`fal-ai/kokoro/american-english`)** | Kokoro via fal    | Cheap, consistent character voice samples on the entity wiki (`scripts/fill-audio-and-voices.ts:71`).                                     | Budget   |
| **ByteDance seed-tts-1.0**                        | ByteDance         | Alternative TTS path (`apps/server/src/services/bytedance.ts:582`).                                                                       | Standard |
| **Whisper (`fal-ai/whisper`)**                    | OpenAI via fal    | Auto-caption transcription on generated videos (`apps/server/src/services/transcription.ts:56`).                                          | Standard |

## 3D asset generation

| Model               | Provider | Purpose                                                                                                                            | Tier     |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Meshy 4 / 5 / 6** | Meshy    | Image-to-3D and text-to-3D entity asset packs (`scripts/fill-meshy-3d.ts`, `apps/server/src/routers/studio/studio.routes.ts:345`). | Standard |

## Language models / agents

| Model family           | IDs in code                                          | Provider  | Purpose                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gemini 2.5**         | gemini-2.5-pro, gemini-2.5-flash                     | Google    | VLM continuity subsystem (scene / entity / canon / moderation extraction), entity lore generation, wiki extraction. See [docs/prd-vlm-subsystem.md](prd-vlm-subsystem.md). |
| **GPT-4o-mini**        | gpt-4o-mini                                          | OpenAI    | Cinematic-universe storyline / wiki narrative generation (`apps/server/src/services/wikia.ts:89`).                                                                         |
| **Z.AI GLM**           | glm-4.7 (default), glm-5.1, glm-5-turbo              | Z.AI BYOK | Chat / reasoning / worldbuilding when the user supplies a Z.AI key. Routed via `apps/server/src/routers/zai/zai.routes.ts:400+`.                                           |
| **Claude (Anthropic)** | claude-opus-4-x, claude-sonnet-4-x, claude-haiku-4-x | Anthropic | Used by the Claude Agent SDK pathway and platform-side editorial agents. Not directly callable from the consumer UI yet.                                                   |

## Smart-auto routing

`generation.routes.ts` (`smartRouteVideo`, `smartRouteImage`) selects a model
per generation based on the user's quality / speed / cost preference and a
budget cap, with deterministic fallback through the lists above. Cost is
tracked per generation in the admin cost dashboard (`/admin/cost`).

Manual override: every generation form in the editor exposes the model
dropdown. Power users browsing `/admin/cost` can see cost-vs-revenue per
model.

## Updating this doc

When you add or retire a model:

1. Update the routing list in `apps/server/src/services/fal/fal.ts` (or the
   relevant provider service).
2. Update the relevant table above. Keep the file:line reference current.
3. If the model changes a headline count (video / image / total), update the
   corresponding row in the README "Honest Feature Status" table.
