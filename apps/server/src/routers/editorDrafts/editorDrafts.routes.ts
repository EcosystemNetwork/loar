/**
 * Editor Drafts Router (E7) — persist editor session state per creator.
 *
 * The editor page can call `save` opportunistically (debounced ~5s on the
 * client). `list` shows the user's recent drafts; `resume` returns one for
 * the editor to hydrate. LRU pruned at 20 per user.
 *
 * Stored shape is intentionally narrow — we only persist the load-bearing
 * editor state (current video/image/audio + title + universe + lineage).
 * Anything that can be recomputed (history queries, generation runs) is
 * deliberately omitted to keep drafts cheap and forward-compatible.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_DRAFTS_PER_USER = 20;

const draftCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('editorDrafts');
};

const draftSchema = z.object({
  draftId: z.string().optional(),
  title: z.string().max(200).default(''),
  description: z.string().max(2000).default(''),
  universeId: z.string().optional(),
  videoUrl: z.string().url().nullable().default(null),
  imageUrl: z.string().url().nullable().default(null),
  audioUrl: z.string().url().nullable().default(null),
  /** Editor state blob — opaque payload the editor hydrates from. Capped
   *  to 64 KiB so drafts can't blow up the Firestore doc limit. */
  state: z.record(z.string(), z.unknown()).optional(),
});

async function pruneOldDrafts(uid: string): Promise<void> {
  const snap = await draftCol()
    .where('creatorUid', '==', uid)
    .orderBy('updatedAt', 'desc')
    .offset(MAX_DRAFTS_PER_USER)
    .get();
  if (snap.empty) return;
  const batch = db!.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export const editorDraftsRouter = router({
  /** Create or update a draft. Returns the draft id either way. */
  save: protectedProcedure.input(draftSchema).mutation(async ({ input, ctx }) => {
    const stateSize = JSON.stringify(input.state ?? {}).length;
    if (stateSize > 64 * 1024) {
      throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Editor state exceeds 64 KiB' });
    }

    const now = new Date();
    const payload = {
      creatorUid: ctx.user.uid,
      creatorAddress: ctx.user.address ?? null,
      title: input.title,
      description: input.description,
      universeId: input.universeId ?? null,
      videoUrl: input.videoUrl,
      imageUrl: input.imageUrl,
      audioUrl: input.audioUrl,
      state: input.state ?? {},
      updatedAt: now,
    };

    if (input.draftId) {
      const ref = draftCol().doc(input.draftId);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      }
      if (doc.data()?.creatorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
      }
      await ref.update(payload);
      return { id: input.draftId };
    }

    const ref = await draftCol().add({ ...payload, createdAt: FieldValue.serverTimestamp() });
    // Fire-and-forget LRU prune — never block the save on it
    pruneOldDrafts(ctx.user.uid).catch((err) => console.error('[editorDrafts] prune failed:', err));
    return { id: ref.id };
  }),

  /** Latest 20 drafts for the caller, newest first. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const snap = await draftCol()
      .where('creatorUid', '==', ctx.user.uid)
      .orderBy('updatedAt', 'desc')
      .limit(MAX_DRAFTS_PER_USER)
      .get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title || 'Untitled',
        description: data.description || '',
        universeId: data.universeId,
        videoUrl: data.videoUrl,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });
  }),

  /** Full draft (state included) for hydration on resume. */
  get: protectedProcedure.input(z.object({ draftId: z.string() })).query(async ({ input, ctx }) => {
    const doc = await draftCol().doc(input.draftId).get();
    if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
    const data = doc.data()!;
    if (data.creatorUid !== ctx.user.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
    }
    return { id: doc.id, ...data };
  }),

  delete: protectedProcedure
    .input(z.object({ draftId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = draftCol().doc(input.draftId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      if (doc.data()?.creatorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
      }
      await ref.delete();
      return { ok: true };
    }),
});
