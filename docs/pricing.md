# Model Pricing

> Auto-generated from registries under `apps/server/src/services/*-models/registry.ts`.
> Regenerate with `tsx scripts/generate-pricing-doc.ts`.
> Generated: **2026-05-19**

## How to read this

- **Provider $** — what LOAR pays the upstream provider (OpenAI, Google, ByteDance, etc.) per unit.
- **Fiat $** — what end-users pay when settling in card/crypto. Computed as `provider × FIAT_MARGIN`.
- **LOAR $** — what end-users pay in $LOAR token. Computed as `provider × LOAR_MARGIN`.
- **Credits** — internal credit units consumed for the call. Conversion: `1 credit = $0.01`.
- **Quality** — registry-declared tier: `draft` < `standard` < `premium`. The router's `qualityTarget` floor uses this.
- **Tier** (priceTier) — relative cost bucket the router uses when `costBudget: 'low' | 'medium' | 'any'`. Within a tier, the router tiebreaks by exact `Provider $/Mtok in`.
- **Status** — ✅ live (enabled + visible), 🔒 hidden (enabled but hidden from end users — internal/admin only), 🚫 disabled.

## Margin constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `FIAT_MARGIN` | 1.35 | Multiplier applied to provider cost for card/crypto pricing |
| `LOAR_MARGIN` | 1.25 | Multiplier applied to provider cost for $LOAR pricing (cheaper to incentivize token use) |
| `LOAR_TO_USD` | $0.01 | Implied USD value of one credit, used when computing credit costs from USD |

## ByteDance $0-cost warning

Entries marked ⚠️ have `providerCostUsd: 0` in the registry. Since ByteDance Volces is a paid API, this means we are billed by ByteDance but not tracking it in our cost ledger. Boot warning lives in `apps/server/src/lib/pricing-audit.ts`. Fix by looking up the real per-call price on the Volces dashboard and patching the registry.

## Keeping these numbers honest

Provider list prices change ~quarterly (OpenAI/Google/Anthropic) to ~monthly (ByteDance/Z.AI). Rather than scraping their pricing pages, we reconcile against the real bill:

1. **Boot audit** — `apps/server/src/lib/pricing-audit.ts` flags any `isEnabled && providerCostUsd: 0` model on every server boot. Loudest for ByteDance.
2. **Daily cost-drift detector** — `.github/workflows/cost-drift.yml` compares trailing-7d per-model `$/1k-token` (or `$/call` for non-token providers) against the prior 7d. Opens a GitHub issue when any model drifts beyond ±5%. Catches provider rate changes within 24h of impact. Run locally: `pnpm cost:check-drift`.
3. **Weekly staleness check** — every Monday `.github/workflows/pricing-staleness.yml` opens a GitHub issue for any registry untouched for >90 days (configurable). Issue auto-closes when all are fresh. Run locally: `pnpm registry:check-staleness`.
4. **Monthly spend reconciliation** — `pnpm reconcile:spend --invoice=./invoices/YYYY-MM.json` reads the `costLedger` aggregates for the period, compares them to actual invoiced amounts (from each provider's dashboard), and exits non-zero if any provider drifts beyond ±3%. Invoice template: [`scripts/invoice-template.json`](../scripts/invoice-template.json).
5. **CI doc-drift gate** — the `quality` job in `.github/workflows/ci.yml` regenerates this doc and fails the build if a registry change wasn't accompanied by `pnpm docs:pricing`.

Five layers, five failure modes: entry never tracked (boot), prices fluctuated and we didn't notice (daily drift), no one verified a registry in months (weekly), provider's invoice diverges from our ledger (monthly), registry edit slipped past the docs (CI gate).

**Ops runbook:** [docs/ops-pricing-integrity.md](ops-pricing-integrity.md) — credential setup, IAM roles, threshold tuning, what to do when each alert fires, secret rotation. Run `pnpm ops:firebase-doctor` first when something looks wrong; it pings Firestore and prints actionable hints (rotated key? wrong project? Firestore API disabled?) before the real audit fires.

---

## LLM (chat, reasoning, vision)

**Unit:** USD per 1M tokens. Sorted by input cost (cheapest first).

| Model ID | Provider | Quality | Tier | Provider $/Mtok in | Cached $/Mtok | Provider $/Mtok out | Fiat $/Mtok in | Fiat $/Mtok out | Credits/1k in | Credits/1k out | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `glm-4-5-flash` | zai | draft | low | **$0** | **$0** | **$0** | **$0** | **$0** | 1 | 1 | ✅ live |
| `glm-4-6v-flash` | zai | standard | low | **$0** | **$0** | **$0** | **$0** | **$0** | 1 | 1 | ✅ live |
| `gpt-5-nano` | openai | standard | low | $0.0500 | $0.0050 | $0.4000 | $0.0700 | $0.5400 | 1 | 1 | ✅ live |
| `llama-3-1-8b-instant-groq` | groq | standard | low | $0.0500 | $0.0250 | $0.0800 | $0.0700 | $0.1100 | 1 | 1 | ✅ live |
| `glm-4-7-flash` | zai | standard | low | $0.0600 | $0.0150 | $0.4000 | $0.0800 | $0.5400 | 1 | 1 | ✅ live |
| `gpt-oss-20b-groq` | groq | standard | low | $0.0750 | $0.0375 | $0.3000 | $0.1000 | $0.4100 | 1 | 1 | ✅ live |
| `gpt-4-1-nano` | openai | standard | low | $0.1000 | $0.0250 | $0.4000 | $0.1400 | $0.5400 | 1 | 1 | ✅ live |
| `gemini-2-5-flash-lite` | google | standard | low | $0.1000 | $0.0100 | $0.4000 | $0.1400 | $0.5400 | 1 | 1 | ✅ live |
| `doubao-seed-2-0-lite` | bytedance | standard | low | $0.1000 | $0.0200 | $0.3000 | $0.1400 | $0.4100 | 1 | 1 | ✅ live |
| `glm-4-5-air` | zai | standard | low | $0.1300 | $0.0300 | $0.8500 | $0.1800 | $1.15 | 1 | 1 | ✅ live |
| `gpt-oss-120b-groq` | groq | premium | low | $0.1500 | $0.0750 | $0.6000 | $0.2000 | $0.8100 | 1 | 1 | ✅ live |
| `gpt-5-mini` | openai | premium | medium | $0.2500 | $0.0250 | $2 | $0.3400 | $2.7 | 1 | 1 | ✅ live |
| `gemini-3-1-flash-lite` | google | standard | low | $0.2500 | $0.0250 | $1.5 | $0.3400 | $2.03 | 1 | 1 | ✅ live |
| `qwen-3-32b-groq` | groq | standard | low | $0.2900 | $0.1450 | $0.5900 | $0.3900 | $0.8000 | 1 | 1 | ✅ live |
| `gemini-2-5-flash` | google | standard | low | $0.3000 | $0.0300 | $2.5 | $0.4100 | $3.38 | 1 | 1 | ✅ live |
| `gpt-4-1-mini` | openai | standard | low | $0.4000 | $0.1000 | $1.6 | $0.5400 | $2.16 | 1 | 1 | ✅ live |
| `glm-4-7` | zai | standard | low | $0.4000 | $0.1000 | $1.75 | $0.5400 | $2.36 | 1 | 1 | ✅ live |
| `doubao-seed-1-6-vision` | bytedance | premium | low | $0.4000 | $0.1000 | $1.2 | $0.5400 | $1.62 | 1 | 1 | ✅ live |
| `doubao-seed-2-0-pro` | bytedance | premium | low | $0.5000 | $0.1000 | $1.5 | $0.6800 | $2.03 | 1 | 1 | ✅ live |
| `llama-3-3-70b-versatile-groq` | groq | standard | low | $0.5900 | $0.3000 | $0.7900 | $0.8000 | $1.07 | 1 | 1 | ✅ live |
| `glm-4-6v` | zai | premium | low | $0.6000 | $0.1500 | $0.9000 | $0.8100 | $1.22 | 1 | 1 | ✅ live |
| `kimi-k2-instruct-groq` | groq | premium | medium | $0.6000 | $0.3000 | $2.5 | $0.8100 | $3.38 | 1 | 1 | ✅ live |
| `glm-5` | zai | premium | medium | $1 | $0.2500 | $3.2 | $1.35 | $4.32 | 1 | 1 | ✅ live |
| `o4-mini` | openai | standard | low | $1.1 | $0.2750 | $4.4 | $1.49 | $5.94 | 1 | 1 | ✅ live |
| `gpt-5` | openai | premium | high | $1.25 | $0.1250 | $10 | $1.69 | $13.5 | 1 | 1 | ✅ live |
| `gemini-2-5-pro` | google | premium | medium | $1.25 | $0.1250 | $10 | $1.69 | $13.5 | 1 | 1 | ✅ live |
| `glm-5-1` | zai | premium | medium | $1.4 | $0.3500 | $4.4 | $1.89 | $5.94 | 1 | 1 | ✅ live |
| `o3` | openai | premium | medium | $2 | $0.5000 | $8 | $2.7 | $10.8 | 1 | 1 | ✅ live |
| `gpt-4-1` | openai | premium | medium | $2 | $0.5000 | $8 | $2.7 | $10.8 | 1 | 1 | ✅ live |
| `gemini-3-1-pro` | google | premium | medium | $2 | $0.2000 | $12 | $2.7 | $16.2 | 1 | 2 | ✅ live |

## Image generation

**Unit:** USD per image. Entries marked ⚠️ are ByteDance models with $0 logged cost — see boot warning + Volces dashboard verification task.

| Model ID | Provider | Quality | Tier | Provider $/img | Fiat $/img | LOAR $/img | Credits/img | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `seedream-5-direct` | bytedance | premium | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `seedream-40-direct` | bytedance | standard | low | **$0** ⚠️ | **$0** | **$0** | 0 | 🔒 hidden |
| `seedream-45-direct` | bytedance | premium | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `flux-schnell` | fal | draft | low | $0.0030 | **$0** | **$0** | 0 | ✅ live |
| `z-image-turbo` | fal | draft | low | $0.0050 | $0.0100 | $0.0100 | 1 | ✅ live |
| `nano-banana` | fal | standard | low | $0.0060 | $0.0100 | $0.0100 | 1 | ✅ live |
| `wan27` | fal | standard | low | $0.0100 | $0.0100 | $0.0100 | 1 | ✅ live |
| `gpt-image-1-mini` | openai | standard | low | $0.0120 | $0.0200 | $0.0200 | 2 | ✅ live |
| `flux-2-klein` | fal | standard | low | $0.0150 | $0.0200 | $0.0200 | 2 | ✅ live |
| `glm-image` | zai | standard | low | $0.0150 | $0.0200 | $0.0200 | 2 | ✅ live |
| `qwen-image` | fal | standard | low | $0.0200 | $0.0300 | $0.0300 | 3 | ✅ live |
| `imagen-4-fast` | google | standard | low | $0.0200 | $0.0300 | $0.0300 | 3 | ✅ live |
| `cogview-4` | zai | standard | low | $0.0200 | $0.0300 | $0.0300 | 3 | ✅ live |
| `flux-dev` | fal | standard | medium | $0.0250 | $0.0300 | $0.0300 | 3 | ✅ live |
| `flux-2-pro` | fal | premium | medium | $0.0300 | $0.0400 | $0.0400 | 4 | ✅ live |
| `seedream-v5` | fal | standard | low | $0.0300 | $0.0400 | $0.0400 | 4 | 🚫 disabled |
| `flux-2-dev` | fal | standard | medium | $0.0300 | $0.0400 | $0.0400 | 4 | ✅ live |
| `seedream-40-fal` | fal | standard | low | $0.0300 | $0.0400 | $0.0400 | 4 | 🔒 hidden |
| `seedream-5-lite-fal` | fal | standard | low | $0.0350 | $0.0500 | $0.0400 | 5 | ✅ live |
| `nano-banana-google-ga` | google | standard | medium | $0.0390 | $0.0500 | $0.0500 | 5 | ✅ live |
| `flux-11-pro` | fal | premium | high | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `flux-kontext-pro` | fal | premium | high | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `seedream-45-fal` | fal | premium | low | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `imagen-4` | google | premium | medium | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `dall-e-3` | openai | premium | medium | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `gpt-image-1` | openai | premium | medium | $0.0420 | $0.0600 | $0.0500 | 6 | ✅ live |
| `flux-pro` | fal | premium | high | $0.0500 | $0.0700 | $0.0600 | 8 | 🔒 hidden |
| `flux-2-pro-edit` | fal | premium | high | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `gpt-image-15` | openai | premium | medium | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `grok-imagine-image` | fal | standard | medium | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `grok-imagine-edit` | fal | standard | medium | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `bria-fibo-edit` | fal | premium | medium | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `flux-2-pro-outpaint` | fal | premium | high | $0.0600 | $0.0800 | $0.0800 | 8 | ✅ live |
| `flux-11-pro-ultra` | fal | premium | high | $0.0600 | $0.0800 | $0.0800 | 8 | ✅ live |
| `imagen-4-ultra` | google | premium | high | $0.0600 | $0.0800 | $0.0800 | 8 | ✅ live |
| `nano-banana-2` | google | standard | medium | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `ideogram-v3` | fal | premium | high | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `gpt-image` | fal | premium | high | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `ideogram-v3-reframe` | fal | premium | high | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `gpt-image-2-fal` | fal | premium | high | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `ideogram-v3-transparent` | fal | premium | high | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `nano-banana-pro-google` | google | premium | high | $0.1500 | $0.2000 | $0.1900 | 20 | ✅ live |
| `nano-banana-pro` | fal | premium | high | $0.1500 | $0.2000 | $0.1900 | 20 | ✅ live |
| `recraft-v4` | fal | premium | high | $0.2500 | $0.3400 | $0.3100 | 34 | ✅ live |

## Video generation

**Unit:** USD per generation. ⚠️ = same ByteDance-needs-verification flag as image.

| Model ID | Provider | Quality | Tier | Provider $/gen | Fiat $/gen | LOAR $/gen | Credits/gen | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `seedance2-t2v` | bytedance | premium | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `seedance2-i2v` | bytedance | premium | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `seedance2-fast-t2v` | bytedance | standard | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `seedance2-fast-i2v` | bytedance | standard | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `seedance2-ref` | bytedance | premium | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `seedance2-fast-ref` | bytedance | standard | low | **$0** ⚠️ | **$0** | **$0** | 0 | ✅ live |
| `cogvideox-flash` | zai | draft | low | **$0** | **$0** | **$0** | 0 | ✅ live |
| `ltx-video` | fal | draft | low | $0.0200 | $0.0300 | $0.0300 | 3 | ✅ live |
| `hunyuan` | fal | draft | low | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `cogvideox` | fal | standard | low | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `wan25-t2v` | fal | standard | medium | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `wan25-i2v` | fal | standard | medium | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `pixverse-v6-t2v` | fal | standard | medium | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `pixverse-v6-i2v` | fal | standard | medium | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `ltx-2` | fal | standard | low | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `kling-t2v` | fal | standard | medium | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `kling-i2v` | fal | standard | medium | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `ltx-2-19b` | fal | standard | low | $0.1200 | $0.1600 | $0.1500 | 16 | ✅ live |
| `kling3-i2v` | fal | premium | high | $0.1500 | $0.2000 | $0.1900 | 20 | ✅ live |
| `viduq1-t2v` | zai | standard | medium | $0.1600 | $0.2200 | $0.2000 | 22 | ✅ live |
| `viduq1-i2v` | zai | standard | medium | $0.1800 | $0.2400 | $0.2200 | 24 | ✅ live |
| `cogvideox-3` | zai | premium | medium | $0.2200 | $0.3000 | $0.2800 | 30 | ✅ live |
| `veo31-t2v` | fal | premium | high | $0.2500 | $0.3400 | $0.3100 | 34 | ✅ live |
| `veo31-i2v` | fal | premium | high | $0.2500 | $0.3400 | $0.3100 | 34 | ✅ live |
| `runway-gen3` | fal | premium | high | $0.2500 | $0.3400 | $0.3100 | 34 | ✅ live |
| `minimax-hailuo-02-t2v` | minimax | standard | medium | $0.2800 | $0.3800 | $0.3500 | 38 | ✅ live |
| `minimax-hailuo-02-i2v` | minimax | standard | medium | $0.2800 | $0.3800 | $0.3500 | 38 | ✅ live |
| `sora2-t2v` | fal | premium | high | $0.3000 | $0.4100 | $0.3800 | 41 | ✅ live |
| `sora2-i2v` | fal | premium | high | $0.3000 | $0.4100 | $0.3800 | 41 | ✅ live |
| `seedance-2-0-fast-t2v` | bytedance | standard | low | $0.3000 | $0.4100 | $0.3800 | 41 | ✅ live |
| `seedance-2-0-fast-i2v` | bytedance | standard | low | $0.3000 | $0.4100 | $0.3800 | 41 | ✅ live |
| `veo31-lite-t2v` | fal | standard | low | $0.4000 | $0.5400 | $0.5000 | 54 | ✅ live |
| `veo31-lite-i2v` | fal | standard | low | $0.4000 | $0.5400 | $0.5000 | 54 | ✅ live |
| `pixverse-v6-i2v` | fal | standard | medium | $0.4000 | $0.5400 | $0.5000 | 54 | ✅ live |
| `wan27-t2v` | fal | standard | medium | $0.5000 | $0.6800 | $0.6300 | 68 | ✅ live |
| `wan27-i2v` | fal | standard | medium | $0.5000 | $0.6800 | $0.6300 | 68 | ✅ live |
| `veo-31-lite-preview-google` | google | standard | low | $0.6000 | $0.8100 | $0.7500 | 81 | ✅ live |
| `seedance-2-0-std-t2v` | bytedance | premium | medium | $0.7000 | $0.9500 | $0.8800 | 95 | ✅ live |
| `seedance-2-0-std-i2v` | bytedance | premium | medium | $0.7000 | $0.9500 | $0.8800 | 95 | ✅ live |
| `sora-2-openai` | openai | premium | medium | $0.8000 | $1.0800 | $1.0000 | 108 | ✅ live |
| `happy-horse-t2v` | fal | premium | medium | $0.8000 | $1.0800 | $1.0000 | 108 | ✅ live |
| `happy-horse-i2v` | fal | premium | medium | $0.8000 | $1.0800 | $1.0000 | 108 | ✅ live |
| `veo-31-fast-preview-google` | google | premium | medium | $0.9000 | $1.2200 | $1.1300 | 122 | ✅ live |
| `seedance-2-0-fal-t2v` | fal | premium | medium | $1.0500 | $1.4200 | $1.3100 | 142 | 🔒 hidden |
| `seedance-2-0-fal-i2v` | fal | premium | medium | $1.0500 | $1.4200 | $1.3100 | 142 | 🔒 hidden |
| `veo-30-fast-google` | google | standard | medium | $1.2000 | $1.6200 | $1.5000 | 162 | ✅ live |
| `kling-v3-pro-t2v` | fal | premium | high | $1.6000 | $2.1600 | $2.0000 | 216 | ✅ live |
| `kling-v3-pro-i2v` | fal | premium | high | $1.6000 | $2.1600 | $2.0000 | 216 | ✅ live |
| `veo-20-google` | google | standard | medium | $2.1000 | $2.8400 | $2.6300 | 284 | 🔒 hidden |
| `sora2-pro-t2v` | fal | premium | high | $2.4000 | $3.2400 | $3.0000 | 324 | ✅ live |
| `sora2-pro-i2v` | fal | premium | high | $2.4000 | $3.2400 | $3.0000 | 324 | ✅ live |
| `veo-31-preview-google` | google | premium | high | $2.4000 | $3.2400 | $3.0000 | 324 | ✅ live |
| `veo-30-google` | google | premium | high | $2.4000 | $3.2400 | $3.0000 | 324 | ✅ live |
| `veo-31-fal` | fal | premium | high | $2.4000 | $3.2400 | $3.0000 | 324 | 🔒 hidden |
| `kling-v3-4k-t2v` | fal | premium | high | $3.0000 | $4.0500 | $3.7500 | 405 | ✅ live |
| `kling-v3-4k-i2v` | fal | premium | high | $3.0000 | $4.0500 | $3.7500 | 405 | ✅ live |
| `veo31-std-t2v` | fal | premium | high | $3.2000 | $4.3200 | $4.0000 | 432 | ✅ live |
| `veo31-std-i2v` | fal | premium | high | $3.2000 | $4.3200 | $4.0000 | 432 | ✅ live |
| `sora-2-pro-openai` | openai | premium | high | $4.0000 | $5.4000 | $5.0000 | 540 | ✅ live |

## Text-to-Speech (TTS)

**Unit:** USD per 1M characters.

| Model ID | Provider | Quality | Tier | Provider $/Mchar | Fiat $/Mchar | LOAR $/Mchar | Credits/1k chars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `seed-tts-1-0` | bytedance | standard | low | $5 | $6.75 | $6.25 | 1 | 🔒 hidden |
| `seed-tts-2-0` | bytedance | premium | low | $7 | $9.45 | $8.75 | 1 | ✅ live |
| `glm-tts` | zai | premium | low | $8 | $10.8 | $10 | 1 | ✅ live |
| `gemini-25-flash-tts` | google | premium | low | $10 | $13.5 | $12.5 | 1 | ✅ live |
| `gpt-4o-mini-tts` | openai | premium | low | $12 | $16.2 | $15 | 2 | ✅ live |
| `tts-1` | openai | standard | low | $15 | $20.25 | $18.75 | 2 | 🔒 hidden |
| `gemini-25-pro-tts` | google | premium | high | $20 | $27 | $25 | 2 | ✅ live |
| `gemini-31-flash-tts` | google | premium | high | $20 | $27 | $25 | 2 | ✅ live |
| `orpheus-v1-en-groq` | groq | standard | medium | $22 | $29.7 | $27.5 | 3 | ✅ live |
| `minimax-speech-28-hd-fal` | fal | premium | medium | $25 | $33.75 | $31.25 | 3 | ✅ live |
| `tts-1-hd` | openai | premium | medium | $30 | $40.5 | $37.5 | 3 | ✅ live |
| `aura-2-deepgram` | deepgram | standard | medium | $30 | $40.5 | $37.5 | 3 | ✅ live |
| `playai-tts-groq` | groq | standard | high | $50 | $67.5 | $62.5 | 5 | 🔒 hidden |
| `eleven-flash-v25` | elevenlabs | standard | medium | $103 | $139.05 | $128.75 | 11 | ✅ live |
| `eleven-turbo-v25` | elevenlabs | standard | medium | $110 | $148.5 | $137.5 | 11 | ✅ live |
| `eleven-multilingual-v2` | elevenlabs | premium | high | $165 | $222.75 | $206.25 | 17 | ✅ live |
| `eleven-v3` | elevenlabs | premium | high | $206 | $278.1 | $257.5 | 21 | ✅ live |

## Transcription (speech-to-text)

**Unit:** USD per minute of audio.

| Model ID | Provider | Quality | Tier | Provider $/min | Fiat $/min | LOAR $/min | Credits/min | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `distil-whisper-large-v3-en-groq` | groq | standard | low | $0.000333 | $0 | $0 | 0 | ✅ live |
| `whisper-large-v3-turbo-groq` | groq | standard | low | $0.000667 | $0 | $0 | 0 | ✅ live |
| `whisper-large-v3-groq` | groq | standard | low | $0.0011 | $0 | $0 | 0 | ✅ live |
| `nano-assemblyai` | assemblyai | draft | low | $0.002 | $0 | $0 | 0 | ✅ live |
| `glm-asr-2512-zai` | zai | premium | low | $0.002 | $0 | $0 | 0 | ✅ live |
| `gpt-4o-mini-transcribe-openai` | openai | standard | low | $0.003 | $0 | $0 | 0 | ✅ live |
| `nova-3-deepgram` | deepgram | premium | low | $0.0043 | $0.01 | $0.01 | 1 | ✅ live |
| `nova-2-deepgram` | deepgram | standard | low | $0.0043 | $0.01 | $0.01 | 1 | 🔒 hidden |
| `slam-1-assemblyai` | assemblyai | premium | medium | $0.0045 | $0.01 | $0.01 | 1 | ✅ live |
| `whisper-cloud-deepgram` | deepgram | standard | low | $0.0048 | $0.01 | $0.01 | 1 | 🔒 hidden |
| `gpt-4o-transcribe-openai` | openai | premium | medium | $0.006 | $0.01 | $0.01 | 1 | ✅ live |
| `gpt-4o-transcribe-diarize-openai` | openai | premium | medium | $0.006 | $0.01 | $0.01 | 1 | ✅ live |
| `whisper-1-openai` | openai | standard | medium | $0.006 | $0.01 | $0.01 | 1 | 🔒 hidden |
| `nova-3-medical-deepgram` | deepgram | premium | medium | $0.0077 | $0.01 | $0.01 | 1 | 🔒 hidden |
| `nova-3-multilingual-deepgram` | deepgram | premium | medium | $0.0092 | $0.01 | $0.01 | 1 | ✅ live |
| `whisper-fal` | fal | standard | low | $0.012 | $0.02 | $0.02 | 2 | ✅ live |
| `universal-2-assemblyai` | assemblyai | premium | medium | $0.0145 | $0.02 | $0.02 | 2 | ✅ live |

## 3D generation

**Unit:** USD per generation.

| Model ID | Provider | Quality | Tier | Provider $/gen | Fiat $/gen | LOAR $/gen | Credits/gen | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `meshy-animation` | meshy | standard |  | $0.0600 | $0.0800 | $0.0800 | 8 | ✅ live |
| `meshy-remesh` | meshy | standard |  | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `meshy-rigging` | meshy | standard |  | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `meshy-text-to-3d-preview` | meshy | standard |  | $0.2000 | $0.2700 | $0.2500 | 27 | ✅ live |
| `meshy-text-to-3d-refine` | meshy | premium |  | $0.2000 | $0.2700 | $0.2500 | 27 | ✅ live |
| `meshy-retexture` | meshy | standard |  | $0.2000 | $0.2700 | $0.2500 | 27 | ✅ live |
| `pixal-3d-fal` | fal | standard |  | $0.4000 | $0.5400 | $0.5000 | 54 | ✅ live |
| `hunyuan-3d-text-fal` | fal | standard |  | $0.5000 | $0.6800 | $0.6300 | 68 | ✅ live |
| `meshy-image-to-3d` | meshy | premium |  | $0.6000 | $0.8100 | $0.7500 | 81 | ✅ live |
| `meshy-multi-image-to-3d` | meshy | premium |  | $0.6000 | $0.8100 | $0.7500 | 81 | ✅ live |
| `meshy-v6-multi-image-fal` | fal | premium |  | $0.8000 | $1.0800 | $1.0000 | 108 | 🔒 hidden |

## Audio / music generation

**Unit:** USD per generation.

| Model ID | Provider | Quality | Tier | Provider $/gen | Fiat $/gen | LOAR $/gen | Credits/gen | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ace-step-fal` | fal | standard | low | $0.0120 | $0.0200 | $0.0200 | 2 | ✅ live |
| `musicgen-large` | fal | standard | low | $0.0200 | $0.0300 | $0.0300 | 3 | ✅ live |
| `cassetteai-music` | fal | standard | low | $0.0200 | $0.0300 | $0.0300 | 3 | ✅ live |
| `musicgen-stereo-large` | fal | standard | low | $0.0300 | $0.0400 | $0.0400 | 4 | ✅ live |
| `minimax-music-v2` | fal | premium | low | $0.0300 | $0.0400 | $0.0400 | 4 | ✅ live |
| `stable-audio-2` | fal | premium | medium | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `minimax-music-v25` | fal | premium | low | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `lyria-3-clip-google` | google | premium | low | $0.0400 | $0.0500 | $0.0500 | 5 | ✅ live |
| `minimax-music-v26` | fal | premium | medium | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `pixverse-sfx-fal` | fal | standard | low | $0.0500 | $0.0700 | $0.0600 | 8 | ✅ live |
| `sonauto-v2` | fal | premium | medium | $0.0750 | $0.1000 | $0.0900 | 10 | ✅ live |
| `lyria-3-pro-google` | google | premium | low | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `elevenlabs-sfx-direct` | elevenlabs | premium | medium | $0.0800 | $0.1100 | $0.1000 | 11 | ✅ live |
| `lyria-2-fal` | fal | premium | medium | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `beatoven-music` | fal | standard | low | $0.1000 | $0.1400 | $0.1300 | 15 | ✅ live |
| `controlfoley-fal` | fal | premium | medium | $0.1200 | $0.1600 | $0.1500 | 16 | ✅ live |
| `stable-audio-25` | fal | premium | medium | $0.2000 | $0.2700 | $0.2500 | 27 | ✅ live |
| `stable-audio-25-a2a` | fal | premium | medium | $0.2000 | $0.2700 | $0.2500 | 27 | ✅ live |
| `elevenlabs-music-direct` | elevenlabs | premium | high | $0.4000 | $0.5400 | $0.5000 | 54 | ✅ live |
| `elevenlabs-music-fal` | fal | premium | high | $0.8000 | $1.0800 | $1.0000 | 108 | ✅ live |

## Image / video editing (relight, lipsync, inpaint, …)

**Unit:** USD per operation. Routing here is task-based (no tier columns).

| Model ID | Provider | Provider $/op | Fiat $/op | LOAR $/op | Credits/op | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `inpaint-eraser` | fal | $0.0050 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `remove-bg-birefnet` | fal | $0.0050 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `interpolate-rife` | fal | $0.0050 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `remove-bg-birefnet-v2` | fal | $0.0050 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `upscale-esrgan` | fal | $0.0100 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `interpolate-amt` | fal | $0.0100 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `remove-bg-bria` | fal | $0.0100 | $0.0100 | $0.0100 | 1 | 🔒 hidden |
| `interpolate-film` | fal | $0.0200 | $0.0300 | $0.0300 | 3 | 🔒 hidden |
| `inpaint-flux` | fal | $0.0200 | $0.0300 | $0.0300 | 3 | 🔒 hidden |
| `upscale-seedvr2-image` | fal | $0.0200 | $0.0300 | $0.0300 | 3 | 🔒 hidden |
| `inpaint-bria-eraser` | fal | $0.0200 | $0.0300 | $0.0300 | 3 | 🔒 hidden |
| `inpaint-finegrain-eraser` | fal | $0.0300 | $0.0400 | $0.0400 | 4 | 🔒 hidden |
| `upscale-clarity` | fal | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `relight-nano-banana` | fal | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `retexture-nano-banana` | fal | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `upscale-topaz-image` | fal | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `lipsync-pixverse` | fal | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `relight-bria-fibo` | fal | $0.0400 | $0.0500 | $0.0500 | 5 | 🔒 hidden |
| `upscale-creative` | fal | $0.0500 | $0.0700 | $0.0600 | 8 | 🔒 hidden |
| `upscale-flashvsr` | fal | $0.0500 | $0.0700 | $0.0600 | 8 | 🔒 hidden |
| `remove-bg-veed-video` | fal | $0.0500 | $0.0700 | $0.0600 | 8 | 🔒 hidden |
| `extend-ltx-2` | fal | $0.0500 | $0.0700 | $0.0600 | 8 | 🔒 hidden |
| `lipsync-kling-a2v` | fal | $0.0600 | $0.0800 | $0.0800 | 8 | 🔒 hidden |
| `restyle-wan-v2v` | fal | $0.0800 | $0.1100 | $0.1000 | 11 | 🔒 hidden |
| `extend-wan` | fal | $0.0800 | $0.1100 | $0.1000 | 11 | 🔒 hidden |
| `lipsync-sync-v3` | fal | $0.0800 | $0.1100 | $0.1000 | 11 | 🔒 hidden |
| `remove-bg-bria-video` | fal | $0.0800 | $0.1100 | $0.1000 | 11 | 🔒 hidden |
| `relight-lightx` | fal | $0.0800 | $0.1100 | $0.1000 | 11 | 🔒 hidden |
| `upscale-seedvr2-video` | fal | $0.1000 | $0.1400 | $0.1300 | 15 | 🔒 hidden |
| `inpaint-bria-video-eraser` | fal | $0.1000 | $0.1400 | $0.1300 | 15 | 🔒 hidden |
| `relight-recamera-lightx` | fal | $0.1000 | $0.1400 | $0.1300 | 15 | 🔒 hidden |
| `lipsync-heygen-v3` | fal | $0.1200 | $0.1600 | $0.1500 | 16 | 🔒 hidden |
| `restyle-kling-v2v` | fal | $0.1500 | $0.2000 | $0.1900 | 20 | 🔒 hidden |
| `upscale-topaz-video` | fal | $0.2000 | $0.2700 | $0.2500 | 27 | 🔒 hidden |
| `extend-pixverse` | fal | $0.2000 | $0.2700 | $0.2500 | 27 | 🔒 hidden |
| `upscale-bria-video-8k` | fal | $0.3000 | $0.4100 | $0.3800 | 41 | 🔒 hidden |
| `extend-veo-31` | fal | $0.8000 | $1.0800 | $1.0000 | 108 | 🔒 hidden |

---

## Totals

| Registry | Total models | Enabled |
| --- | --- | --- |
| LLM | 30 | 30 |
| Image | 44 | 43 |
| Video | 59 | 59 |
| TTS | 17 | 17 |
| Transcription | 17 | 17 |
| 3D | 11 | 11 |
| Audio | 20 | 20 |
| Editing | 37 | 37 |
| **TOTAL** | **235** | **234** |

_End of generated document._
