/**
 * Authorization for user-supplied edit sources (imageUrl / videoUrl / sourceGenerationId).
 *
 * Gates the editing + outpaint + talking-scene entrypoints against an IDOR that let
 * a caller pass *another user's* gallery URL / generation id and generate derivatives
 * they don't own. Rules:
 *
 *   1. If `sourceGenerationId` is supplied, it MUST resolve to a record owned by
 *      the caller in one of the known generation/edit collections (videoGenerations,
 *      imageGenerations, editingJobs, outpaintJobs, talkingScenes, editJobs).
 *   2. If `mediaUrl` matches a row in `content` or `galleryContent`, the row's
 *      `creatorUid` MUST be the caller.
 *   3. `mediaUrl`s that don't appear in any of the above are treated as external
 *      user input (direct upload / third-party asset); these pass through since
 *      the user is supplying them by URL — there is nothing to leak.
 *   4. If the resolved source row has a non-operable `contentStatus`
 *      (flagged / under_review / hidden / removed) the edit is refused (H6).
 *
 * A Firestore miss against one of the generation collections is *not* treated
 * as a fatal error — the user may be editing output from a collection we don't
 * track (e.g. a sandbox render). Only a *hit with a mismatched uid* rejects.
 */
import { TRPCError } from '@trpc/server';
import { db } from './firebase';

const GENERATION_COLLECTIONS: ReadonlyArray<string> = [
  'videoGenerations',
  'imageGenerations',
  'editingJobs',
  'outpaintJobs',
  'talkingScenes',
  'editJobs',
  'generations',
];

const CONTENT_COLLECTIONS: ReadonlyArray<string> = ['content', 'galleryContent'];

const BLOCKING_STATUSES = new Set(['flagged', 'under_review', 'hidden', 'removed']);

function forbidden(reason: string): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: reason,
  });
}

async function assertOwnsGeneration(uid: string, generationId: string): Promise<void> {
  if (!db) return;
  for (const col of GENERATION_COLLECTIONS) {
    const doc = await db.collection(col).doc(generationId).get();
    if (!doc.exists) continue;
    const data = doc.data() ?? {};
    const ownerUid = data.userId ?? data.creatorUid ?? data.uid ?? null;
    if (ownerUid && ownerUid !== uid) {
      throw forbidden('You do not own the referenced source generation.');
    }
    const status = data.contentStatus ?? data.status ?? null;
    if (typeof status === 'string' && BLOCKING_STATUSES.has(status)) {
      throw forbidden('Source is currently under moderation review.');
    }
    return;
  }
  // Not found in any known collection: silent pass — caller may be using a
  // generation id from a system we don't authoritatively track.
}

async function assertOwnsMediaUrl(uid: string, mediaUrl: string): Promise<void> {
  if (!db) return;
  for (const col of CONTENT_COLLECTIONS) {
    const snap = await db.collection(col).where('mediaUrl', '==', mediaUrl).limit(1).get();
    if (snap.empty) continue;
    const data = snap.docs[0].data();
    const ownerUid = data.creatorUid ?? data.userId ?? null;
    if (ownerUid && ownerUid !== uid) {
      throw forbidden('You do not own the referenced source asset.');
    }
    const status = data.contentStatus ?? null;
    if (typeof status === 'string' && BLOCKING_STATUSES.has(status)) {
      throw forbidden('Source is currently under moderation review.');
    }
    return;
  }
  // URL not in any tracked collection — likely direct upload / external link.
}

export interface EditSourceAuthzInput {
  uid: string;
  mediaUrl?: string | null;
  sourceGenerationId?: string | null;
}

/**
 * Authorize an edit-style mutation against its source asset.
 *
 * Called before credit deduction in editing/outpaint/talking-scene entrypoints.
 * Throws a tRPC `FORBIDDEN` if the caller does not own the asset the edit is
 * derived from, or if that asset is in a non-operable moderation state.
 */
export async function assertEditSourceAuthorized(input: EditSourceAuthzInput): Promise<void> {
  const { uid, mediaUrl, sourceGenerationId } = input;
  if (!uid) {
    throw forbidden('Authentication required.');
  }
  if (sourceGenerationId) {
    await assertOwnsGeneration(uid, sourceGenerationId);
  }
  if (mediaUrl) {
    await assertOwnsMediaUrl(uid, mediaUrl);
  }
}
