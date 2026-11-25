/**
 * Which canon entities actually need 3D — the usage signals behind the World
 * tab's "Build 3D" / "Rig" pickers. Bulk 3D used to queue every entity with a
 * cover, so a lore item mentioned once cost the same as the lead character.
 * This ranks candidates by where the story uses them so managers build what
 * scenes need. Pure so it can be tested without Firestore.
 */
import type { Entity } from '../../routers/entities/entities.types';
import { findEpisodeAppearances, findMentions } from '../../routers/entities/entities.mentions';

export interface EntityUsage {
  /** Canon episodes whose title/description name the entity. */
  episodes: number;
  /** Other wiki entries whose description names it. */
  mentions: number;
  /** World sets that place it (object, link target or environment). */
  sets: number;
  /** Higher = used more; 0 = nothing in the story uses it yet. */
  score: number;
}

export interface SetUsageSource {
  environment?: { entityId?: string | null } | null;
  objects?: Array<{ entityId?: string | null; link?: { kind: string; target: string } | null }>;
}

export function entityUsage(
  candidates: Entity[],
  allEntities: Entity[],
  episodes: Array<{ id: string; title?: string; description?: string }>,
  sets: SetUsageSource[]
): Record<string, EntityUsage> {
  const inSets = new Map<string, number>();
  for (const s of sets) {
    const ids = new Set<string>();
    if (s.environment?.entityId) ids.add(s.environment.entityId);
    for (const o of s.objects ?? []) {
      if (o.entityId) ids.add(o.entityId);
      if (o.link?.kind === 'entity') ids.add(o.link.target);
    }
    for (const id of ids) inSets.set(id, (inSets.get(id) ?? 0) + 1);
  }

  const out: Record<string, EntityUsage> = {};
  for (const e of candidates) {
    const episodeCount = findEpisodeAppearances(e.name, episodes, 100).length;
    const mentionCount = findMentions(e, allEntities, 100).length;
    const setCount = inSets.get(e.id) ?? 0;
    out[e.id] = {
      episodes: episodeCount,
      mentions: mentionCount,
      sets: setCount,
      // Being on screen (episodes) or on a stage (sets) is what a model is for;
      // wiki cross-references are a weak tiebreaker.
      score: episodeCount * 3 + setCount * 3 + mentionCount,
    };
  }
  return out;
}
