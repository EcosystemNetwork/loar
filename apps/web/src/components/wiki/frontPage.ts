/**
 * Pure selection logic for the wiki front page: which entry is featured today,
 * what counts as "recently added", and how metadata splits between the
 * article infobox and its body sections.
 */
import type { WikiEntity } from './types';

/** Firestore Timestamps arrive as {_seconds}; also accept Date / ISO / epoch. */
export function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'object' && v !== null && '_seconds' in v) {
    return Number((v as { _seconds: number })._seconds) * 1000;
  }
  const t = new Date(v as string | number | Date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** An entry is worth featuring when it has art and enough text to read. */
const FEATURE_MIN_DESCRIPTION = 120;

/**
 * Deterministic "featured article" for a given day: the same visitor sees the
 * same pick all day, and it rotates daily. Prefers entries with art and a real
 * description, falls back to anything with art.
 */
export function pickFeatured(pool: WikiEntity[], day: number): WikiEntity | undefined {
  const withArt = pool.filter((e) => !!e.imageUrl);
  const rich = withArt.filter((e) => (e.description ?? '').length >= FEATURE_MIN_DESCRIPTION);
  const candidates = (rich.length > 0 ? rich : withArt)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return undefined;
  const idx = ((day % candidates.length) + candidates.length) % candidates.length;
  return candidates[idx];
}

/** Newest first, de-duplicated by id, excluding `exclude` (e.g. the featured entry). */
export function recentlyAdded(pool: WikiEntity[], n: number, exclude?: string): WikiEntity[] {
  const seen = new Set<string>();
  return pool
    .filter((e) => {
      if (e.id === exclude || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, n);
}

/** Shelf order: entries with art first (stable otherwise), capped at `n`. */
export function shelfEntities(entities: WikiEntity[], n: number): WikiEntity[] {
  return entities
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(!!b.e.imageUrl) - Number(!!a.e.imageUrl) || a.i - b.i)
    .slice(0, n)
    .map(({ e }) => e);
}

/** Facts at or under this length read as infobox rows; longer ones become article sections. */
export const INFOBOX_MAX_LENGTH = 80;

/**
 * Split metadata into short infobox facts and long-form article sections.
 * Non-scalar values are skipped (they have dedicated renderers or none).
 */
export function splitMetadata(
  metadata: Record<string, unknown> | null | undefined,
  hidden: ReadonlySet<string>
): { facts: Array<[string, string]>; sections: Array<[string, string]> } {
  const facts: Array<[string, string]> = [];
  const sections: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(metadata ?? {})) {
    if (hidden.has(key)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (value.length <= INFOBOX_MAX_LENGTH && !value.includes('\n')) facts.push([key, value]);
    else sections.push([key, value]);
  }
  return { facts, sections };
}

/** Days since the Unix epoch in local time — the featured-entry rotation key. */
export function localDayNumber(now: Date = new Date()): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
}
