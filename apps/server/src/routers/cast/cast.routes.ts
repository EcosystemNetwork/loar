/**
 * Cast Router — Universe Character Identity System
 *
 * CRUD for persistent cast members attached to a universe.
 * Each cast member has reference images used for identity conditioning
 * during AI video/image generation, ensuring character consistency
 * across all nodes in a universe.
 *
 * Firestore collection: `castMembers` (flat, indexed by universeId)
 */

import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

// ── Collection ref ───────────────────────────────────────────────────

const castCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('castMembers');
};

// ── Helpers ──────────────────────────────────────────────────────────

async function assertUniverseAdmin(universeId: string, callerUid: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');

  const universeDoc = await db.collection('cinematicUniverses').doc(universeId.toLowerCase()).get();

  if (!universeDoc.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
  }

  const creator = universeDoc.data()?.creator?.toLowerCase();
  if (creator !== callerUid.toLowerCase()) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the universe creator can manage cast members',
    });
  }
}

// ── Router ───────────────────────────────────────────────────────────

export const castRouter = router({
  /**
   * List all cast members for a universe.
   */
  list: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snapshot = await castCol()
      .where('universeId', '==', input.universeId.toLowerCase())
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        universeId: data.universeId,
        name: data.name,
        description: data.description || '',
        referenceImageHashes: data.referenceImageHashes || [],
        referenceImageUrls: data.referenceImageUrls || [],
        createdBy: data.createdBy,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
      };
    });
  }),

  /**
   * Get a single cast member by ID.
   */
  get: publicProcedure.input(z.object({ castId: z.string() })).query(async ({ input }) => {
    const doc = await castCol().doc(input.castId).get();
    if (!doc.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Cast member not found' });
    }
    const data = doc.data()!;
    return {
      id: doc.id,
      universeId: data.universeId,
      name: data.name,
      description: data.description || '',
      referenceImageHashes: data.referenceImageHashes || [],
      referenceImageUrls: data.referenceImageUrls || [],
      createdBy: data.createdBy,
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
    };
  }),

  /**
   * Create a new cast member. Universe admin only.
   */
  create: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().max(2000).default(''),
        referenceImageHashes: z.array(z.string()).max(10).default([]),
        referenceImageUrls: z.array(z.string().url()).max(10).default([]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertUniverseAdmin(input.universeId, ctx.user.uid);

      const castId = randomUUID();
      const now = new Date();

      await castCol().doc(castId).set({
        universeId: input.universeId.toLowerCase(),
        name: input.name,
        description: input.description,
        referenceImageHashes: input.referenceImageHashes,
        referenceImageUrls: input.referenceImageUrls,
        createdBy: ctx.user.uid.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });

      return {
        id: castId,
        universeId: input.universeId.toLowerCase(),
        name: input.name,
        description: input.description,
        referenceImageHashes: input.referenceImageHashes,
        referenceImageUrls: input.referenceImageUrls,
        createdBy: ctx.user.uid.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      };
    }),

  /**
   * Update a cast member. Universe admin only.
   */
  update: protectedProcedure
    .input(
      z.object({
        castId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await castCol().doc(input.castId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Cast member not found' });
      }

      const data = doc.data()!;
      await assertUniverseAdmin(data.universeId, ctx.user.uid);

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;

      await castCol().doc(input.castId).update(updates);

      return { id: input.castId, ...updates };
    }),

  /**
   * Add a reference image to a cast member. Universe admin only.
   * The image should already be uploaded to storage — pass the hash and URL.
   */
  addReferenceImage: protectedProcedure
    .input(
      z.object({
        castId: z.string(),
        imageHash: z.string(),
        imageUrl: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await castCol().doc(input.castId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Cast member not found' });
      }

      const data = doc.data()!;
      await assertUniverseAdmin(data.universeId, ctx.user.uid);

      const currentHashes: string[] = data.referenceImageHashes || [];
      const currentUrls: string[] = data.referenceImageUrls || [];

      if (currentHashes.length >= 10) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Maximum 10 reference images per cast member',
        });
      }

      // Deduplicate by hash
      if (currentHashes.includes(input.imageHash)) {
        return {
          id: input.castId,
          referenceImageHashes: currentHashes,
          referenceImageUrls: currentUrls,
        };
      }

      await castCol()
        .doc(input.castId)
        .update({
          referenceImageHashes: FieldValue.arrayUnion(input.imageHash),
          referenceImageUrls: FieldValue.arrayUnion(input.imageUrl),
          updatedAt: new Date(),
        });

      return {
        id: input.castId,
        referenceImageHashes: [...currentHashes, input.imageHash],
        referenceImageUrls: [...currentUrls, input.imageUrl],
      };
    }),

  /**
   * Remove a reference image from a cast member.
   */
  removeReferenceImage: protectedProcedure
    .input(
      z.object({
        castId: z.string(),
        imageHash: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await castCol().doc(input.castId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Cast member not found' });
      }

      const data = doc.data()!;
      await assertUniverseAdmin(data.universeId, ctx.user.uid);

      // Find the URL that corresponds to this hash to remove both
      const hashes: string[] = data.referenceImageHashes || [];
      const urls: string[] = data.referenceImageUrls || [];
      const idx = hashes.indexOf(input.imageHash);

      if (idx === -1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Image hash not found on this cast member',
        });
      }

      const urlToRemove = urls[idx];
      const updates: Record<string, any> = {
        referenceImageHashes: FieldValue.arrayRemove(input.imageHash),
        updatedAt: new Date(),
      };
      if (urlToRemove) {
        updates.referenceImageUrls = FieldValue.arrayRemove(urlToRemove);
      }

      await castCol().doc(input.castId).update(updates);

      return { id: input.castId };
    }),

  /**
   * Delete a cast member entirely. Universe admin only.
   */
  delete: protectedProcedure
    .input(z.object({ castId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await castCol().doc(input.castId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Cast member not found' });
      }

      const data = doc.data()!;
      await assertUniverseAdmin(data.universeId, ctx.user.uid);

      await castCol().doc(input.castId).delete();

      return { deleted: true, id: input.castId };
    }),
});
