/**
 * Sandbox Router
 *
 * Allows users to save and manage draft creations without needing a universe.
 * Draft items can later be promoted to a universe.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const sandboxCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('sandboxDrafts');
};
const contentCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('content');
};
const profilesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('profiles');
};

// Ownership check helper — supports drafts created by either address or uid.
// Drafts pre-2026-04-18 only had creatorAddress; new drafts have both.
function ownsDraft(
  data: FirebaseFirestore.DocumentData | undefined,
  user: { address?: string; uid: string }
): boolean {
  if (!data) return false;
  if (data.creatorUid && data.creatorUid === user.uid) return true;
  if (data.creatorAddress && user.address && data.creatorAddress === user.address) return true;
  return false;
}

export const sandboxRouter = router({
  // Save a draft item (image + optional video) to Firestore.
  // Auto-creates a gallery content record so all generated media is immediately visible.
  // Status stays 'draft' — promotion to a universe is an explicit separate action.
  // Auto-published content defaults to classification: 'fan' (no rights claim) and
  // visibility: 'unlisted'. Users explicitly upgrade rights/visibility on promote.
  saveDraft: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url().optional(),
        videoUrl: z.string().url().optional(),
        audioUrl: z.string().url().optional(),
        modelUrl: z.string().url().optional(),
        thumbnailUrl: z.string().url().optional(),
        kind: z.enum(['image', 'video', 'audio', '3d']).optional(),
        model: z.string().optional(),
        tags: z.array(z.string()).max(10).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const hasMedia = !!(input.videoUrl || input.imageUrl || input.audioUrl || input.modelUrl);
      // Pick the canonical media URL + content media type. Priority follows the
      // visual richness of the asset so the gallery shows the most useful preview.
      const primaryMediaUrl =
        input.videoUrl || input.modelUrl || input.audioUrl || input.imageUrl || '';
      const mediaType = input.videoUrl
        ? 'ai-video'
        : input.modelUrl
          ? 'ai-3d'
          : input.audioUrl
            ? 'ai-audio'
            : 'ai-image';

      const draftRef = await sandboxCol().add({
        creatorAddress: ctx.user.address,
        creatorUid: ctx.user.uid,
        title: input.title,
        prompt: input.prompt,
        imageUrl: input.imageUrl || null,
        videoUrl: input.videoUrl || null,
        audioUrl: input.audioUrl || null,
        modelUrl: input.modelUrl || null,
        thumbnailUrl: input.thumbnailUrl || input.imageUrl || null,
        kind: input.kind || (input.videoUrl ? 'video' : input.imageUrl ? 'image' : 'image'),
        model: input.model || null,
        tags: input.tags,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });

      let contentId: string | null = null;
      if (hasMedia) {
        const mediaUrl = primaryMediaUrl;

        // Use a deterministic document ID based on the user and media URL to prevent
        // phantom reads where concurrent transactions both find 0 results and create dupes.
        const crypto = await import('crypto');
        const hashId = crypto
          .createHash('sha256')
          .update(`${ctx.user.uid}:${mediaUrl}`)
          .digest('hex')
          .substring(0, 20);
        const contentRef = contentCol().doc(`ai-${hashId}`);

        const result = await db!.runTransaction(async (tx) => {
          const existingDoc = await tx.get(contentRef);

          if (existingDoc.exists) {
            tx.update(contentRef, {
              title: input.title,
              tags: input.tags || [],
              description: input.prompt || '',
              updatedAt: now,
            });
            return { contentId: existingDoc.id, created: false };
          }

          tx.set(contentRef, {
            title: input.title,
            description: input.prompt || '',
            mediaUrl,
            thumbnailUrl: input.thumbnailUrl || input.imageUrl || null,
            mediaType,
            classification: 'fan' as const,
            tags: input.tags || [],
            ipDeclaration: {
              isOriginal: false,
              usesCopyrightedMaterial: false,
              license: 'fan-work',
            },
            visibility: 'unlisted',
            creatorUid: ctx.user.uid,
            createdAt: now,
            updatedAt: now,
            views: 0,
            likes: 0,
            reviewStatus: 'not_required',
            contentStatus: 'active',
            contentStatusUpdatedAt: now.toISOString(),
            promotedFromDraft: draftRef.id,
            generationModel: input.model || null,
          });
          return { contentId: contentRef.id, created: true };
        });
        contentId = result.contentId;

        if (result.created) {
          try {
            await profilesCol()
              .doc(ctx.user.uid)
              .set({ contentCount: FieldValue.increment(1) }, { merge: true });
          } catch (e) {
            console.warn('[sandbox] profile counter update failed:', e);
          }
        }

        await draftRef.update({ galleryContentId: contentId, updatedAt: now });
      }

      return { id: draftRef.id, contentId };
    }),

  // Update an existing draft
  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        prompt: z.string().min(1).max(2000).optional(),
        model: z.string().optional(),
        videoUrl: z.string().url().optional(),
        imageUrl: z.string().url().optional(),
        tags: z.array(z.string()).max(10).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = sandboxCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      if (!ownsDraft(snap.data(), ctx.user))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.prompt !== undefined) updates.prompt = input.prompt;
      if (input.model !== undefined) updates.model = input.model;
      if (input.videoUrl !== undefined) updates.videoUrl = input.videoUrl;
      if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
      if (input.tags !== undefined) updates.tags = input.tags;

      await ref.update(updates);

      // Fix C: Sync properties to the mirror content doc so the gallery reflects edits
      const draftData = snap.data();
      if (draftData?.galleryContentId) {
        const contentUpdates: Record<string, any> = { updatedAt: new Date() };
        if (input.title !== undefined) contentUpdates.title = input.title;
        if (input.prompt !== undefined) contentUpdates.description = input.prompt;

        const isVideoOnly =
          draftData.kind === 'video' || (input.videoUrl !== undefined ? true : draftData.videoUrl);
        if (input.videoUrl !== undefined) {
          contentUpdates.mediaUrl = input.videoUrl;
        } else if (input.imageUrl !== undefined && !isVideoOnly) {
          contentUpdates.mediaUrl = input.imageUrl; // update main mediaUrl if strictly image
        }
        if (input.imageUrl !== undefined) {
          contentUpdates.thumbnailUrl = input.imageUrl;
        }
        if (input.tags !== undefined) contentUpdates.tags = input.tags;

        try {
          await contentCol().doc(draftData.galleryContentId).update(contentUpdates);
        } catch (e) {
          console.warn('[sandbox] gallery item sync update failed:', e);
        }
      }

      return { ok: true };
    }),

  // Delete a draft
  deleteDraft: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ref = sandboxCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      if (!ownsDraft(snap.data(), ctx.user))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
      await ref.delete();
      return { ok: true };
    }),

  // Get drafts for the current user. Looks up by both creatorUid and legacy
  // creatorAddress and dedupes, so drafts saved without an address still list.
  // Returns a flat array for backwards compatibility with existing consumers
  // (web sandbox UI, mobile drafts screen, ops scripts).
  myDrafts: protectedProcedure.query(async ({ ctx }) => {
    const PER_FIELD_LIMIT = 200;

    const buildQuery = (field: 'creatorUid' | 'creatorAddress', value: string) =>
      sandboxCol()
        .where(field, '==', value)
        .orderBy('createdAt', 'desc')
        .limit(PER_FIELD_LIMIT)
        .get();

    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      buildQuery('creatorUid', ctx.user.uid),
    ];
    if (ctx.user.address) {
      queries.push(buildQuery('creatorAddress', ctx.user.address));
    }
    const snaps = await Promise.all(queries);

    const seen = new Set<string>();
    const merged: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        merged.push({ id: doc.id, data: doc.data() });
      }
    }
    merged.sort((a, b) => {
      const ta = a.data.createdAt?.toDate?.()?.getTime?.() ?? 0;
      const tb = b.data.createdAt?.toDate?.()?.getTime?.() ?? 0;
      return tb - ta;
    });

    return merged.slice(0, PER_FIELD_LIMIT).map(({ id, data: d }) => ({
      id,
      title: d.title as string,
      prompt: d.prompt as string,
      imageUrl: d.imageUrl as string | null,
      videoUrl: d.videoUrl as string | null,
      audioUrl: (d.audioUrl as string | null) ?? null,
      modelUrl: (d.modelUrl as string | null) ?? null,
      thumbnailUrl: (d.thumbnailUrl as string | null) ?? (d.imageUrl as string | null) ?? null,
      kind: (d.kind as string | null) ?? (d.videoUrl ? 'video' : 'image'),
      model: d.model as string | null,
      tags: d.tags as string[],
      status: d.status as string,
      createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? null,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
    }));
  }),

  /**
   * List universes the caller can directly promote content into. Powers the
   * Sandbox auto-send picker so users only see valid targets — picking an
   * unauthorised universe would fail server-side anyway (promoteToUniverse
   * enforces isUniverseAdmin), but filtering here avoids the bad UX.
   *
   * Single-owner universes match on `creator == caller.address`.
   * Multi-sig universes are checked on-chain via isUniverseAdmin, so this
   * may issue N RPC calls — kept bounded by the small testnet universe set.
   */
  myPromotableUniverses: protectedProcedure.query(async ({ ctx }) => {
    if (!db) return [];
    const address = ctx.user.address?.toLowerCase();
    if (!address) return [];

    const col = db.collection('cinematicUniverses');

    const [ownedSnap, multiSigSnap] = await Promise.all([
      col.where('creator', '==', address).get(),
      col.where('isMultiSig', '==', true).get(),
    ]);

    const byId = new Map<string, FirebaseFirestore.DocumentData>();
    for (const doc of ownedSnap.docs) byId.set(doc.id, doc.data());

    // Multi-sig: only include after on-chain ownership check passes.
    if (!multiSigSnap.empty) {
      const { isUniverseAdmin } = await import('../../lib/safe-admin');
      const checks = await Promise.all(
        multiSigSnap.docs
          .filter((d) => !byId.has(d.id))
          .map(async (d) => ({
            id: d.id,
            data: d.data(),
            isAdmin: await isUniverseAdmin(d.id, address, d.data().chainId),
          }))
      );
      for (const c of checks) if (c.isAdmin) byId.set(c.id, c.data);
    }

    return Array.from(byId.entries())
      .filter(([, d]) => !d.isHidden)
      .map(([id, d]) => ({
        id,
        name: (d.name as string | null) ?? null,
        image_url: (d.image_url as string | null) ?? null,
        isMultiSig: Boolean(d.isMultiSig),
      }))
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  }),

  /**
   * Promote a sandbox draft to gallery content.
   * If universeId is provided, it goes into that universe's gallery.
   * If omitted, it goes into the creator's general gallery (no universe).
   */
  promoteToUniverse: protectedProcedure
    .input(
      z.object({
        draftId: z.string(),
        universeId: z.string().optional(),
        classification: z.enum(['fan', 'original', 'licensed']).default('fan'),
        visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = sandboxCol().doc(input.draftId);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });

      const draft = snap.data()!;
      if (!ownsDraft(draft, ctx.user))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });

      // Fix A: IDOR Patch. Validate universe access.
      if (input.universeId) {
        const { isUniverseAdmin } = await import('../../lib/safe-admin');
        const isAdmin = await isUniverseAdmin(input.universeId, ctx.user.uid);
        if (!isAdmin) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You must be a universe admin to promote content directly to this universe.',
          });
        }
      }

      const now = new Date();
      const mediaUrl = draft.videoUrl || draft.imageUrl || '';
      const mediaType = draft.videoUrl ? 'ai-video' : draft.imageUrl ? 'ai-image' : 'image';

      // ipDeclaration / reviewStatus follow content.routes.ts rules so the
      // moderation + monetization gates accept the record.
      const ipDeclaration =
        input.classification === 'fan'
          ? { isOriginal: false, usesCopyrightedMaterial: false, license: 'fan-work' as const }
          : {
              isOriginal: true,
              usesCopyrightedMaterial: false,
              license: 'all-rights-reserved' as const,
            };
      const reviewStatus = input.classification === 'licensed' ? 'pending' : 'not_required';

      const { contentId, created } = await db!.runTransaction(async (tx) => {
        const existingSnap = await tx.get(
          contentCol()
            .where('mediaUrl', '==', mediaUrl)
            .where('creatorUid', '==', ctx.user.uid)
            .limit(1)
        );

        if (!existingSnap.empty) {
          const existingDoc = existingSnap.docs[0];
          const updates: Record<string, any> = {
            classification: input.classification,
            visibility: input.visibility,
            ipDeclaration,
            reviewStatus,
            updatedAt: now,
          };
          if (input.universeId) updates.universeId = input.universeId;
          tx.update(existingDoc.ref, updates);
          return { contentId: existingDoc.id, created: false };
        }

        const newRef = contentCol().doc();
        const contentData: Record<string, any> = {
          title: draft.title,
          description: draft.prompt || '',
          mediaUrl,
          thumbnailUrl: draft.imageUrl || null,
          mediaType,
          classification: input.classification,
          tags: draft.tags || [],
          ipDeclaration,
          visibility: input.visibility,
          creatorUid: ctx.user.uid,
          createdAt: now,
          updatedAt: now,
          views: 0,
          likes: 0,
          reviewStatus,
          contentStatus: 'active',
          contentStatusUpdatedAt: now.toISOString(),
          promotedFromDraft: input.draftId,
          generationModel: draft.model || null,
        };
        if (input.universeId) contentData.universeId = input.universeId;
        tx.set(newRef, contentData);
        return { contentId: newRef.id, created: true };
      });

      if (created) {
        try {
          await profilesCol()
            .doc(ctx.user.uid)
            .set({ contentCount: FieldValue.increment(1) }, { merge: true });
        } catch (e) {
          console.warn('[sandbox] profile counter update failed:', e);
        }
      }

      await ref.update({
        status: 'promoted',
        promotedTo: contentId,
        ...(input.universeId ? { promotedUniverseId: input.universeId } : {}),
        updatedAt: now,
      });

      return { contentId, universeId: input.universeId ?? null };
    }),

  // Get a single draft
  getDraft: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const snap = await sandboxCol().doc(input.id).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    if (!ownsDraft(d, ctx.user)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
    }
    return {
      id: snap.id,
      title: d.title as string,
      prompt: d.prompt as string,
      imageUrl: d.imageUrl as string | null,
      videoUrl: d.videoUrl as string | null,
      model: d.model as string | null,
      tags: d.tags as string[],
      status: d.status as string,
      createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? null,
    };
  }),
});
