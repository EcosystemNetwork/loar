/**
 * Pure rules for episode restore points, split out of `episodes.routes.ts` so
 * they can be unit-tested without Firestore.
 */

/** Restore points kept per episode. */
export const VERSIONS_KEEP = 30;
/** Autosaves only add a restore point this often; manual saves always do. */
export const AUTO_VERSION_MIN_MS = 10 * 60 * 1000;

/** JSON with sorted keys, so equal content compares equal regardless of key order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );
}

export type VersionDecision = 'record' | 'skip-identical' | 'skip-recent';

/**
 * Should this save add a restore point? Never for identical content; manual
 * saves always otherwise; autosaves only when the newest point is old enough.
 */
export function decideVersion(input: {
  hash: string;
  kind: 'manual' | 'auto';
  last?: { hash?: string; createdAt?: string } | null;
  now?: number;
}): VersionDecision {
  const { hash, kind, last, now = Date.now() } = input;
  if (last?.hash === hash) return 'skip-identical';
  if (kind === 'auto' && last?.createdAt) {
    const age = now - Date.parse(last.createdAt);
    if (Number.isFinite(age) && age < AUTO_VERSION_MIN_MS) return 'skip-recent';
  }
  return 'record';
}
