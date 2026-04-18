/**
 * Wiki Context Builder — assembles universe lore context for generation prompts.
 *
 * When generating content (video/image) for a universe, this service fetches
 * relevant wiki entities and builds a structured context block that gets
 * prepended to the user's prompt. This ensures generated content is consistent
 * with the universe's established characters, places, factions, lore, etc.
 */
import { db } from '../lib/firebase';
import type { Entity, EntityKind, EntityRelation } from '../routers/entities/entities.types';
import { CREATOR_KINDS, RELATION_LABELS } from '../routers/entities/entities.types';

/** Max entities per kind to include in context (prevents prompt bloat). */
const MAX_PER_KIND = 8;

/** Max total characters for the wiki context block. */
const MAX_CONTEXT_CHARS = 3000;

/** Kind labels for context headings. */
const KIND_HEADINGS: Partial<Record<EntityKind, string>> = {
  person: 'Characters',
  place: 'Locations',
  thing: 'Artifacts & Items',
  faction: 'Factions & Groups',
  event: 'Key Events',
  lore: 'Lore',
  species: 'Species',
  vehicle: 'Vehicles',
  technology: 'Technology',
  organization: 'Organizations',
};

/** Metadata fields that are most useful for generation context per kind. */
const USEFUL_METADATA: Record<string, string[]> = {
  person: ['role', 'appearance', 'abilities'],
  place: ['placeType', 'atmosphere'],
  thing: ['thingType', 'origin', 'powersAndUse'],
  faction: ['goals', 'structure'],
  species: ['physiology', 'abilities'],
  vehicle: ['vehicleType', 'capabilities'],
  technology: ['techType', 'function'],
};

/**
 * Format a single entity into a compact context line.
 */
function formatEntity(entity: Entity): string {
  let line = `- ${entity.name}`;
  if (entity.description) {
    // Truncate description to keep context compact
    const desc =
      entity.description.length > 150
        ? entity.description.slice(0, 147) + '...'
        : entity.description;
    line += `: ${desc}`;
  }

  // Add key metadata fields if present
  const usefulFields = USEFUL_METADATA[entity.kind] || [];
  const metaParts: string[] = [];
  for (const field of usefulFields) {
    const val = entity.metadata?.[field];
    if (val && typeof val === 'string' && val.trim()) {
      const truncated = val.length > 80 ? val.slice(0, 77) + '...' : val;
      metaParts.push(`${field}: ${truncated}`);
    }
  }
  if (metaParts.length > 0) {
    line += ` [${metaParts.join('; ')}]`;
  }

  return line;
}

/**
 * Build a universe wiki context block from all entities in that universe.
 *
 * Returns a structured text block suitable for prepending to generation prompts,
 * or null if the universe has no entities.
 */
export async function buildUniverseContext(universeAddress: string): Promise<string | null> {
  if (!db) return null;

  const snapshot = await db
    .collection('entities')
    .where('universeAddress', '==', universeAddress.toLowerCase())
    .limit(80) // cap total query
    .get();

  if (snapshot.empty) return null;

  const entities = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Entity);

  // Group by kind
  const byKind = new Map<EntityKind, Entity[]>();
  for (const entity of entities) {
    if (!CREATOR_KINDS.includes(entity.kind)) continue; // skip structural kinds in context
    const list = byKind.get(entity.kind) || [];
    list.push(entity);
    byKind.set(entity.kind, list);
  }

  if (byKind.size === 0) return null;

  const sections: string[] = [];

  for (const kind of CREATOR_KINDS) {
    const kindEntities = byKind.get(kind);
    if (!kindEntities || kindEntities.length === 0) continue;

    const heading = KIND_HEADINGS[kind] || kind;
    const limited = kindEntities.slice(0, MAX_PER_KIND);
    const lines = limited.map(formatEntity);

    sections.push(`${heading}:\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return null;

  let context = `[UNIVERSE LORE]\n${sections.join('\n\n')}`;

  // Truncate if too long
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS - 3) + '...';
  }

  return context;
}

/**
 * Build context for a specific entity — its full details plus related entities
 * from the same universe.
 *
 * Returns a focused context block, or null if entity not found.
 */
export async function buildEntityContext(entityId: string): Promise<string | null> {
  if (!db) return null;

  const entityDoc = await db.collection('entities').doc(entityId).get();
  if (!entityDoc.exists) return null;

  const entity = { id: entityDoc.id, ...entityDoc.data() } as Entity;

  const parts: string[] = [];

  // Primary entity details
  parts.push(`[SUBJECT: ${entity.name}]`);
  parts.push(`Kind: ${entity.kind}`);
  if (entity.description) {
    parts.push(`Description: ${entity.description}`);
  }

  // Include all metadata
  if (entity.metadata && Object.keys(entity.metadata).length > 0) {
    for (const [key, val] of Object.entries(entity.metadata)) {
      if (val && typeof val === 'string' && val.trim()) {
        parts.push(`${key}: ${val}`);
      }
    }
  }

  // Fetch explicit relationships
  const [asSourceSnap, asTargetSnap] = await Promise.all([
    db.collection('entityRelations').where('sourceId', '==', entityId).limit(20).get(),
    db.collection('entityRelations').where('targetId', '==', entityId).limit(20).get(),
  ]);

  const relations = [
    ...asSourceSnap.docs.map((doc) => doc.data() as EntityRelation),
    ...asTargetSnap.docs.map((doc) => doc.data() as EntityRelation),
  ];

  if (relations.length > 0) {
    // Batch-fetch related entity names
    const relatedIds = new Set<string>();
    for (const rel of relations) {
      relatedIds.add(rel.sourceId === entityId ? rel.targetId : rel.sourceId);
    }
    const relDocs = await Promise.all(
      [...relatedIds].map((id) => db.collection('entities').doc(id).get())
    );
    const nameMap = new Map<string, string>();
    for (const doc of relDocs) {
      if (doc.exists) nameMap.set(doc.id, (doc.data() as Entity).name);
    }

    const relLines: string[] = [];
    for (const rel of relations) {
      const isSource = rel.sourceId === entityId;
      const otherId = isSource ? rel.targetId : rel.sourceId;
      const otherName = nameMap.get(otherId) ?? 'Unknown';
      const label = isSource ? (RELATION_LABELS[rel.type] ?? rel.type) : rel.type; // inverse direction
      relLines.push(`- ${label}: ${otherName}${rel.description ? ` (${rel.description})` : ''}`);
    }
    parts.push(`\n[RELATIONSHIPS]\n${relLines.join('\n')}`);
  }

  // If entity belongs to a universe, fetch related entities for cross-reference
  if (entity.universeAddress) {
    const relatedSnap = await db
      .collection('entities')
      .where('universeAddress', '==', entity.universeAddress)
      .limit(30)
      .get();

    const related = relatedSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Entity)
      .filter((e) => e.id !== entityId && CREATOR_KINDS.includes(e.kind));

    if (related.length > 0) {
      // Group and summarize related entities compactly
      const relatedByKind = new Map<EntityKind, Entity[]>();
      for (const rel of related) {
        const list = relatedByKind.get(rel.kind) || [];
        list.push(rel);
        relatedByKind.set(rel.kind, list);
      }

      const relatedLines: string[] = [];
      for (const kind of CREATOR_KINDS) {
        const kindEntities = relatedByKind.get(kind);
        if (!kindEntities) continue;
        const heading = KIND_HEADINGS[kind] || kind;
        const names = kindEntities.slice(0, 5).map((e) => {
          if (e.description) {
            const shortDesc =
              e.description.length > 80 ? e.description.slice(0, 77) + '...' : e.description;
            return `${e.name} (${shortDesc})`;
          }
          return e.name;
        });
        relatedLines.push(`${heading}: ${names.join(', ')}`);
      }

      if (relatedLines.length > 0) {
        parts.push(`\n[RELATED IN UNIVERSE]\n${relatedLines.join('\n')}`);
      }
    }
  }

  let context = parts.join('\n');

  // Cap total length
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS - 3) + '...';
  }

  return context;
}

/**
 * Build the full generation context from universe + entity.
 * Combines both if available, prioritizing entity-specific context.
 */
export async function buildGenerationContext(opts: {
  universeId?: string;
  entityId?: string;
}): Promise<string | null> {
  const parts: string[] = [];

  // Entity context first (more specific)
  if (opts.entityId) {
    const entityCtx = await buildEntityContext(opts.entityId);
    if (entityCtx) parts.push(entityCtx);
  }

  // Universe context (broader lore), but only if we didn't already get it via entity
  if (opts.universeId && !opts.entityId) {
    const universeCtx = await buildUniverseContext(opts.universeId);
    if (universeCtx) parts.push(universeCtx);
  }

  if (parts.length === 0) return null;

  return parts.join('\n\n');
}
