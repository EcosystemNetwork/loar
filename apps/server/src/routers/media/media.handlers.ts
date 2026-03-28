import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import type {
  MediaAttachment,
  CreateAttachmentInput,
  UpdateAttachmentInput,
} from './media.types';

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
  const data = { ...input, creator: creator.toLowerCase(), createdAt: now, updatedAt: now };
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
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map(docToAttachment);
}

export async function getAttachmentsByCreator(creator: string): Promise<MediaAttachment[]> {
  const snap = await col()
    .where('creator', '==', creator.toLowerCase())
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  return snap.docs.map(docToAttachment);
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

export async function deleteAttachment(creator: string, id: string): Promise<void> {
  const ref = col().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Attachment not found');
  if (snap.data()!.creator !== creator.toLowerCase()) throw new Error('Not authorized');
  await ref.delete();
}
