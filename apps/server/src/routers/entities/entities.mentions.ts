/**
 * Backlinks: which other entities in a universe mention a given entity by name.
 * Pure so it can be tested without Firestore.
 */
import type { Entity } from './entities.types';

export interface EntityMention {
  id: string;
  name: string;
  kind: string;
  imageUrl: string | null;
  /** Text around the first mention, for context in the UI. */
  snippet: string;
}

const MIN_NAME_LENGTH = 3;
const SNIPPET_RADIUS = 70;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-name, case-insensitive match that isn't glued to other letters/digits. */
function nameRegex(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'iu');
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function findMentions(target: Entity, candidates: Entity[], limit = 30): EntityMention[] {
  const name = (target.name ?? '').trim();
  if (name.length < MIN_NAME_LENGTH) return [];
  const re = nameRegex(name);
  const out: EntityMention[] = [];
  for (const c of candidates) {
    if (c.id === target.id) continue;
    const description = c.description ?? '';
    const m = re.exec(description);
    if (!m) continue;
    out.push({
      id: c.id,
      name: c.name,
      kind: c.kind,
      imageUrl: c.imageUrl ?? null,
      snippet: snippetAround(description, m.index, m[0].length),
    });
    if (out.length >= limit) break;
  }
  return out;
}
