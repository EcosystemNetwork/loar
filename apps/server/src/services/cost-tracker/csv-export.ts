/**
 * CSV export for the cost ledger.
 * Called by the admin-only REST endpoint at `/api/admin/cost/export.csv`.
 */

import { getRecentLedger, type LedgerEntry } from './query';

const HEADERS = [
  'id',
  'createdAt',
  'provider',
  'model',
  'kind',
  'costUsd',
  'inputTokens',
  'outputTokens',
  'userId',
  'apiKeyId',
  'universeAddress',
  'route',
];

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(e: LedgerEntry): string {
  return [
    e.id,
    e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt ?? ''),
    e.provider,
    e.model ?? '',
    e.kind,
    e.costUsd.toFixed(6),
    e.inputTokens ?? '',
    e.outputTokens ?? '',
    e.userId ?? '',
    e.apiKeyId ?? '',
    e.universeAddress ?? '',
    e.route ?? '',
  ]
    .map(esc)
    .join(',');
}

export async function exportLedgerCsv(args: {
  limit?: number;
  userId?: string;
  apiKeyId?: string;
  universeAddress?: string;
  provider?: string;
}): Promise<string> {
  const entries = await getRecentLedger({ limit: args.limit ?? 500, ...args });
  const lines = [HEADERS.join(',')];
  for (const e of entries) lines.push(row(e));
  return lines.join('\n') + '\n';
}
