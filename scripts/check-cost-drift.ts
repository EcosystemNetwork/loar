/**
 * Per-model cost-drift detector.
 *
 * Reads daily aggregates from `costAggregates` (scope=model), compares the
 * trailing N days to the prior N days, and flags any (provider, model)
 * whose cost-per-1k-tokens (or cost-per-call for non-token providers)
 * shifted by more than the threshold. Catches:
 *
 *   - Provider quietly changed list pricing                     (cost/tok up)
 *   - Model rev produces more output tokens per request          (cost/call up)
 *   - Registry mispriced an entry and a fix landed               (cost/tok jumps)
 *   - Model deprecated and silently routes to a more expensive one (anomaly)
 *
 * Why per-1k-tokens and not just per-call: per-call is sensitive to prompt
 * length shifts (longer user inputs → higher cost) which aren't pricing
 * fluctuations. Per-1k-tok normalizes for that. For image / video / TTS we
 * fall back to per-call since their billing units aren't tokens.
 *
 * Usage:
 *
 *   pnpm cost:check-drift                       # 7d vs prior 7d, 5% threshold
 *   pnpm cost:check-drift --window=14 --baseline=14 --threshold=0.10
 *   pnpm cost:check-drift --json                # for the GH Action
 *   pnpm cost:check-drift --min-calls=100       # ignore low-volume models
 *
 * Exit codes:
 *   0 — no drift beyond threshold
 *   1 — at least one model drifted → review and possibly patch registry
 *   2 — usage / setup error
 */
import dotenv from 'dotenv';
import path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from './lib/firebase-admin';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── CLI ────────────────────────────────────────────────────────────────────

// Provider-specific drift thresholds. ByteDance/Volces and Z.AI change list
// pricing on a monthly cadence; tighter 3% threshold gives early warning
// there. Everyone else uses the global threshold (default 5%).
const PROVIDER_THRESHOLD_OVERRIDES: Record<string, number> = {
  bytedance: 0.03,
  zai: 0.03,
};

// $/1k-token is a low-variance metric (normalized for prompt size) and
// stabilizes with a larger sample. $/call is per-request and can drift on
// any single outlier, so keep its floor lower.
const MIN_CALLS_PER_1K_TOK = 100;
const MIN_CALLS_PER_CALL = 50;

interface CliArgs {
  windowDays: number;
  baselineDays: number;
  threshold: number;
  /** When set, overrides BOTH metric floors (back-compat single knob). */
  minCallsOverride: number | null;
  /** Per-provider threshold overrides parsed from --provider-thresholds. */
  providerThresholds: Record<string, number>;
  json: boolean;
  serviceAccountPath: string | null;
}

function parseProviderThresholds(raw: string | undefined): Record<string, number> {
  // Format: "bytedance=0.03,zai=0.03,openai=0.07"
  // Falls back to PROVIDER_THRESHOLD_OVERRIDES when no flag given.
  if (!raw) return { ...PROVIDER_THRESHOLD_OVERRIDES };
  const out: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=').map((s) => s.trim());
    if (!k || !v) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 1) out[k] = n;
  }
  return out;
}

function parseArgs(): CliArgs {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1], m[2] ?? 'true');
  }
  const num = (k: string, d: number, opts: { min?: number; max?: number } = {}): number => {
    const raw = args.get(k);
    if (raw === undefined) return d;
    const n = Number(raw);
    if (!Number.isFinite(n)) return d;
    if (opts.min !== undefined && n < opts.min) return opts.min;
    if (opts.max !== undefined && n > opts.max) return opts.max;
    return n;
  };
  const minCallsArg = args.get('min-calls');
  return {
    windowDays: Math.floor(num('window', 7, { min: 1, max: 90 })),
    baselineDays: Math.floor(num('baseline', 7, { min: 1, max: 90 })),
    threshold: num('threshold', 0.05, { min: 0, max: 1 }),
    minCallsOverride: minCallsArg ? Math.floor(num('min-calls', 0, { min: 1 })) : null,
    providerThresholds: parseProviderThresholds(args.get('provider-thresholds')),
    json: args.get('json') === 'true',
    serviceAccountPath: args.get('service-account') ?? null,
  };
}

function thresholdFor(provider: string, args: CliArgs): number {
  return args.providerThresholds[provider] ?? args.threshold;
}

function minCallsFor(kind: 'cost_per_1k_tokens' | 'cost_per_call', args: CliArgs): number {
  if (args.minCallsOverride !== null) return args.minCallsOverride;
  return kind === 'cost_per_1k_tokens' ? MIN_CALLS_PER_1K_TOK : MIN_CALLS_PER_CALL;
}

// ── Firebase ───────────────────────────────────────────────────────────────
// Resolution order is centralized in scripts/lib/firebase-admin.ts.

// ── Date helpers ──────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInRange(end: Date, count: number): string[] {
  // Returns `count` day keys ending at `end` (inclusive), newest first.
  const out: string[] = [];
  const cursor = new Date(end);
  for (let i = 0; i < count; i++) {
    out.push(dayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

// ── Aggregate pull ────────────────────────────────────────────────────────

interface DailyModelStat {
  day: string;
  provider: string;
  model: string;
  costUsd: number;
  calls: number;
  tokensUsed: number;
}

async function pullDailyAggregates(db: Firestore, days: string[]): Promise<DailyModelStat[]> {
  // Firestore `in` query caps at 30 values — chunk if needed.
  const out: DailyModelStat[] = [];
  for (let i = 0; i < days.length; i += 10) {
    const chunk = days.slice(i, i + 10);
    const snap = await db
      .collection('costAggregates')
      .where('scope', '==', 'model')
      .where('period', 'in', chunk)
      .get();
    for (const d of snap.docs) {
      const data = d.data();
      const key = String(data.key ?? '');
      const [provider, ...modelParts] = key.split(':');
      const model = modelParts.join(':');
      if (!provider || !model) continue;
      out.push({
        day: String(data.period ?? d.id.split('__')[0] ?? ''),
        provider,
        model,
        costUsd: Number(data.costUsd ?? 0),
        calls: Number(data.calls ?? 0),
        tokensUsed: Number(data.tokensUsed ?? 0),
      });
    }
  }
  return out;
}

// ── Drift analysis ────────────────────────────────────────────────────────

interface WindowStats {
  costUsd: number;
  calls: number;
  tokensUsed: number;
  costPerCall: number;
  costPer1kTokens: number | null;
}

function summarize(rows: DailyModelStat[]): WindowStats {
  let costUsd = 0;
  let calls = 0;
  let tokensUsed = 0;
  for (const r of rows) {
    costUsd += r.costUsd;
    calls += r.calls;
    tokensUsed += r.tokensUsed;
  }
  return {
    costUsd,
    calls,
    tokensUsed,
    costPerCall: calls > 0 ? costUsd / calls : 0,
    costPer1kTokens: tokensUsed > 0 ? (costUsd / tokensUsed) * 1000 : null,
  };
}

type DriftKind = 'cost_per_1k_tokens' | 'cost_per_call';

interface DriftRow {
  provider: string;
  model: string;
  baseline: WindowStats;
  current: WindowStats;
  baselineDays: string[];
  currentDays: string[];
  kind: DriftKind;
  baselineValue: number;
  currentValue: number;
  driftPct: number;
  flagged: boolean;
}

function buildDriftRows(
  current: DailyModelStat[],
  baseline: DailyModelStat[],
  currentDays: string[],
  baselineDays: string[],
  args: CliArgs
): DriftRow[] {
  // Group by (provider, model).
  const groupKey = (r: DailyModelStat) => `${r.provider}:${r.model}`;
  const byModel = new Map<string, { cur: DailyModelStat[]; base: DailyModelStat[] }>();
  for (const r of current) {
    const k = groupKey(r);
    const e = byModel.get(k) ?? { cur: [], base: [] };
    e.cur.push(r);
    byModel.set(k, e);
  }
  for (const r of baseline) {
    const k = groupKey(r);
    const e = byModel.get(k) ?? { cur: [], base: [] };
    e.base.push(r);
    byModel.set(k, e);
  }

  const out: DriftRow[] = [];
  for (const [key, { cur, base }] of byModel) {
    const [provider, ...modelParts] = key.split(':');
    const model = modelParts.join(':');
    const curStats = summarize(cur);
    const baseStats = summarize(base);

    // Prefer $/1k-tok when both windows have tokens; fall back to $/call.
    let kind: DriftKind;
    let baselineValue: number;
    let currentValue: number;
    if (curStats.costPer1kTokens !== null && baseStats.costPer1kTokens !== null) {
      kind = 'cost_per_1k_tokens';
      baselineValue = baseStats.costPer1kTokens;
      currentValue = curStats.costPer1kTokens;
    } else {
      kind = 'cost_per_call';
      baselineValue = baseStats.costPerCall;
      currentValue = curStats.costPerCall;
    }

    // Need enough sample on both sides. $/1k-tok needs a larger floor
    // because it averages across token counts within each call.
    const minCalls = minCallsFor(kind, args);
    if (curStats.calls < minCalls || baseStats.calls < minCalls) continue;

    if (baselineValue === 0) continue;
    const driftPct = (currentValue - baselineValue) / baselineValue;
    const providerThreshold = thresholdFor(provider, args);
    out.push({
      provider,
      model,
      baseline: baseStats,
      current: curStats,
      baselineDays,
      currentDays,
      kind,
      baselineValue,
      currentValue,
      driftPct,
      flagged: Math.abs(driftPct) > providerThreshold,
    });
  }
  return out.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}

// ── Reporting ─────────────────────────────────────────────────────────────

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function printText(args: CliArgs, rows: DriftRow[]): void {
  const flagged = rows.filter((r) => r.flagged);
  const overrides = Object.entries(args.providerThresholds)
    .map(([p, t]) => `${p}=${(t * 100).toFixed(1)}%`)
    .join(', ');
  console.log('');
  console.log(
    `Cost-drift audit  —  window: ${args.windowDays}d   baseline: ${args.baselineDays}d   ` +
      `threshold: ±${(args.threshold * 100).toFixed(1)}%${overrides ? ` (overrides: ${overrides})` : ''}   ` +
      `min calls: ${args.minCallsOverride ?? `${MIN_CALLS_PER_1K_TOK} tok / ${MIN_CALLS_PER_CALL} call`}`
  );
  console.log('─'.repeat(100));
  if (rows.length === 0) {
    console.log(`No (provider, model) pairs met the per-metric min-call floor on both windows.`);
    return;
  }
  console.log(
    pad('Model', 36) +
      pad('Provider', 12) +
      pad('Metric', 22) +
      pad('Baseline', 14) +
      pad('Current', 14) +
      'Drift'
  );
  console.log('─'.repeat(100));
  for (const r of rows.slice(0, 30)) {
    const marker = r.flagged ? '✗' : ' ';
    const metric = r.kind === 'cost_per_1k_tokens' ? '$/1k tok' : '$/call';
    console.log(
      `${marker} ` +
        pad(r.model, 34) +
        pad(r.provider, 12) +
        pad(metric, 22) +
        pad(fmtUsd(r.baselineValue), 14) +
        pad(fmtUsd(r.currentValue), 14) +
        fmtPct(r.driftPct)
    );
  }
  if (rows.length > 30) {
    console.log(`… ${rows.length - 30} more rows (use --json for full output)`);
  }
  console.log('─'.repeat(100));
  if (flagged.length === 0) {
    console.log('✓ No drift beyond threshold.');
    return;
  }
  console.log('');
  console.log(
    `✗ ${flagged.length} model(s) drifted beyond ±${(args.threshold * 100).toFixed(1)}%:`
  );
  for (const r of flagged) {
    const dir = r.driftPct > 0 ? 'increased' : 'decreased';
    const metric = r.kind === 'cost_per_1k_tokens' ? '$/1k tokens' : '$/call';
    console.log(`   ${r.provider}/${r.model}: ${metric} ${dir} ${fmtPct(r.driftPct)}`);
    console.log(
      `     baseline (${r.baseline.calls} calls) ${fmtUsd(r.baselineValue)}  →  current (${r.current.calls} calls) ${fmtUsd(r.currentValue)}`
    );
  }
  console.log('');
  console.log('Likely causes:');
  console.log('  • Provider changed list pricing → patch the registry, run `pnpm docs:pricing`');
  console.log('  • Model behavior shift (more output tokens) → verify on provider docs');
  console.log(
    '  • Routing change shifted volume to a different model — confirm in `[llm-router]` logs'
  );
}

function printJson(args: CliArgs, rows: DriftRow[]): void {
  const flagged = rows.filter((r) => r.flagged);
  console.log(
    JSON.stringify(
      {
        windowDays: args.windowDays,
        baselineDays: args.baselineDays,
        threshold: args.threshold,
        providerThresholds: args.providerThresholds,
        minCallsPer1kTok: args.minCallsOverride ?? MIN_CALLS_PER_1K_TOK,
        minCallsPerCall: args.minCallsOverride ?? MIN_CALLS_PER_CALL,
        rows,
        flagged,
        flaggedCount: flagged.length,
      },
      null,
      2
    )
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const today = new Date();
  // Use UTC day boundary so this is deterministic across timezones.
  today.setUTCHours(0, 0, 0, 0);

  // Yesterday is the last day with a complete aggregate (today is still
  // being written to). Window = [today-1, ..., today-windowDays].
  // Baseline = [today-windowDays-1, ..., today-windowDays-baselineDays].
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() - 1);
  const baselineEnd = new Date(windowEnd);
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - args.windowDays);

  const currentDays = daysInRange(windowEnd, args.windowDays);
  const baselineDays = daysInRange(baselineEnd, args.baselineDays);

  const { db } = initFirebaseAdmin(args.serviceAccountPath);
  const [current, baseline] = await Promise.all([
    pullDailyAggregates(db, currentDays),
    pullDailyAggregates(db, baselineDays),
  ]);

  const rows = buildDriftRows(current, baseline, currentDays, baselineDays, args);

  if (args.json) printJson(args, rows);
  else printText(args, rows);
  process.exit(rows.some((r) => r.flagged) ? 1 : 0);
}

main().catch((err) => {
  console.error('[cost-drift] Failed:', err);
  process.exit(2);
});
