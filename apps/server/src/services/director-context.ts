/**
 * Context assembly for the Voice Director's tool layer (get_universe_context,
 * get_character, get_canon) and for character-mode session bootstrap.
 *
 * Two perspectives:
 *   - 'director'  — omniscient: universe synopsis, all entities, the full
 *                   story tree including alternate branches. The director is
 *                   the meta layer; it needs the whole picture.
 *   - 'character' — knowledge-scoped: only the character's own entity, their
 *                   direct relationships, and the story along the primary
 *                   path. Deliberately excludes the universe synopsis and
 *                   other entities' descriptions, because those routinely
 *                   contain secrets this character hasn't discovered yet — a
 *                   prompt instruction alone is a weak guard when the secret
 *                   is sitting in the context window.
 */
import { db } from '../lib/firebase';
import { normalizeUniverseId } from '../lib/universe-id';
import { RELATION_LABELS } from '../routers/entities/entities.types';
import type { EntityRelation } from '../routers/entities/entities.types';
import { buildGenerationContext } from './wiki-context';

export type ContextPerspective = 'director' | 'character';

export interface StoryNodeSummary {
  nodeId: number;
  title: string;
  previousNodeId: number;
  plot: string;
  canon: boolean;
}

export interface EntityVoice {
  humeVoiceId?: string;
  humeVoiceDescription?: string;
  gradiumVoiceId?: string;
}

export interface DirectorContext {
  universeName: string;
  characters: Array<{ id: string; name: string }>;
  nodes: StoryNodeSummary[];
  context: string;
  entity: { id: string; name: string } | null;
  voice: EntityVoice | null;
}

const MAX_UNIVERSE_DESC = 2500;
const MAX_PLOT_IN_CONTEXT = 400;
const VOICE_METADATA_KEYS = new Set([
  'humeVoiceId',
  'humeVoiceName',
  'humeVoiceDescription',
  'gradiumVoiceId',
]);

/** Seed data ships `REPLACE_WITH_…` placeholders until real voice ids are chosen. */
function realVoiceId(v: unknown): string | undefined {
  return typeof v === 'string' && v && !v.startsWith('REPLACE_') ? v : undefined;
}

export function extractEntityVoice(
  metadata: Record<string, unknown> | undefined
): EntityVoice | null {
  if (!metadata) return null;
  const voice: EntityVoice = {
    humeVoiceId: realVoiceId(metadata.humeVoiceId),
    gradiumVoiceId: realVoiceId(metadata.gradiumVoiceId),
    humeVoiceDescription:
      typeof metadata.humeVoiceDescription === 'string'
        ? metadata.humeVoiceDescription.slice(0, 100)
        : undefined,
  };
  return voice.humeVoiceId || voice.gradiumVoiceId ? voice : null;
}

/**
 * The story path a character can be assumed to have lived through: from the
 * root, following the earliest-created child at each step. Later siblings are
 * alternate branches (a "what if"), not events that happened to this
 * character, so they're excluded from character-perspective context.
 */
export function primaryPath(nodes: StoryNodeSummary[]): StoryNodeSummary[] {
  const byParent = new Map<number, StoryNodeSummary[]>();
  for (const n of nodes) {
    const list = byParent.get(n.previousNodeId) ?? [];
    list.push(n);
    byParent.set(n.previousNodeId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.nodeId - b.nodeId);

  const path: StoryNodeSummary[] = [];
  let current = byParent.get(0)?.[0];
  const seen = new Set<number>();
  while (current && !seen.has(current.nodeId)) {
    seen.add(current.nodeId);
    path.push(current);
    current = byParent.get(current.nodeId)?.[0];
  }
  return path;
}

function formatNode(n: StoryNodeSummary, showBranchOf: boolean): string {
  const plot =
    n.plot.length > MAX_PLOT_IN_CONTEXT ? `${n.plot.slice(0, MAX_PLOT_IN_CONTEXT - 3)}...` : n.plot;
  const branch = showBranchOf && n.previousNodeId > 0 ? ` (follows #${n.previousNodeId})` : '';
  return `#${n.nodeId} ${n.title || 'Untitled'}${branch}${plot ? ` — ${plot}` : ''}`;
}

async function loadNodes(universeId: string): Promise<StoryNodeSummary[]> {
  if (!db) return [];
  const snap = await db
    .collection('offChainNodes')
    .where('universeId', '==', universeId)
    .orderBy('nodeId', 'asc')
    .limit(150)
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      nodeId: x.nodeId as number,
      title: (x.title as string) || '',
      previousNodeId: (x.previousNodeId as number) || 0,
      plot: (x.plot as string) || '',
      canon: Boolean(x.canon),
    };
  });
}

async function loadCharacters(universeId: string): Promise<Array<{ id: string; name: string }>> {
  if (!db) return [];
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeId)
    .where('kind', '==', 'person')
    .limit(60)
    .get();
  return snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || 'Unnamed' }));
}

async function buildCharacterContext(
  universeId: string,
  entityId: string,
  nodes: StoryNodeSummary[]
): Promise<{
  text: string;
  entity: { id: string; name: string };
  voice: EntityVoice | null;
} | null> {
  if (!db) return null;
  const doc = await db.collection('entities').doc(entityId).get();
  if (!doc.exists) return null;
  const e = doc.data() ?? {};
  if (normalizeUniverseId((e.universeAddress as string) ?? '') !== universeId) return null;

  const metadata = (e.metadata ?? {}) as Record<string, unknown>;
  const lines: string[] = [`[CHARACTER: ${e.name}]`];
  if (e.description) lines.push(String(e.description));
  for (const [k, v] of Object.entries(metadata)) {
    if (VOICE_METADATA_KEYS.has(k)) continue;
    if ((typeof v === 'string' && v.trim()) || typeof v === 'number') lines.push(`${k}: ${v}`);
  }

  const [asSource, asTarget] = await Promise.all([
    db.collection('entityRelations').where('sourceId', '==', entityId).limit(30).get(),
    db.collection('entityRelations').where('targetId', '==', entityId).limit(30).get(),
  ]);
  const relations = [
    ...asSource.docs.map((d) => ({ rel: d.data() as EntityRelation, outgoing: true })),
    ...asTarget.docs.map((d) => ({ rel: d.data() as EntityRelation, outgoing: false })),
  ];
  if (relations.length > 0) {
    const otherIds = [
      ...new Set(relations.map((r) => (r.outgoing ? r.rel.targetId : r.rel.sourceId))),
    ];
    const names = new Map<string, string>();
    const docs = await Promise.all(otherIds.map((id) => db!.collection('entities').doc(id).get()));
    for (const d of docs) if (d.exists) names.set(d.id, String(d.data()?.name ?? 'Unknown'));
    const relLines = relations.map(({ rel, outgoing }) => {
      const otherId = outgoing ? rel.targetId : rel.sourceId;
      const label = outgoing ? (RELATION_LABELS[rel.type] ?? rel.type) : rel.type;
      return `- ${label}: ${names.get(otherId) ?? 'Unknown'}${rel.description ? ` (${rel.description})` : ''}`;
    });
    lines.push(`\n[RELATIONSHIPS]\n${relLines.join('\n')}`);
  }

  const path = primaryPath(nodes);
  if (path.length > 0) {
    lines.push(`\n[WHAT HAS HAPPENED SO FAR]\n${path.map((n) => formatNode(n, false)).join('\n')}`);
  }

  return {
    text: lines.join('\n'),
    entity: { id: doc.id, name: String(e.name ?? 'Unknown') },
    voice: extractEntityVoice(metadata),
  };
}

export async function buildDirectorContext(opts: {
  universeId: string;
  entityId?: string;
  perspective: ContextPerspective;
}): Promise<DirectorContext | null> {
  if (!db) return null;
  const universeId = normalizeUniverseId(opts.universeId);

  const uniDoc = await db.collection('cinematicUniverses').doc(universeId).get();
  if (!uniDoc.exists) return null;
  const uni = uniDoc.data() ?? {};
  const universeName = (uni.name as string) || 'this universe';

  const [nodes, characters] = await Promise.all([
    loadNodes(universeId),
    loadCharacters(universeId),
  ]);

  if (opts.perspective === 'character') {
    if (!opts.entityId) return null;
    const built = await buildCharacterContext(universeId, opts.entityId, nodes);
    if (!built) return null;
    return {
      universeName,
      characters,
      nodes: primaryPath(nodes),
      context: built.text,
      entity: built.entity,
      voice: built.voice,
    };
  }

  const parts: string[] = [`[UNIVERSE: ${universeName}]`];
  const desc = (uni.description as string) || '';
  if (desc)
    parts.push(desc.length > MAX_UNIVERSE_DESC ? `${desc.slice(0, MAX_UNIVERSE_DESC)}...` : desc);

  const wiki = await buildGenerationContext({ universeId, entityId: opts.entityId }).catch(
    () => null
  );
  if (wiki) parts.push(wiki);

  if (nodes.length > 0) {
    parts.push(
      `[STORY NODES]\n${nodes.map((n) => formatNode(n, true) + (n.canon ? ' [canon]' : '')).join('\n')}`
    );
  }

  let entity: { id: string; name: string } | null = null;
  let voice: EntityVoice | null = null;
  if (opts.entityId) {
    const ed = await db.collection('entities').doc(opts.entityId).get();
    if (ed.exists) {
      entity = { id: ed.id, name: String(ed.data()?.name ?? 'Unknown') };
      voice = extractEntityVoice((ed.data()?.metadata ?? {}) as Record<string, unknown>);
    }
  }

  return { universeName, characters, nodes, context: parts.join('\n\n'), entity, voice };
}
