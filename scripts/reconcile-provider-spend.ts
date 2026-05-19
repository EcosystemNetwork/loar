/**
 * Reconcile per-provider spend: registry-derived (costLedger) vs invoiced.
 *
 * Catches pricing drift WITHOUT any scraping or guessing. The cost-tracker
 * already records every API call's USD cost using the rates in the model
 * registries. If those rates are stale, the per-provider monthly total
 * computed from the ledger will diverge from what the provider actually
 * billed us. This script makes that drift visible.
 *
 * Usage:
 *
 *   # Reconcile last calendar month, comparing against an invoice file
 *   pnpm reconcile:spend --invoice=./invoices/2026-04.json
 *
 *   # Custom period (YYYY-MM, defaults to last month)
 *   pnpm reconcile:spend --period=2026-03 --invoice=./invoices/2026-03.json
 *
 *   # Custom tolerance (default 0.03 = 3%)
 *   pnpm reconcile:spend --invoice=./invoices/2026-04.json --tolerance=0.05
 *
 *   # Ledger-only view (no invoice file → just dumps per-provider totals)
 *   pnpm reconcile:spend --period=2026-04
 *
 * Invoice file shape (see scripts/invoice-template.json):
 *
 *   {
 *     "period": "2026-04",
 *     "providers": {
 *       "openai": 1234.56,
 *       "gemini": 89.12,
 *       "bytedance": 456.78,
 *       "groq": 12.34,
 *       "zai": 45.67,
 *       "fal": 234.56,
 *       "elevenlabs": 78.90
 *     },
 *     "notes": "April invoices, pulled 2026-05-01"
 *   }
 *
 * Exit codes:
 *   0 — every provider within tolerance (or untracked + acknowledged)
 *   1 — at least one provider's drift exceeds tolerance → registry stale
 *   2 — usage / setup error (missing file, bad period, no Firebase creds)
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Firestore } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from './lib/firebase-admin';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliArgs {
  period: string;
  invoicePath: string | null;
  tolerance: number;
  /**
   * Minimum absolute drift in USD to flag. Suppresses noise on small bills
   * (e.g. 3% drift on a $20 Tripo bill = $0.60 — not worth waking ops).
   * Set to 0 to disable the floor (flag any % drift).
   */
  minDriftUsd: number;
  serviceAccountPath: string | null;
}

function parseArgs(): CliArgs {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1], m[2] ?? 'true');
  }
  const minDriftRaw = Number(args.get('min-drift-usd') ?? '100');
  return {
    period: args.get('period') ?? lastMonth(),
    invoicePath: args.get('invoice') ?? null,
    tolerance: Number(args.get('tolerance') ?? '0.03'),
    minDriftUsd: Number.isFinite(minDriftRaw) && minDriftRaw >= 0 ? minDriftRaw : 100,
    serviceAccountPath: args.get('service-account') ?? null,
  };
}

function lastMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function isValidPeriod(p: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

// ── Firebase ───────────────────────────────────────────────────────────────
// Resolution order is centralized in scripts/lib/firebase-admin.ts so the
// reconcile / staleness / drift scripts all pick up the same credentials
// the server runtime would use.

// ── Invoice file ───────────────────────────────────────────────────────────

interface InvoiceFile {
  period: string;
  providers: Record<string, number>;
  notes?: string;
}

function loadInvoice(p: string): InvoiceFile {
  if (!existsSync(p)) {
    console.error(`[reconcile] Invoice file not found: ${p}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(p, 'utf-8')) as InvoiceFile;
  if (!raw.period || typeof raw.period !== 'string' || !isValidPeriod(raw.period)) {
    console.error(`[reconcile] Invoice file missing valid "period" (YYYY-MM): ${p}`);
    process.exit(2);
  }
  if (!raw.providers || typeof raw.providers !== 'object') {
    console.error(`[reconcile] Invoice file missing "providers" object: ${p}`);
    process.exit(2);
  }
  for (const [k, v] of Object.entries(raw.providers)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      console.error(`[reconcile] Invoice provider "${k}" must be a non-negative number, got: ${v}`);
      process.exit(2);
    }
  }
  return raw;
}

// ── Ledger query ───────────────────────────────────────────────────────────

interface ProviderTotal {
  provider: string;
  costUsd: number;
  calls: number;
  tokensUsed: number;
}

async function pullProviderTotals(db: Firestore, period: string): Promise<ProviderTotal[]> {
  const snap = await db
    .collection('costAggregates')
    .where('period', '==', period)
    .where('scope', '==', 'provider')
    .get();

  // Aggregate keys are `${provider}:${kind}` so we collapse to per-provider here.
  const byProvider = new Map<string, ProviderTotal>();
  for (const d of snap.docs) {
    const data = d.data();
    const provider = String(data.provider ?? (data.key as string)?.split(':')[0] ?? '');
    if (!provider) continue;
    const t = byProvider.get(provider) ?? {
      provider,
      costUsd: 0,
      calls: 0,
      tokensUsed: 0,
    };
    t.costUsd += Number(data.costUsd ?? 0);
    t.calls += Number(data.calls ?? 0);
    t.tokensUsed += Number(data.tokensUsed ?? 0);
    byProvider.set(provider, t);
  }
  return [...byProvider.values()].sort((a, b) => b.costUsd - a.costUsd);
}

// ── Comparison + reporting ────────────────────────────────────────────────

type Status = 'ok' | 'drift' | 'untracked_spend' | 'no_invoice' | 'no_spend';

interface Row {
  provider: string;
  calls: number;
  computedUsd: number;
  invoicedUsd: number | null;
  driftPct: number | null;
  status: Status;
}

function classify(
  computed: number,
  invoiced: number | null,
  tolerance: number,
  minDriftUsd: number
): {
  status: Status;
  driftPct: number | null;
} {
  if (invoiced === null) {
    return { status: 'no_invoice', driftPct: null };
  }
  if (computed === 0 && invoiced > 0) {
    return { status: 'untracked_spend', driftPct: null };
  }
  if (computed > 0 && invoiced === 0) {
    return { status: 'no_invoice', driftPct: null };
  }
  if (computed === 0 && invoiced === 0) {
    return { status: 'no_spend', driftPct: 0 };
  }
  const driftAbs = Math.abs(invoiced - computed);
  const driftPct = (invoiced - computed) / computed;
  // Drift must exceed BOTH the percentage tolerance AND the absolute-USD
  // floor to be flagged. 3% on a $20 invoice is $0.60 — not worth alerting.
  const exceedsPct = Math.abs(driftPct) > tolerance;
  const exceedsUsd = driftAbs >= minDriftUsd;
  return {
    status: exceedsPct && exceedsUsd ? 'drift' : 'ok',
    driftPct,
  };
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function statusBadge(s: Status): string {
  switch (s) {
    case 'ok':
      return '✓ ok';
    case 'drift':
      return '✗ DRIFT';
    case 'untracked_spend':
      return '✗ UNTRACKED';
    case 'no_invoice':
      return '— no invoice';
    case 'no_spend':
      return '— no activity';
  }
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

function printReport(
  period: string,
  tolerance: number,
  minDriftUsd: number,
  rows: Row[],
  notes?: string
): void {
  console.log('');
  console.log(`╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║  Provider-spend reconciliation: ${pad(period, 42)}  ║`);
  console.log(
    `║  Tolerance: ±${pad((tolerance * 100).toFixed(2) + '%', 22)}` +
      `Min drift to flag: ${pad('$' + minDriftUsd.toFixed(2), 38)}║`
  );
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  if (notes) console.log(`Notes: ${notes}`);
  console.log('');
  console.log(
    pad('Provider', 14) +
      pad('Calls', 10) +
      pad('Computed', 14) +
      pad('Invoiced', 14) +
      pad('Drift', 12) +
      'Status'
  );
  console.log('─'.repeat(80));
  for (const r of rows) {
    console.log(
      pad(r.provider, 14) +
        pad(r.calls.toLocaleString(), 10) +
        pad(fmtUsd(r.computedUsd), 14) +
        pad(r.invoicedUsd === null ? '—' : fmtUsd(r.invoicedUsd), 14) +
        pad(fmtPct(r.driftPct), 12) +
        statusBadge(r.status)
    );
  }
  console.log('─'.repeat(80));
  const totalComputed = rows.reduce((a, b) => a + b.computedUsd, 0);
  const totalInvoiced = rows.reduce((a, b) => a + (b.invoicedUsd ?? 0), 0);
  const haveAnyInvoice = rows.some((r) => r.invoicedUsd !== null);
  console.log(
    pad('TOTAL', 14) +
      pad('', 10) +
      pad(fmtUsd(totalComputed), 14) +
      pad(haveAnyInvoice ? fmtUsd(totalInvoiced) : '—', 14)
  );
  console.log('');
}

function printSummary(rows: Row[]): { driftCount: number; untrackedCount: number } {
  const drift = rows.filter((r) => r.status === 'drift');
  const untracked = rows.filter((r) => r.status === 'untracked_spend');

  if (drift.length === 0 && untracked.length === 0) {
    console.log('✓ All providers within tolerance.');
    return { driftCount: 0, untrackedCount: 0 };
  }

  if (drift.length > 0) {
    console.log(`✗ ${drift.length} provider(s) drifted beyond tolerance:`);
    for (const r of drift) {
      const dir = (r.driftPct ?? 0) > 0 ? 'UNDER-counted' : 'OVER-counted';
      console.log(
        `   ${r.provider}: registry ${dir} by ${fmtPct(r.driftPct)} ` +
          `(computed ${fmtUsd(r.computedUsd)} vs invoiced ${fmtUsd(r.invoicedUsd ?? 0)})`
      );
    }
    console.log('');
    console.log('Likely cause: provider changed list pricing OR a registry entry has');
    console.log('a $0 / wrong cost. Verify on the provider dashboard and patch');
    console.log('apps/server/src/services/*-models/registry.ts, then run');
    console.log('`pnpm docs:pricing` to regenerate the doc.');
  }

  if (untracked.length > 0) {
    console.log('');
    console.log(`✗ ${untracked.length} provider(s) billed us but had $0 logged in costLedger:`);
    for (const r of untracked) {
      console.log(`   ${r.provider}: invoiced ${fmtUsd(r.invoicedUsd ?? 0)} but ledger = $0`);
    }
    console.log('');
    console.log('Likely cause: model registry entry has providerCost*: 0 (ByteDance,');
    console.log('see boot warning) OR the dispatch path bypasses recordProviderCost.');
  }

  return { driftCount: drift.length, untrackedCount: untracked.length };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  if (!isValidPeriod(args.period)) {
    console.error(`[reconcile] Invalid period "${args.period}" — expected YYYY-MM`);
    process.exit(2);
  }
  if (args.tolerance < 0 || args.tolerance > 1) {
    console.error(`[reconcile] --tolerance must be between 0 and 1, got: ${args.tolerance}`);
    process.exit(2);
  }

  const invoice = args.invoicePath ? loadInvoice(args.invoicePath) : null;
  if (invoice && invoice.period !== args.period) {
    console.error(
      `[reconcile] Period mismatch: --period=${args.period} but invoice file says "${invoice.period}"`
    );
    process.exit(2);
  }

  const { db } = initFirebaseAdmin(args.serviceAccountPath);
  const totals = await pullProviderTotals(db, args.period);

  // Build a row per provider present on either side.
  const allProviders = new Set<string>([
    ...totals.map((t) => t.provider),
    ...Object.keys(invoice?.providers ?? {}),
  ]);
  const rows: Row[] = [];
  for (const p of allProviders) {
    const t = totals.find((x) => x.provider === p);
    const invoiced = invoice?.providers[p] ?? null;
    const { status, driftPct } = classify(
      t?.costUsd ?? 0,
      invoiced,
      args.tolerance,
      args.minDriftUsd
    );
    rows.push({
      provider: p,
      calls: t?.calls ?? 0,
      computedUsd: t?.costUsd ?? 0,
      invoicedUsd: invoiced,
      driftPct,
      status,
    });
  }
  rows.sort((a, b) => (b.invoicedUsd ?? b.computedUsd) - (a.invoicedUsd ?? a.computedUsd));

  printReport(args.period, args.tolerance, args.minDriftUsd, rows, invoice?.notes);
  const { driftCount, untrackedCount } = printSummary(rows);
  process.exit(driftCount > 0 || untrackedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[reconcile] Failed:', err);
  process.exit(2);
});
