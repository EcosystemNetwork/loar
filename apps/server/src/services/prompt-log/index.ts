/**
 * Prompt corpus log.
 *
 * `capturePrompt()` records every user-submitted generation prompt into the
 * append-only `promptLog` Firestore collection. It is wired into the single
 * choke point `sanitizePrompt()` (apps/server/src/lib/prompt-sanitize.ts),
 * which every AI generation route calls right before dispatching to a
 * provider — so one call site gives platform-wide coverage, and any new
 * generation path is captured automatically.
 *
 * Attribution (userId, route, universeAddress, requestId, apiKeyId) is read
 * from the ambient cost scope (AsyncLocalStorage, set by the tRPC / REST /
 * worker middleware) — no signature changes anywhere.
 *
 * Design rules:
 *   - NEVER throw. This runs inside the hot generation path.
 *   - Fire-and-forget the Firestore write; do not await it upstream.
 *   - Only capture real user requests (scope.userId set) on generation
 *     routes. System calls, lookups, and non-generation routes are skipped.
 *   - In-process dedupe collapses the repeated sanitize() calls a single
 *     request makes (e.g. per-message LLM content, per-line TTS text).
 *
 * The admin surface (`admin.prompts.*` → /admin/prompts) reads this
 * collection for browsing, search, stats, and NDJSON export. Retroactive
 * population from pre-existing generation records: scripts/backfill-prompt-log.ts.
 *
 * Disable entirely with PROMPT_LOG_ENABLED=false.
 */

import { createHash, randomUUID } from 'node:crypto';
import { db, firebaseAvailable } from '../../lib/firebase';
import { getCostScope } from '../cost-tracker/scope';

const ENABLED = (process.env.PROMPT_LOG_ENABLED ?? 'true').toLowerCase() !== 'false';

/** Hard cap on stored prompt text. Generous — real prompts are << this. */
const MAX_PROMPT_CHARS = 20_000;

/** Collapse duplicate captures from one request for this long. */
const DEDUP_TTL_MS = 90_000;

export type PromptKind = 'video' | 'image' | 'audio' | 'threed' | 'text' | 'edit' | 'other';

export const PROMPT_KINDS: readonly PromptKind[] = [
  'video',
  'image',
  'audio',
  'threed',
  'text',
  'edit',
  'other',
];

// tRPC router mount key (segment after `trpc:`) → prompt kind. Keys mirror
// apps/server/src/routers/index.ts. Anything not listed here is treated as a
// non-generation route and skipped by capturePrompt().
const ROUTE_KIND: Record<string, PromptKind> = {
  generation: 'video',
  image: 'image',
  outpaint: 'image',
  threed: 'threed',
  voice: 'audio',
  tts: 'audio',
  audio: 'audio',
  sceneAudio: 'audio',
  dubbing: 'audio',
  multilingualDub: 'audio',
  voiceLibrary: 'audio',
  editing: 'edit',
  lora: 'edit',
  cutdown: 'edit',
  captions: 'edit',
  lipsync: 'edit',
  canvas: 'edit',
  talkingScene: 'edit',
  characterPipeline: 'edit',
  vlm: 'text',
  wiki: 'text',
  virality: 'text',
  sandbox: 'text',
};

/** Extract the router mount key from a `trpc:<key>.<proc>` route string. */
function routeKey(route: string | null | undefined): string | null {
  if (!route) return null;
  const m = /^trpc:([^.]+)\./.exec(route);
  return m ? m[1] : null;
}

function deriveKind(route: string | null | undefined): PromptKind {
  const key = routeKey(route);
  return (key && ROUTE_KIND[key]) || 'other';
}

/**
 * True when `route` is a known AI generation route. Exported so the points
 * ledger (services/points) can gate per-generation awards on the exact same
 * set of routes this module captures prompts for.
 */
export function isGenerationRoute(route: string | null | undefined): boolean {
  const key = routeKey(route);
  return !!key && key in ROUTE_KIND;
}

// ── In-process dedupe ────────────────────────────────────────────────────
// A single generate request calls sanitizePrompt() several times (prompt +
// negativePrompt, per-message LLM content, per-line TTS). We only want one
// row per distinct (user, route, field, text). Bounded map with lazy sweep.

const seen = new Map<string, number>();

function isFreshCapture(key: string): boolean {
  const now = Date.now();
  if (seen.size > 10_000) {
    for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
  }
  const exp = seen.get(key);
  if (exp && exp > now) return false;
  seen.set(key, now + DEDUP_TTL_MS);
  return true;
}

// ── Capture ─────────────────────────────────────────────────────────────

export interface CapturePromptOpts {
  /** Which input field this text came from. Default 'prompt'. */
  field?: string;
  /** Force a kind instead of deriving from the route. */
  kind?: PromptKind;
  model?: string | null;
  provider?: string | null;
  universeId?: string | null;
  entityId?: string | null;
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * Record one user-submitted prompt. Safe to call from anywhere in a
 * generation path — no-ops for system calls, non-generation routes,
 * trivial strings, or when Firestore / the feature is disabled. Never
 * throws; the Firestore write is fire-and-forget.
 */
export function capturePrompt(text: string, opts: CapturePromptOpts = {}): void {
  try {
    if (!ENABLED || !firebaseAvailable) return;
    if (typeof text !== 'string') return;

    const trimmed = text.trim();
    if (trimmed.length < 2) return;

    const scope = getCostScope();
    const userId = scope.userId;
    if (!userId) return; // only capture attributable user requests

    const route = scope.route ?? null;
    if (!opts.kind && !isGenerationRoute(route)) return;

    const field = opts.field ?? 'prompt';
    const promptHash = createHash('sha256').update(trimmed).digest('hex');
    if (!isFreshCapture(`${userId}:${route ?? ''}:${field}:${promptHash}`)) return;

    const now = new Date();
    const iso = now.toISOString();
    const doc = {
      userId,
      route,
      requestId: scope.requestId ?? null,
      apiKeyId: scope.apiKeyId ?? null,
      aiAgentId: scope.aiAgentId ?? null,
      universeAddress: (opts.universeId ?? scope.universeAddress ?? null)?.toLowerCase?.() ?? null,
      entityId: opts.entityId ?? null,
      kind: opts.kind ?? deriveKind(route),
      field,
      prompt: trimmed.slice(0, MAX_PROMPT_CHARS),
      promptHash,
      promptChars: trimmed.length,
      truncated: trimmed.length > MAX_PROMPT_CHARS,
      model: opts.model ?? null,
      provider: opts.provider ?? null,
      extra: opts.extra ?? null,
      source: 'live' as const,
      day: iso.slice(0, 10),
      month: iso.slice(0, 7),
      createdAt: now,
    };

    db.collection('promptLog')
      .doc(`pl_${randomUUID()}`)
      .set(doc)
      .catch((err: unknown) =>
        console.error('[prompt-log] write failed:', (err as Error)?.message ?? err)
      );
  } catch (err) {
    console.error('[prompt-log] capture error:', (err as Error)?.message ?? err);
  }
}

// ── Read side (admin) ───────────────────────────────────────────────────

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  const anyV = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof anyV.toDate === 'function') return anyV.toDate().toISOString();
  const secs = anyV.seconds ?? anyV._seconds;
  if (typeof secs === 'number') return new Date(secs * 1000).toISOString();
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function shape(d: FirebaseFirestore.QueryDocumentSnapshot): Record<string, unknown> {
  const data = d.data();
  return { id: d.id, ...data, createdAt: tsToIso(data.createdAt) };
}

export interface ListPromptsInput {
  limit: number;
  cursor?: string;
  userId?: string;
  kind?: PromptKind;
  universeAddress?: string;
  routeKey?: string;
  /** Case-insensitive substring match on prompt text (disables pagination). */
  search?: string;
  since?: string;
  until?: string;
}

export async function listPrompts(input: ListPromptsInput): Promise<{
  items: Record<string, unknown>[];
  nextCursor?: string;
}> {
  if (!firebaseAvailable) return { items: [] };

  const col = db.collection('promptLog');
  let q: FirebaseFirestore.Query = col;

  if (input.userId) q = q.where('userId', '==', input.userId.toLowerCase());
  if (input.kind) q = q.where('kind', '==', input.kind);
  if (input.universeAddress) {
    q = q.where('universeAddress', '==', input.universeAddress.toLowerCase());
  }
  if (input.since) q = q.where('createdAt', '>=', new Date(input.since));
  if (input.until) q = q.where('createdAt', '<=', new Date(input.until));
  q = q.orderBy('createdAt', 'desc');

  // Substring search has no Firestore index — over-read a bounded window and
  // filter in memory. Route-key filter is likewise applied in memory to avoid
  // a composite index per router.
  const memoryFilter = !!input.search || !!input.routeKey;
  const readLimit = memoryFilter ? Math.min(Math.max(input.limit * 20, 200), 3000) : input.limit;

  if (input.cursor && !memoryFilter) {
    const cur = await col.doc(input.cursor).get();
    if (cur.exists) q = q.startAfter(cur);
  }

  const snap = await q.limit(readLimit).get();
  let docs = snap.docs;

  if (input.routeKey) {
    docs = docs.filter((d) => routeKey(d.data().route) === input.routeKey);
  }
  if (input.search) {
    const needle = input.search.toLowerCase();
    docs = docs.filter((d) =>
      String(d.data().prompt ?? '')
        .toLowerCase()
        .includes(needle)
    );
  }
  if (memoryFilter) docs = docs.slice(0, input.limit);

  const nextCursor =
    !memoryFilter && snap.docs.length === readLimit
      ? snap.docs[snap.docs.length - 1].id
      : undefined;

  return { items: docs.map(shape), nextCursor };
}

export async function getPromptById(id: string): Promise<Record<string, unknown> | null> {
  if (!firebaseAvailable) return null;
  const doc = await db.collection('promptLog').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { id: doc.id, ...data, createdAt: tsToIso(data.createdAt) };
}

export async function getPromptStats(days = 30): Promise<{
  total: number;
  windowDays: number;
  windowTotal: number;
  uniqueUsers: number;
  byKind: { kind: string; count: number }[];
  byDay: { day: string; count: number }[];
}> {
  if (!firebaseAvailable) {
    return { total: 0, windowDays: days, windowTotal: 0, uniqueUsers: 0, byKind: [], byDay: [] };
  }

  const since = new Date(Date.now() - days * 86_400_000);
  const [totalSnap, windowSnap] = await Promise.all([
    db.collection('promptLog').count().get(),
    db
      .collection('promptLog')
      .where('createdAt', '>=', since)
      .orderBy('createdAt', 'asc')
      .limit(100_000)
      .get(),
  ]);

  const users = new Set<string>();
  const byKind = new Map<string, number>();
  const byDay = new Map<string, number>();
  windowSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.userId) users.add(String(data.userId));
    const k = String(data.kind ?? 'other');
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
    const day = String(data.day ?? tsToIso(data.createdAt)?.slice(0, 10) ?? '');
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  });

  const series: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day: key, count: byDay.get(key) ?? 0 });
  }

  return {
    total: totalSnap.data().count,
    windowDays: days,
    windowTotal: windowSnap.size,
    uniqueUsers: users.size,
    byKind: [...byKind.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    byDay: series,
  };
}

export interface ExportPromptsInput {
  since?: string;
  until?: string;
  kind?: PromptKind;
  limit: number;
}

/**
 * Build an NDJSON dump of the corpus (one JSON object per line). Bounded by
 * `limit` (router caps it at 50k). Returned as a string for the admin page
 * to offer as a download.
 */
export async function exportPrompts(input: ExportPromptsInput): Promise<{
  ndjson: string;
  count: number;
  truncated: boolean;
}> {
  if (!firebaseAvailable) return { ndjson: '', count: 0, truncated: false };

  let q: FirebaseFirestore.Query = db.collection('promptLog');
  if (input.kind) q = q.where('kind', '==', input.kind);
  if (input.since) q = q.where('createdAt', '>=', new Date(input.since));
  if (input.until) q = q.where('createdAt', '<=', new Date(input.until));
  q = q.orderBy('createdAt', 'desc').limit(input.limit + 1);

  const snap = await q.get();
  const truncated = snap.size > input.limit;
  const rows = snap.docs.slice(0, input.limit).map((d) => {
    const data = d.data();
    return JSON.stringify({
      id: d.id,
      createdAt: tsToIso(data.createdAt),
      userId: data.userId ?? null,
      kind: data.kind ?? null,
      field: data.field ?? null,
      route: data.route ?? null,
      universeAddress: data.universeAddress ?? null,
      model: data.model ?? null,
      provider: data.provider ?? null,
      promptChars: data.promptChars ?? null,
      prompt: data.prompt ?? '',
    });
  });

  return { ndjson: rows.join('\n'), count: rows.length, truncated };
}
