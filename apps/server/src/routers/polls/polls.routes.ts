/**
 * Polls Router
 *
 * Non-binding community polls for universe narrative decisions.
 * Supports story direction votes, character fate polls, world events,
 * and canon submissions that feed into on-chain governance.
 *
 * Pipeline: poll creation → community voting → promote to canon submission → on-chain proposal
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { TRPCError } from '@trpc/server';
import { emitActivity, sendNotification } from '../../services/activity';

// ── Firestore collections (lazy-init) ──────────────────────────────────
const pollsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('polls');
};
const pollVotesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('pollVotes');
};
const canonSubmissionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('canonSubmissions');
};

// ── Schemas ────────────────────────────────────────────────────────────
const pollTypeEnum = z.enum([
  'story_direction',
  'character_fate',
  'world_event',
  'general',
  'canon_submission',
]);

const createPollSchema = z.object({
  universeAddress: z.string(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  options: z.array(z.string().min(1).max(200)).min(2).max(10),
  type: pollTypeEnum,
  endsAt: z.string().datetime(),
  allowMultiple: z.boolean().default(false),
  tokenWeighted: z.boolean().default(false),
  linkedEntityId: z.string().optional(),
  linkedContentId: z.string().optional(),
});

// ── Router ─────────────────────────────────────────────────────────────
export const pollsRouter = router({
  /** Create a new community poll */
  create: protectedProcedure.input(createPollSchema).mutation(async ({ ctx, input }) => {
    const pollId = randomUUID();

    const options = input.options.map((text) => ({
      id: randomUUID(),
      text,
      voteCount: 0,
    }));

    const poll = {
      id: pollId,
      creatorUid: ctx.user.uid,
      creatorAddress: ctx.user.address ?? null,
      universeAddress: input.universeAddress,
      title: input.title,
      description: input.description ?? null,
      options,
      type: input.type,
      status: 'active' as const,
      endsAt: input.endsAt,
      allowMultiple: input.allowMultiple,
      tokenWeighted: input.tokenWeighted,
      linkedEntityId: input.linkedEntityId ?? null,
      linkedContentId: input.linkedContentId ?? null,
      totalVotes: 0,
      createdAt: new Date().toISOString(),
    };

    await pollsCol().doc(pollId).set(poll);

    emitActivity({
      actorUid: ctx.user.uid,
      actorAddress: ctx.user.address ?? undefined,
      eventType: 'created_proposal',
      targetType: 'poll',
      targetId: pollId,
      targetTitle: input.title,
      metadata: {
        universeAddress: input.universeAddress,
        pollType: input.type,
      },
    });

    return { ...poll, id: pollId };
  }),

  /** Cast a vote on a poll */
  vote: protectedProcedure
    .input(
      z.object({
        pollId: z.string(),
        optionIds: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const voteDocId = `${input.pollId}_${ctx.user.uid}`;

      await db!.runTransaction(async (tx) => {
        const pollRef = pollsCol().doc(input.pollId);
        const pollSnap = await tx.get(pollRef);

        if (!pollSnap.exists) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Poll not found' });
        }

        const poll = pollSnap.data()!;

        if (poll.status !== 'active') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Poll is not active' });
        }

        if (new Date(poll.endsAt) <= new Date()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Poll has expired' });
        }

        // Check for duplicate vote
        const voteRef = pollVotesCol().doc(voteDocId);
        const existingVote = await tx.get(voteRef);
        if (existingVote.exists) {
          throw new TRPCError({ code: 'CONFLICT', message: 'You have already voted on this poll' });
        }

        // Validate single-vote constraint
        if (!poll.allowMultiple && input.optionIds.length > 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This poll only allows a single vote',
          });
        }

        // Validate all optionIds exist
        const validOptionIds = new Set((poll.options as { id: string }[]).map((o) => o.id));
        for (const optionId of input.optionIds) {
          if (!validOptionIds.has(optionId)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid option ID: ${optionId}`,
            });
          }
        }

        // Increment vote counts on matched options
        const updatedOptions = (
          poll.options as { id: string; text: string; voteCount: number }[]
        ).map((opt) => ({
          ...opt,
          voteCount: input.optionIds.includes(opt.id) ? opt.voteCount + 1 : opt.voteCount,
        }));

        tx.update(pollRef, {
          options: updatedOptions,
          totalVotes: FieldValue.increment(1),
        });

        // Record vote
        tx.set(voteRef, {
          pollId: input.pollId,
          optionIds: input.optionIds,
          voterUid: ctx.user.uid,
          voterAddress: ctx.user.address ?? null,
          createdAt: new Date().toISOString(),
        });
      });

      emitActivity({
        actorUid: ctx.user.uid,
        actorAddress: ctx.user.address ?? undefined,
        eventType: 'voted_proposal',
        targetType: 'poll',
        targetId: input.pollId,
      });

      return { ok: true };
    }),

  /** List polls for a universe */
  list: publicProcedure
    .input(
      z.object({
        universeAddress: z.string(),
        status: z.enum(['active', 'ended']).optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = pollsCol()
        .where('universeAddress', '==', input.universeAddress)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await pollsCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const now = new Date();

      let polls = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Filter by status (active = endsAt > now, ended = endsAt <= now or status != active)
      if (input.status === 'active') {
        polls = polls.filter((p: any) => p.status === 'active' && new Date(p.endsAt) > now);
      } else if (input.status === 'ended') {
        polls = polls.filter((p: any) => p.status !== 'active' || new Date(p.endsAt) <= now);
      }

      return {
        polls,
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Get a single poll with optional user vote */
  get: publicProcedure.input(z.object({ pollId: z.string() })).query(
    async ({
      ctx,
      input,
    }): Promise<{
      id: string;
      title: string;
      description?: string;
      type: string;
      status: string;
      universeAddress: string;
      creatorUid: string;
      totalVotes: number;
      options: Array<{ id: string; text: string; voteCount: number }>;
      endsAt: any;
      createdAt: any;
      userVote?: Record<string, any> | null;
      linkedEntityId?: string;
      linkedContentId?: string;
    }> => {
      const doc = await pollsCol().doc(input.pollId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Poll not found' });
      }

      const data = doc.data()!;

      // Check if authenticated user has voted
      let userVote = null;
      if (ctx.user) {
        const voteDocId = `${input.pollId}_${ctx.user.uid}`;
        const voteSnap = await pollVotesCol().doc(voteDocId).get();
        if (voteSnap.exists) {
          userVote = voteSnap.data() ?? null;
        }
      }

      return {
        id: doc.id,
        title: data.title,
        description: data.description,
        type: data.type,
        status: data.status,
        universeAddress: data.universeAddress,
        creatorUid: data.creatorUid,
        totalVotes: data.totalVotes || 0,
        options: data.options || [],
        endsAt: data.endsAt,
        createdAt: data.createdAt,
        userVote,
        linkedEntityId: data.linkedEntityId,
        linkedContentId: data.linkedContentId,
      };
    }
  ),

  /** Close a poll (creator or admin only) */
  close: protectedProcedure
    .input(z.object({ pollId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await pollsCol().doc(input.pollId).get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Poll not found' });
      }

      const poll = doc.data()!;
      if (poll.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the poll creator can close this poll',
        });
      }

      await pollsCol().doc(input.pollId).update({ status: 'ended' });

      return { ok: true };
    }),

  /** Promote a poll result to a canon submission for governance */
  promoteToCanon: protectedProcedure
    .input(
      z.object({
        pollId: z.string(),
        winningOptionId: z.string(),
        canonSubmissionTitle: z.string().min(3).max(200),
        canonSubmissionDescription: z.string().min(10).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pollDoc = await pollsCol().doc(input.pollId).get();
      if (!pollDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Poll not found' });
      }

      const poll = pollDoc.data()!;

      if (poll.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the poll creator can promote to canon',
        });
      }

      // Validate winning option exists
      const winningOption = (
        poll.options as { id: string; text: string; voteCount: number }[]
      ).find((o) => o.id === input.winningOptionId);
      if (!winningOption) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid winning option ID' });
      }

      const submissionId = randomUUID();

      const canonSubmission = {
        id: submissionId,
        pollId: input.pollId,
        universeAddress: poll.universeAddress,
        title: input.canonSubmissionTitle,
        description: input.canonSubmissionDescription,
        winningOptionId: input.winningOptionId,
        winningOptionText: winningOption.text,
        winningVoteCount: winningOption.voteCount,
        totalPollVotes: poll.totalVotes,
        submitterUid: ctx.user.uid,
        submitterAddress: ctx.user.address ?? null,
        status: 'pending',
        linkedEntityId: poll.linkedEntityId ?? null,
        linkedContentId: poll.linkedContentId ?? null,
        createdAt: new Date().toISOString(),
      };

      await canonSubmissionsCol().doc(submissionId).set(canonSubmission);

      await pollsCol().doc(input.pollId).update({ status: 'promoted_to_canon' });

      emitActivity({
        actorUid: ctx.user.uid,
        actorAddress: ctx.user.address ?? undefined,
        eventType: 'submitted_canon',
        targetType: 'canon_submission',
        targetId: submissionId,
        targetTitle: input.canonSubmissionTitle,
        metadata: {
          pollId: input.pollId,
          universeAddress: poll.universeAddress,
        },
      });

      return { ...canonSubmission, id: submissionId };
    }),

  /** Get detailed vote breakdown for a poll */
  getResults: publicProcedure.input(z.object({ pollId: z.string() })).query(async ({ input }) => {
    const doc = await pollsCol().doc(input.pollId).get();
    if (!doc.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Poll not found' });
    }

    const poll = doc.data()!;
    const totalVotes = poll.totalVotes || 0;

    const options = (poll.options as { id: string; text: string; voteCount: number }[]).map(
      (opt) => ({
        ...opt,
        percentage: totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 10000) / 100 : 0,
      })
    );

    return {
      id: doc.id,
      title: poll.title,
      description: poll.description,
      type: poll.type,
      status: poll.status,
      universeAddress: poll.universeAddress,
      totalVotes,
      options,
      endsAt: poll.endsAt,
      createdAt: poll.createdAt,
      linkedEntityId: poll.linkedEntityId,
      linkedContentId: poll.linkedContentId,
    };
  }),
});
