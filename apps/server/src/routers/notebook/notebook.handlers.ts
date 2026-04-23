/**
 * Firestore handlers for the creator notebook.
 *
 * Collection: `notebookEntries/{entryId}` (top-level, indexed by creator).
 */
import { db } from '../../lib/firebase';
import type {
  NotebookEntry,
  CreateNotebookEntryInput,
  UpdateNotebookEntryInput,
} from './notebook.types';
import type { EntityKind } from '../entities/entities.types';
import { createEntity } from '../entities/entities.handlers';

function notebookCol() {
  return db.collection('notebookEntries');
}

export async function createNotebookEntry(
  input: CreateNotebookEntryInput,
  creator: string
): Promise<NotebookEntry> {
  const ref = notebookCol().doc();
  const now = new Date();
  const entry: NotebookEntry = {
    id: ref.id,
    creator: creator.toLowerCase(),
    title: input.title,
    body: input.body,
    tags: input.tags ?? [],
    universeAddress: input.universeAddress ? input.universeAddress.toLowerCase() : null,
    promotedTo: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(entry);
  return entry;
}

export async function getNotebookEntry(entryId: string): Promise<NotebookEntry | null> {
  const doc = await notebookCol().doc(entryId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as NotebookEntry;
}

export async function listNotebookEntriesByCreator(
  creator: string,
  opts: { universeAddress?: string | null; onlyPromoted?: boolean; limit?: number } = {}
): Promise<NotebookEntry[]> {
  const { universeAddress, onlyPromoted, limit = 100 } = opts;
  let query: FirebaseFirestore.Query = notebookCol().where('creator', '==', creator.toLowerCase());

  if (universeAddress !== undefined) {
    query = query.where(
      'universeAddress',
      '==',
      universeAddress ? universeAddress.toLowerCase() : null
    );
  }

  // Firestore can't do inequality on a nested field + orderBy on another.
  // Fetch then filter in-memory — notebook lists are bounded per user.
  query = query.orderBy('updatedAt', 'desc').limit(limit);
  const snapshot = await query.get();
  let entries = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as NotebookEntry);
  if (onlyPromoted) {
    entries = entries.filter((e) => !!e.promotedTo);
  }
  return entries;
}

export async function updateNotebookEntry(
  entryId: string,
  input: UpdateNotebookEntryInput
): Promise<NotebookEntry> {
  const ref = notebookCol().doc(entryId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Notebook entry not found');
  const existing = doc.data() as NotebookEntry;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) updates.title = input.title;
  if (input.body !== undefined) updates.body = input.body;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.universeAddress !== undefined) {
    updates.universeAddress = input.universeAddress ? input.universeAddress.toLowerCase() : null;
  }

  await ref.update(updates);
  return { ...existing, ...updates, id: entryId } as NotebookEntry;
}

export async function deleteNotebookEntry(entryId: string): Promise<void> {
  await notebookCol().doc(entryId).delete();
}

/**
 * Promote a notebook entry into a canonical Entity. The entry keeps a pointer
 * back to the entity so the notebook becomes the provenance trail.
 *
 * `entityKind` is required — it tells us which entity type to spawn
 * (person, place, lore, etc.). The entry must belong to the caller.
 */
export async function promoteNotebookEntry(
  entryId: string,
  kind: EntityKind,
  caller: string,
  opts: { universeAddress?: string | null; imageUrl?: string | null } = {}
): Promise<{ entry: NotebookEntry; entityId: string }> {
  const ref = notebookCol().doc(entryId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Notebook entry not found');
  const existing = doc.data() as NotebookEntry;
  const callerLower = caller.toLowerCase();
  if (existing.creator.toLowerCase() !== callerLower) {
    throw new Error('Forbidden: only the notebook entry author can promote it');
  }
  if (existing.promotedTo) {
    throw new Error('Notebook entry has already been promoted');
  }

  const universeAddress =
    opts.universeAddress !== undefined ? opts.universeAddress : existing.universeAddress;

  const { id: entityId } = await createEntity(
    {
      name: existing.title,
      description: existing.body,
      kind,
      universeAddress: universeAddress ?? null,
      parentId: null,
      imageUrl: opts.imageUrl ?? null,
      metadata: {
        notebookOrigin: entryId,
        notebookTags: existing.tags,
      },
      monetized: false,
      rightsDeclaration: null,
    },
    callerLower
  );

  const now = new Date();
  const promotedTo = { entityId, entityKind: kind, promotedAt: now };
  await ref.update({ promotedTo, updatedAt: now });

  return {
    entry: { ...existing, id: entryId, promotedTo, updatedAt: now } as NotebookEntry,
    entityId,
  };
}
