/**
 * Comments Router
 *
 * General-purpose commenting system for universes, episodes, and content.
 * Supports threaded replies (1 level), likes, and author-only deletion.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const commentsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('comments');
};

const profilesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('profiles');
};

const targetTypeEnum = z.enum(['universe', 'episode', 'content']);

export const commentsRouter = router({
  /** Add a comment or reply */
  add: protectedProcedure
    .input(
      z.object({
        targetId: z.string().min(1),
        targetType: targetTypeEnum,
        text: z.string().min(1).max(2000),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const authorUid = ctx.user.uid;

      // If replying, verify parent comment exists and belongs to the same target
      if (input.parentId) {
        const parentDoc = await commentsCol().doc(input.parentId).get();
        if (!parentDoc.exists) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent comment not found' });
        }
        const parentData = parentDoc.data()!;
        if (parentData.targetId !== input.targetId || parentData.targetType !== input.targetType) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Parent comment belongs to a different target',
          });
        }
        // Prevent deeply nested replies — only allow 1 level
        if (parentData.parentId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot reply to a reply' });
        }
      }

      // Fetch display name from profile
      const profileDoc = await profilesCol().doc(authorUid).get();
      const authorDisplayName = profileDoc.data()?.displayName || authorUid;

      const now = new Date();
      const docRef = commentsCol().doc();

      const comment = {
        id: docRef.id,
        targetId: input.targetId,
        targetType: input.targetType,
        authorUid,
        authorDisplayName,
        text: input.text,
        parentId: input.parentId || null,
        likes: 0,
        likedBy: [],
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(comment);

      return { ok: true, comment };
    }),

  /** List comments for a target (paginated, top-level + replies) */
  list: publicProcedure
    .input(
      z.object({
        targetId: z.string().min(1),
        targetType: targetTypeEnum,
        limit: z.number().min(1).max(100).default(25),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // Fetch top-level comments (no parentId)
      let query = commentsCol()
        .where('targetId', '==', input.targetId)
        .where('targetType', '==', input.targetType)
        .where('parentId', '==', null)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await commentsCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      const topLevelComments = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() ?? doc.data().createdAt,
        updatedAt: doc.data().updatedAt?.toDate?.() ?? doc.data().updatedAt,
      }));

      // Fetch replies for each top-level comment
      const topLevelIds = topLevelComments.map((c) => c.id);
      const replies: any[] = [];

      if (topLevelIds.length > 0) {
        // Firestore `in` queries cap at 30
        const batches: string[][] = [];
        for (let i = 0; i < topLevelIds.length; i += 30) {
          batches.push(topLevelIds.slice(i, i + 30));
        }

        for (const batch of batches) {
          const repliesSnap = await commentsCol()
            .where('parentId', 'in', batch)
            .orderBy('createdAt', 'asc')
            .get();

          replies.push(
            ...repliesSnap.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
              createdAt: doc.data().createdAt?.toDate?.() ?? doc.data().createdAt,
              updatedAt: doc.data().updatedAt?.toDate?.() ?? doc.data().updatedAt,
            }))
          );
        }
      }

      // Group replies by parentId
      const repliesByParent: Record<string, any[]> = {};
      for (const reply of replies) {
        const pid = reply.parentId as string;
        if (!repliesByParent[pid]) repliesByParent[pid] = [];
        repliesByParent[pid].push(reply);
      }

      const comments = topLevelComments.map((c) => ({
        ...c,
        replies: repliesByParent[c.id] || [],
      }));

      return {
        comments,
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Delete own comment */
  delete: protectedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await commentsCol().doc(input.commentId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      }

      if (doc.data()!.authorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own comments',
        });
      }

      // Delete the comment and any replies to it
      const repliesSnap = await commentsCol().where('parentId', '==', input.commentId).get();
      const batch = db!.batch();
      batch.delete(doc.ref);
      repliesSnap.docs.forEach((replyDoc) => batch.delete(replyDoc.ref));
      await batch.commit();

      return { ok: true };
    }),

  /** Like a comment */
  like: protectedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.user.uid;
      const ref = commentsCol().doc(input.commentId);

      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      }

      const likedBy: string[] = doc.data()!.likedBy || [];
      if (likedBy.includes(uid)) {
        return { ok: true, alreadyLiked: true };
      }

      await ref.update({
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(uid),
      });

      return { ok: true };
    }),

  /** Unlike a comment */
  unlike: protectedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.user.uid;
      const ref = commentsCol().doc(input.commentId);

      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      }

      const likedBy: string[] = doc.data()!.likedBy || [];
      if (!likedBy.includes(uid)) {
        return { ok: true, notLiked: true };
      }

      await ref.update({
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(uid),
      });

      return { ok: true };
    }),
});
