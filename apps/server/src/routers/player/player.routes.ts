/**
 * Player Router
 *
 * Interactive branching video player session management.
 * Tracks user paths through universe node graphs and aggregates
 * branch choice analytics.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const sessionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('playbackSessions');
};

const branchAnalyticsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('branchAnalytics');
};

export const playerRouter = router({
  /** Start or resume a playback session */
  startSession: protectedProcedure
    .input(z.object({ universeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check for existing session
      const existing = await sessionsCol()
        .where('userAddress', '==', ctx.user.address?.toLowerCase())
        .where('universeId', '==', input.universeId)
        .where('completed', '==', false)
        .limit(1)
        .get();

      if (!existing.empty) {
        const doc = existing.docs[0];
        await doc.ref.update({ lastActivityAt: new Date() });
        return { sessionId: doc.id, ...doc.data(), resumed: true };
      }

      // Create new session
      const ref = await sessionsCol().add({
        userAddress: ctx.user.address?.toLowerCase(),
        universeId: input.universeId,
        currentNodeId: 1, // Start at root
        pathHistory: [1],
        startedAt: new Date(),
        lastActivityAt: new Date(),
        completed: false,
      });

      return {
        sessionId: ref.id,
        currentNodeId: 1,
        pathHistory: [1],
        resumed: false,
      };
    }),

  /** Record a branch choice */
  recordChoice: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        nodeId: z.number(),
        fromNodeId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sessionRef = sessionsCol().doc(input.sessionId);

      // Verify session ownership
      const sessionDoc = await sessionRef.get();
      if (
        !sessionDoc.exists ||
        sessionDoc.data()?.userAddress !== ctx.user.address?.toLowerCase()
      ) {
        throw new Error('Session not found or not owned by user');
      }

      await sessionRef.update({
        currentNodeId: input.nodeId,
        pathHistory: FieldValue.arrayUnion(input.nodeId),
        lastActivityAt: new Date(),
      });

      // Update branch analytics
      const session = await sessionRef.get();
      const universeId = session.data()?.universeId;
      if (universeId) {
        const analyticsId = `${universeId}_${input.fromNodeId}`;
        const analyticsRef = branchAnalyticsCol().doc(analyticsId);

        await analyticsRef.set(
          {
            universeId,
            nodeId: input.fromNodeId,
            [`choiceDistribution.${input.nodeId}`]: FieldValue.increment(1),
            totalPlays: FieldValue.increment(1),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }

      return { ok: true };
    }),

  /** Complete a session (reached a leaf node) */
  completeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await sessionsCol().doc(input.sessionId).get();
      if (!doc.exists || doc.data()?.userAddress !== ctx.user.address?.toLowerCase()) {
        throw new Error('Session not found or not owned by user');
      }
      await sessionsCol().doc(input.sessionId).update({
        completed: true,
        completedAt: new Date(),
      });
      return { ok: true };
    }),

  /** Get branch analytics for a specific node */
  getBranchAnalytics: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        nodeId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const docId = `${input.universeId}_${input.nodeId}`;
      const doc = await branchAnalyticsCol().doc(docId).get();

      if (!doc.exists) {
        return { nodeId: input.nodeId, choiceDistribution: {}, totalPlays: 0 };
      }

      return { nodeId: input.nodeId, ...doc.data() };
    }),

  /** Get user's session for a universe */
  getSession: protectedProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await sessionsCol()
        .where('userAddress', '==', ctx.user.address?.toLowerCase())
        .where('universeId', '==', input.universeId)
        .orderBy('lastActivityAt', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) return null;
      const doc = snapshot.docs[0];
      return { sessionId: doc.id, ...doc.data() };
    }),
});
