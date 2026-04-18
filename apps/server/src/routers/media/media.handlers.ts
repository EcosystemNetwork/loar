import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import type { MediaAttachment, CreateAttachmentInput, UpdateAttachmentInput } from './media.types';

const col = () => db.collection('mediaAttachments');

function docToAttachment(doc: FirebaseFirestore.DocumentSnapshot): MediaAttachment {
  const d = doc.data()!;
  return {
    id: doc.id,
    contentHash: d.contentHash,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    size: d.size,
    url: d.url,
    targetType: d.targetType,
    targetId: d.targetId,
    targetName: d.targetName ?? '',
    category: d.category,
    label: d.label ?? '',
    subCategory: d.subCategory ?? null,
    version: d.version ?? 1,
    variantOf: d.variantOf ?? null,
    variantLabel: d.variantLabel ?? null,
    sortOrder: d.sortOrder ?? 0,
    generationId: d.generationId ?? null,
    creator: d.creator,
    createdAt: d.createdAt?.toDate?.() ?? new Date(d.createdAt),
    updatedAt: d.updatedAt?.toDate?.() ?? new Date(d.updatedAt),
  };
}

export async function createAttachment(
  creator: string,
  input: CreateAttachmentInput
): Promise<MediaAttachment> {
  const id = randomUUID();
  const now = new Date();
  const data = {
    ...input,
    subCategory: input.subCategory ?? null,
    version: input.version ?? 1,
    variantOf: input.variantOf ?? null,
    variantLabel: input.variantLabel ?? null,
    sortOrder: input.sortOrder ?? 0,
    generationId: input.generationId ?? null,
    creator: creator.toLowerCase(),
    createdAt: now,
    updatedAt: now,
  };
  await col().doc(id).set(data);
  return { id, ...data };
}

export async function getAttachmentsByTarget(
  targetType: string,
  targetId: string
): Promise<MediaAttachment[]> {
  const snap = await col()
    .where('targetType', '==', targetType)
    .where('targetId', '==', targetId)
    .get();
  return snap.docs
    .map(docToAttachment)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getAttachmentsByCreator(creator: string): Promise<MediaAttachment[]> {
  const snap = await col().where('creator', '==', creator.toLowerCase()).get();
  return snap.docs
    .map(docToAttachment)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 200);
}

/** Get all variants of a specific attachment (same variantOf chain). */
export async function getVariants(attachmentId: string): Promise<MediaAttachment[]> {
  // Get variants where variantOf points to this attachment
  const snap = await col().where('variantOf', '==', attachmentId).get();
  const variants = snap.docs
    .map(docToAttachment)
    .sort((a, b) => (a.version ?? 1) - (b.version ?? 1));

  // Also include the original attachment itself
  const originalDoc = await col().doc(attachmentId).get();
  if (originalDoc.exists) {
    variants.unshift(docToAttachment(originalDoc));
  }

  return variants;
}

export async function updateAttachment(
  creator: string,
  input: UpdateAttachmentInput
): Promise<MediaAttachment> {
  const ref = col().doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Attachment not found');
  if (snap.data()!.creator !== creator.toLowerCase()) throw new Error('Not authorized');
  const { id: _id, ...updates } = input;
  await ref.update({ ...updates, updatedAt: new Date() });
  return docToAttachment(await ref.get());
}

/** Batch-update sort order for multiple attachments. */
export async function reorderAttachments(
  creator: string,
  items: { id: string; sortOrder: number }[]
): Promise<void> {
  const batch = db.batch();
  for (const item of items) {
    const ref = col().doc(item.id);
    batch.update(ref, { sortOrder: item.sortOrder, updatedAt: new Date() });
  }
  await batch.commit();
}

export async function deleteAttachment(
  caller: string,
  id: string,
  opts?: { isUniverseAdmin?: boolean }
): Promise<void> {
  const ref = col().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Attachment not found');
  const isCreator = snap.data()!.creator === caller.toLowerCase();
  if (!isCreator && !opts?.isUniverseAdmin) throw new Error('Not authorized');
  await ref.delete();
}

/** Get the next version number for a given target + category. */
export async function getNextVersion(
  targetType: string,
  targetId: string,
  category: string,
  variantOf?: string | null
): Promise<number> {
  let query = col()
    .where('targetType', '==', targetType)
    .where('targetId', '==', targetId)
    .where('category', '==', category);

  if (variantOf) {
    query = query.where('variantOf', '==', variantOf);
  }

  const snap = await query.get();
  if (snap.empty) return 1;
  const maxVersion = Math.max(...snap.docs.map((d) => d.data().version ?? 0));
  return maxVersion + 1;
}
