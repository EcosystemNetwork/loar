/**
 * Generates `docs/pricing.md` from the live model registries.
 *
 * Single source of truth for every model's USD-per-unit cost (what we pay
 * the provider) + fiat price (what users pay in card/crypto) + credit
 * price (what users pay in $LOAR). Re-run anytime a registry changes:
 *
 *   tsx scripts/generate-pricing-doc.ts
 *
 * Read-only: imports the registries directly, writes a single markdown file.
 * Add to CI to fail builds if the committed doc drifts from the registries.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { LLM_MODELS } from '../apps/server/src/services/llm-models/registry';
import { IMAGE_MODELS } from '../apps/server/src/services/image-models/registry';
import { VIDEO_MODELS } from '../apps/server/src/services/video-models/registry';
import { TTS_MODELS } from '../apps/server/src/services/tts-models/registry';
import { TRANSCRIPTION_MODELS } from '../apps/server/src/services/transcription-models/registry';
import { THREED_MODELS } from '../apps/server/src/services/threed-models/registry';
import { AUDIO_MODELS } from '../apps/server/src/services/audio-models/registry';
import { EDITING_MODELS } from '../apps/server/src/services/editing-models/registry';
import {
  FIAT_MARGIN,
  LOAR_MARGIN,
  LOAR_TO_USD,
} from '../apps/server/src/services/video-models/registry';

const OUT_PATH = path.resolve(__dirname, '..', 'docs', 'pricing.md');

function fmtUsd(n: number, places = 6): string {
  if (n === 0) return '**$0**';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(places).replace(/\.?0+$/, '')}`;
}

function fmtCents(n: number): string {
  if (n === 0) return '**$0**';
  return `$${n.toFixed(4)}`;
}

function statusBadge(enabled: boolean, visible: boolean): string {
  if (!enabled) return '🚫 disabled';
  if (!visible) return '🔒 hidden';
  return '✅ live';
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---').join(' | ');
  const head = headers.join(' | ');
  const body = rows.map((r) => r.join(' | ')).join('\n');
  return `| ${head} |\n| ${sep} |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
}

function bytedanceFlag(provider: string, cost: number): string {
  if (provider === 'bytedance' && cost === 0) return ' ⚠️';
  return '';
}

// ── Section builders ──────────────────────────────────────────────────────

function buildLlmSection(): string {
  const rows = [...LLM_MODELS]
    .sort((a, b) => a.providerInputUsdPerMtok - b.providerInputUsdPerMtok)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      fmtUsd(m.providerInputUsdPerMtok),
      fmtUsd(m.providerCachedInputUsdPerMtok),
      fmtUsd(m.providerOutputUsdPerMtok),
      fmtUsd(m.fiatInputUsdPerMtok),
      fmtUsd(m.fiatOutputUsdPerMtok),
      String(m.creditCostPer1kInputTokens),
      String(m.creditCostPer1kOutputTokens),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## LLM (chat, reasoning, vision)',
    '',
    `**Unit:** USD per 1M tokens. Sorted by input cost (cheapest first).`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/Mtok in',
        'Cached $/Mtok',
        'Provider $/Mtok out',
        'Fiat $/Mtok in',
        'Fiat $/Mtok out',
        'Credits/1k in',
        'Credits/1k out',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildImageSection(): string {
  const rows = [...IMAGE_MODELS]
    .sort((a, b) => a.providerCostUsd - b.providerCostUsd)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      `${fmtCents(m.providerCostUsd)}${bytedanceFlag(m.provider, m.providerCostUsd)}`,
      fmtCents(m.fiatPriceUsd),
      fmtCents(m.loarPriceUsd),
      String(m.creditCostPerImage),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## Image generation',
    '',
    `**Unit:** USD per image. Entries marked ⚠️ are ByteDance models with $0 logged cost — see boot warning + Volces dashboard verification task.`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/img',
        'Fiat $/img',
        'LOAR $/img',
        'Credits/img',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildVideoSection(): string {
  const rows = [...VIDEO_MODELS]
    .sort((a, b) => a.providerCostUsd - b.providerCostUsd)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      `${fmtCents(m.providerCostUsd)}${bytedanceFlag(m.provider, m.providerCostUsd)}`,
      fmtCents(m.fiatPriceUsd),
      fmtCents(m.loarPriceUsd),
      String(m.creditCost),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## Video generation',
    '',
    `**Unit:** USD per generation. ⚠️ = same ByteDance-needs-verification flag as image.`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/gen',
        'Fiat $/gen',
        'LOAR $/gen',
        'Credits/gen',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildTtsSection(): string {
  const rows = [...TTS_MODELS]
    .sort((a, b) => a.providerCostUsdPerMillionChars - b.providerCostUsdPerMillionChars)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      `$${m.providerCostUsdPerMillionChars}`,
      `$${m.fiatPriceUsdPerMillionChars}`,
      `$${m.loarPriceUsdPerMillionChars}`,
      String(m.creditCostPer1kChars),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## Text-to-Speech (TTS)',
    '',
    `**Unit:** USD per 1M characters.`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/Mchar',
        'Fiat $/Mchar',
        'LOAR $/Mchar',
        'Credits/1k chars',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildTranscriptionSection(): string {
  const rows = [...TRANSCRIPTION_MODELS]
    .sort((a, b) => a.providerCostUsdPerMinute - b.providerCostUsdPerMinute)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      `$${m.providerCostUsdPerMinute.toFixed(6).replace(/\.?0+$/, '')}`,
      `$${m.fiatPriceUsdPerMinute.toFixed(6).replace(/\.?0+$/, '')}`,
      `$${m.loarPriceUsdPerMinute.toFixed(6).replace(/\.?0+$/, '')}`,
      String(m.creditCostPerMinute),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## Transcription (speech-to-text)',
    '',
    `**Unit:** USD per minute of audio.`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/min',
        'Fiat $/min',
        'LOAR $/min',
        'Credits/min',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildThreedSection(): string {
  const rows = [...THREED_MODELS]
    .sort((a, b) => a.providerCostUsd - b.providerCostUsd)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      fmtCents(m.providerCostUsd),
      fmtCents(m.fiatPriceUsd),
      fmtCents(m.loarPriceUsd),
      String(m.creditCost),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## 3D generation',
    '',
    `**Unit:** USD per generation.`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/gen',
        'Fiat $/gen',
        'LOAR $/gen',
        'Credits/gen',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildAudioSection(): string {
  const rows = [...AUDIO_MODELS]
    .sort((a, b) => a.providerCostUsd - b.providerCostUsd)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      m.qualityTier,
      m.priceTier,
      fmtCents(m.providerCostUsd),
      fmtCents(m.fiatPriceUsd),
      fmtCents(m.loarPriceUsd),
      String(m.creditCost),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## Audio / music generation',
    '',
    `**Unit:** USD per generation.`,
    '',
    table(
      [
        'Model ID',
        'Provider',
        'Quality',
        'Tier',
        'Provider $/gen',
        'Fiat $/gen',
        'LOAR $/gen',
        'Credits/gen',
        'Status',
      ],
      rows
    ),
  ].join('\n');
}

function buildEditingSection(): string {
  // EDITING_MODELS doesn't carry qualityTier/priceTier — its routing is
  // task-based (relight vs lipsync vs upscale), not tier-based.
  const rows = [...EDITING_MODELS]
    .sort((a, b) => a.providerCostUsd - b.providerCostUsd)
    .map((m) => [
      `\`${m.id}\``,
      m.provider,
      fmtCents(m.providerCostUsd),
      fmtCents(m.fiatPriceUsd),
      fmtCents(m.loarPriceUsd),
      String(m.creditCost),
      statusBadge(m.isEnabled, m.isVisibleToUsers),
    ]);
  return [
    '## Image / video editing (relight, lipsync, inpaint, …)',
    '',
    `**Unit:** USD per operation. Routing here is task-based (no tier columns).`,
    '',
    table(
      ['Model ID', 'Provider', 'Provider $/op', 'Fiat $/op', 'LOAR $/op', 'Credits/op', 'Status'],
      rows
    ),
  ].join('\n');
}

// ── Top-level structure ──────────────────────────────────────────────────

function buildDoc(): string {
  const today = new Date().toISOString().slice(0, 10);
  const sections = [
    `# Model Pricing`,
    '',
    `> Auto-generated from registries under \`apps/server/src/services/*-models/registry.ts\`.`,
    `> Regenerate with \`tsx scripts/generate-pricing-doc.ts\`.`,
    `> Generated: **${today}**`,
    '',
    '## How to read this',
    '',
    `- **Provider $** — what LOAR pays the upstream provider (OpenAI, Google, ByteDance, etc.) per unit.`,
    `- **Fiat $** — what end-users pay when settling in card/crypto. Computed as \`provider × FIAT_MARGIN\`.`,
    `- **LOAR $** — what end-users pay in $LOAR token. Computed as \`provider × LOAR_MARGIN\`.`,
    `- **Credits** — internal credit units consumed for the call. Conversion: \`1 credit = $${LOAR_TO_USD}\`.`,
    `- **Quality** — registry-declared tier: \`draft\` < \`standard\` < \`premium\`. The router's \`qualityTarget\` floor uses this.`,
    `- **Tier** (priceTier) — relative cost bucket the router uses when \`costBudget: 'low' | 'medium' | 'any'\`. Within a tier, the router tiebreaks by exact \`Provider $/Mtok in\`.`,
    `- **Status** — ✅ live (enabled + visible), 🔒 hidden (enabled but hidden from end users — internal/admin only), 🚫 disabled.`,
    '',
    '## Margin constants',
    '',
    `| Constant | Value | Meaning |`,
    `| --- | --- | --- |`,
    `| \`FIAT_MARGIN\` | ${FIAT_MARGIN} | Multiplier applied to provider cost for card/crypto pricing |`,
    `| \`LOAR_MARGIN\` | ${LOAR_MARGIN} | Multiplier applied to provider cost for $LOAR pricing (cheaper to incentivize token use) |`,
    `| \`LOAR_TO_USD\` | $${LOAR_TO_USD} | Implied USD value of one credit, used when computing credit costs from USD |`,
    '',
    '## ByteDance $0-cost warning',
    '',
    `Entries marked ⚠️ have \`providerCostUsd: 0\` in the registry. Since ByteDance Volces is a paid API, this means we are billed by ByteDance but not tracking it in our cost ledger. Boot warning lives in \`apps/server/src/lib/pricing-audit.ts\`. Fix by looking up the real per-call price on the Volces dashboard and patching the registry.`,
    '',
    '## Keeping these numbers honest',
    '',
    `Provider list prices change ~quarterly (OpenAI/Google/Anthropic) to ~monthly (ByteDance/Z.AI). Rather than scraping their pricing pages, we reconcile against the real bill:`,
    '',
    `1. **Boot audit** — \`apps/server/src/lib/pricing-audit.ts\` flags any \`isEnabled && providerCostUsd: 0\` model on every server boot. Loudest for ByteDance.`,
    `2. **Daily cost-drift detector** — \`.github/workflows/cost-drift.yml\` compares trailing-7d per-model \`$/1k-token\` (or \`$/call\` for non-token providers) against the prior 7d. Opens a GitHub issue when any model drifts beyond ±5%. Catches provider rate changes within 24h of impact. Run locally: \`pnpm cost:check-drift\`.`,
    `3. **Weekly staleness check** — every Monday \`.github/workflows/pricing-staleness.yml\` opens a GitHub issue for any registry untouched for >90 days (configurable). Issue auto-closes when all are fresh. Run locally: \`pnpm registry:check-staleness\`.`,
    `4. **Monthly spend reconciliation** — \`pnpm reconcile:spend --invoice=./invoices/YYYY-MM.json\` reads the \`costLedger\` aggregates for the period, compares them to actual invoiced amounts (from each provider's dashboard), and exits non-zero if any provider drifts beyond ±3%. Invoice template: [\`scripts/invoice-template.json\`](../scripts/invoice-template.json).`,
    `5. **CI doc-drift gate** — the \`quality\` job in \`.github/workflows/ci.yml\` regenerates this doc and fails the build if a registry change wasn't accompanied by \`pnpm docs:pricing\`.`,
    '',
    `Five layers, five failure modes: entry never tracked (boot), prices fluctuated and we didn't notice (daily drift), no one verified a registry in months (weekly), provider's invoice diverges from our ledger (monthly), registry edit slipped past the docs (CI gate).`,
    '',
    `**Ops runbook:** [docs/ops-pricing-integrity.md](ops-pricing-integrity.md) — credential setup, IAM roles, threshold tuning, what to do when each alert fires, secret rotation. Run \`pnpm ops:firebase-doctor\` first when something looks wrong; it pings Firestore and prints actionable hints (rotated key? wrong project? Firestore API disabled?) before the real audit fires.`,
    '',
    '---',
    '',
    buildLlmSection(),
    '',
    buildImageSection(),
    '',
    buildVideoSection(),
    '',
    buildTtsSection(),
    '',
    buildTranscriptionSection(),
    '',
    buildThreedSection(),
    '',
    buildAudioSection(),
    '',
    buildEditingSection(),
    '',
    '---',
    '',
    '## Totals',
    '',
    summaryStats(),
    '',
    `_End of generated document._`,
  ];
  return sections.join('\n') + '\n';
}

function summaryStats(): string {
  const counts = [
    {
      name: 'LLM',
      total: LLM_MODELS.length,
      enabled: LLM_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: 'Image',
      total: IMAGE_MODELS.length,
      enabled: IMAGE_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: 'Video',
      total: VIDEO_MODELS.length,
      enabled: VIDEO_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: 'TTS',
      total: TTS_MODELS.length,
      enabled: TTS_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: 'Transcription',
      total: TRANSCRIPTION_MODELS.length,
      enabled: TRANSCRIPTION_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: '3D',
      total: THREED_MODELS.length,
      enabled: THREED_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: 'Audio',
      total: AUDIO_MODELS.length,
      enabled: AUDIO_MODELS.filter((m) => m.isEnabled).length,
    },
    {
      name: 'Editing',
      total: EDITING_MODELS.length,
      enabled: EDITING_MODELS.filter((m) => m.isEnabled).length,
    },
  ];
  const totalAll = counts.reduce((a, b) => a + b.total, 0);
  const enabledAll = counts.reduce((a, b) => a + b.enabled, 0);
  const rows = counts.map((c) => [c.name, String(c.total), String(c.enabled)]);
  rows.push(['**TOTAL**', `**${totalAll}**`, `**${enabledAll}**`]);
  return table(['Registry', 'Total models', 'Enabled'], rows);
}

function main(): void {
  const doc = buildDoc();
  writeFileSync(OUT_PATH, doc, 'utf8');
  console.log(`Wrote ${OUT_PATH} (${doc.length} bytes)`);
}

main();
