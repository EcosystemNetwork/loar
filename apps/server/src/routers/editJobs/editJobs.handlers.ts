/**
 * Firestore handlers for the Edit Canvas.
 *
 * Keeps all transaction + denormalization logic in one place so the tRPC
 * routes stay readable. All writes go through here; the routes layer is
 * responsible for auth + input validation.
 */

import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import type {
  AssetVersion,
  EditJobRecord,
  EditSession,
  EditOp,
  LayerState,
} from './editJobs.types';

const ASSET_VERSIONS = 'assetVersions';
const EDIT_SESSIONS = 'editSessions';
const EDIT_JOBS = 'editJobs';
const CONTENT = 'content';

function assertDb(): FirebaseFirestore.Firestore {
  if (!db) throw new Error('Firebase is not configured');
  return db;
}

// ── Version chain helpers ───────────────────────────────────────────────

/**
 * Return the current version for a content doc, creating a synthetic v1
 * on the fly when a legacy content doc has no version chain yet.
 *
 * Synthetic v1 is persisted so subsequent edits form a proper DAG.
 */
export async function getOrCreateRootVersion(
  contentId: string,
  userUid: string
): Promise<AssetVersion> {
  const database = assertDb();
  const contentRef = database.collection(CONTENT).doc(contentId);
  const contentDoc = await contentRef.get();
  if (!contentDoc.exists) throw new Error(`Content ${contentId} not found`);
  const content = contentDoc.data()!;

  if (content.currentVersionId) {
    const vDoc = await database.collection(ASSET_VERSIONS).doc(content.currentVersionId).get();
    if (vDoc.exists) return versionFromDoc(vDoc);
  }

  // No chain yet — materialize a v1 from the content doc itself.
  const versionId = randomUUID();
  const now = new Date();
  const version: AssetVersion = {
    id: versionId,
    contentId,
    parentVersionId: null,
    rootVersionId: versionId,
    versionNumber: 1,
    label: 'Original',
    mediaUrl: content.mediaUrl,
    contentHash: content.contentHash ?? null,
    mimeType: content.mimeType ?? inferMimeFromMediaType(content.mediaType),
    width: content.width ?? null,
    height: content.height ?? null,
    durationSec: content.durationSec ?? null,
    mediaType: content.mediaType,
    isCurrent: true,
    createdBy: content.creatorUid ?? userUid,
    createdAt: content.createdAt?.toDate?.() ?? content.createdAt ?? now,
    editJobId: null,
    rightsDeclaration: content.classification ?? null,
    provenance: { model: null, prompt: null, ops: [] },
  };

  await database.runTransaction(async (tx) => {
    tx.set(database.collection(ASSET_VERSIONS).doc(versionId), {
      ...version,
      createdAt: version.createdAt,
    });
    tx.update(contentRef, {
      currentVersionId: versionId,
      versionCount: 1,
    });
  });

  return version;
}

export async function getVersion(versionId: string): Promise<AssetVersion | null> {
  const database = assertDb();
  const doc = await database.collection(ASSET_VERSIONS).doc(versionId).get();
  return doc.exists ? versionFromDoc(doc) : null;
}

export async function listVersionsByContent(contentId: string): Promise<AssetVersion[]> {
  const database = assertDb();
  const snap = await database
    .collection(ASSET_VERSIONS)
    .where('contentId', '==', contentId)
    .orderBy('versionNumber', 'desc')
    .get();
  return snap.docs.map(versionFromDoc);
}

/**
 * Promote a job output to a new version and flip `isCurrent` atomically.
 * Called by editJobs.submit after a job completes successfully.
 */
export async function promoteJobToVersion(args: {
  job: EditJobRecord;
  label: string;
  userUid: string;
  rightsDeclarationOverride?: 'fan' | 'original' | 'licensed' | null;
}): Promise<AssetVersion> {
  const database = assertDb();
  const { job, label, userUid, rightsDeclarationOverride } = args;
  if (!job.outputUrl) throw new Error('Cannot promote a job with no output URL');

  const contentRef = database.collection(CONTENT).doc(job.contentId);
  const sessionRef = job.sessionId ? database.collection(EDIT_SESSIONS).doc(job.sessionId) : null;
  const jobRef = database.collection(EDIT_JOBS).doc(job.id);
  const versionId = randomUUID();

  const version = await database.runTransaction(async (tx) => {
    const contentDoc = await tx.get(contentRef);
    if (!contentDoc.exists) throw new Error(`Content ${job.contentId} not found`);
    const content = contentDoc.data()!;

    const parentVersionId: string = content.currentVersionId ?? job.baseVersionId;
    if (!parentVersionId) throw new Error('No parent version resolved for promotion');
    const parentDoc = await tx.get(database.collection(ASSET_VERSIONS).doc(parentVersionId));
    if (!parentDoc.exists) throw new Error(`Parent version ${parentVersionId} not found`);
    const parent = versionFromDoc(parentDoc);

    const versionNumber = (content.versionCount ?? parent.versionNumber) + 1;
    const now = new Date();

    const newVersion: AssetVersion = {
      id: versionId,
      contentId: job.contentId,
      parentVersionId,
      rootVersionId: parent.rootVersionId,
      versionNumber,
      label: label || `Edit v${versionNumber}`,
      mediaUrl: job.outputUrl!,
      contentHash: null,
      mimeType: parent.mimeType,
      width: parent.width,
      height: parent.height,
      durationSec: parent.durationSec,
      mediaType: parent.mediaType,
      isCurrent: true,
      createdBy: userUid,
      createdAt: now,
      editJobId: job.id,
      rightsDeclaration: rightsDeclarationOverride ?? parent.rightsDeclaration,
      provenance: {
        model: job.modelId,
        prompt: job.prompt,
        ops: job.opsPlan,
      },
    };

    tx.set(database.collection(ASSET_VERSIONS).doc(versionId), {
      ...newVersion,
      createdAt: now,
    });
    tx.update(database.collection(ASSET_VERSIONS).doc(parentVersionId), { isCurrent: false });
    tx.update(contentRef, {
      currentVersionId: versionId,
      versionCount: versionNumber,
      mediaUrl: job.outputUrl,
      updatedAt: now,
    });
    tx.update(jobRef, { resultVersionId: versionId });
    if (sessionRef) tx.update(sessionRef, { status: 'submitted', lastSavedAt: now });
    return newVersion;
  });

  return version;
}

/** Revert / fast-forward by flipping isCurrent. Non-destructive — old versions stay. */
export async function setCurrentVersion(contentId: string, versionId: string): Promise<void> {
  const database = assertDb();
  const target = await database.collection(ASSET_VERSIONS).doc(versionId).get();
  if (!target.exists) throw new Error('Version not found');
  const targetData = versionFromDoc(target);
  if (targetData.contentId !== contentId) throw new Error('Version does not belong to this asset');

  const currentSnap = await database
    .collection(ASSET_VERSIONS)
    .where('contentId', '==', contentId)
    .where('isCurrent', '==', true)
    .get();

  await database.runTransaction(async (tx) => {
    for (const doc of currentSnap.docs) {
      if (doc.id !== versionId) tx.update(doc.ref, { isCurrent: false });
    }
    tx.update(database.collection(ASSET_VERSIONS).doc(versionId), { isCurrent: true });
    tx.update(database.collection(CONTENT).doc(contentId), {
      currentVersionId: versionId,
      mediaUrl: targetData.mediaUrl,
      updatedAt: new Date(),
    });
  });
}

// ── Session helpers ─────────────────────────────────────────────────────

export async function openSession(args: {
  contentId: string;
  baseVersionId: string;
  userUid: string;
}): Promise<EditSession> {
  const database = assertDb();
  const now = new Date();
  const session: EditSession = {
    id: randomUUID(),
    contentId: args.contentId,
    baseVersionId: args.baseVersionId,
    userId: args.userUid,
    aspectRatio: null,
    layers: [{ id: 'source', kind: 'source', visible: true, opacity: 1 }],
    maskUploads: [],
    lastSavedAt: now,
    createdAt: now,
    status: 'open',
  };
  await database.collection(EDIT_SESSIONS).doc(session.id).set(session);
  return session;
}

export async function getSession(sessionId: string): Promise<EditSession | null> {
  const database = assertDb();
  const doc = await database.collection(EDIT_SESSIONS).doc(sessionId).get();
  return doc.exists ? (doc.data() as EditSession) : null;
}

export async function updateSession(sessionId: string, patch: Partial<EditSession>): Promise<void> {
  const database = assertDb();
  await database
    .collection(EDIT_SESSIONS)
    .doc(sessionId)
    .update({ ...patch, lastSavedAt: new Date() });
}

export async function appendMaskUpload(
  sessionId: string,
  mask: { id: string; contentHash: string; url: string }
): Promise<void> {
  const database = assertDb();
  await database
    .collection(EDIT_SESSIONS)
    .doc(sessionId)
    .update({
      maskUploads: FieldValue.arrayUnion({ ...mask, createdAt: new Date() }),
      lastSavedAt: new Date(),
    });
}

// ── Job helpers ─────────────────────────────────────────────────────────

export async function saveJob(record: EditJobRecord): Promise<void> {
  const database = assertDb();
  await database.collection(EDIT_JOBS).doc(record.id).set(record);
}

export async function getJob(jobId: string): Promise<EditJobRecord | null> {
  const database = assertDb();
  const doc = await database.collection(EDIT_JOBS).doc(jobId).get();
  return doc.exists ? (doc.data() as EditJobRecord) : null;
}

export async function listJobsByContent(
  contentId: string,
  limit: number,
  cursor?: string
): Promise<{ jobs: EditJobRecord[]; nextCursor: string | null }> {
  const database = assertDb();
  let q = database
    .collection(EDIT_JOBS)
    .where('contentId', '==', contentId)
    .orderBy('createdAt', 'desc')
    .limit(limit + 1);
  if (cursor) {
    const cursorDoc = await database.collection(EDIT_JOBS).doc(cursor).get();
    if (cursorDoc.exists) q = q.startAfter(cursorDoc);
  }
  const snap = await q.get();
  const jobs = snap.docs.slice(0, limit).map((d) => d.data() as EditJobRecord);
  return {
    jobs,
    nextCursor: snap.docs.length > limit ? (snap.docs[limit - 1]?.id ?? null) : null,
  };
}

// ── Internal ────────────────────────────────────────────────────────────

function versionFromDoc(doc: FirebaseFirestore.DocumentSnapshot): AssetVersion {
  const data = doc.data()!;
  return {
    ...(data as AssetVersion),
    createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
  };
}

function inferMimeFromMediaType(mediaType: string | undefined): string {
  switch (mediaType) {
    case 'video':
    case 'ai-video':
      return 'video/mp4';
    case 'image':
    case 'ai-image':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

/** Exported so routes can spread layers into a saveSessionState patch. */
export function normalizeLayers(layers: LayerState[]): LayerState[] {
  return layers.slice(0, 16).map((l) => ({
    id: l.id,
    kind: l.kind,
    visible: l.visible,
    opacity: Math.max(0, Math.min(1, l.opacity)),
  }));
}

export type { EditOp };
