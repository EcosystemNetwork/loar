/**
 * Creator notebook — private scratch collection for raw worldbuilding ideas.
 *
 * A notebook entry is an unpolished draft. It lives in Firestore and is only
 * visible to its creator. When the entry is ready, the creator can "promote"
 * it, which spawns a proper Entity (Person, Place, Lore, etc.) seeded from
 * the entry's title + body. The entry keeps a pointer to the spawned entity
 * so the notebook becomes an archive of where each canon artifact was born.
 */
import type { EntityKind } from '../entities/entities.types';

export interface NotebookEntry {
  id: string;
  creator: string; // lowercase wallet address
  title: string;
  body: string;
  tags: string[];
  /** Optional universe scope — entries can float untethered. */
  universeAddress: string | null;
  /** Set when the entry has been promoted to a canonical Entity. */
  promotedTo: {
    entityId: string;
    entityKind: EntityKind;
    promotedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotebookEntryInput {
  title: string;
  body: string;
  tags?: string[];
  universeAddress?: string | null;
}

export interface UpdateNotebookEntryInput {
  title?: string;
  body?: string;
  tags?: string[];
  universeAddress?: string | null;
}
