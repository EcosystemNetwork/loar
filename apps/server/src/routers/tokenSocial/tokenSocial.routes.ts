/**
 * Token Social — Comments, watchlist, and portfolio tracking for launchpad tokens.
 *
 * Collections:
 *   tokenComments   — Threaded comments on token pages
 *   tokenWatchlist  — Per-user watchlisted token addresses
 *   tokenTrades     — User trade history for PnL tracking
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

// ── Collection refs ────────────────────────────────────────────────────

const tokenCommentsCol = () => {
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase unavailable' });
  return db.collection('tokenComments');
};

const tokenWatchlistCol = () => {
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase unavailable' });
  return db.collection('tokenWatchlist');
};

const tokenTradesCol = () => {
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase unavailable' });
  return db.collection('tokenTrades');
};

// ── Router ─────────────────────────────────────────────────────────────

export const tokenSocialRouter = router({
  // ─── Comments ────────────────────────────────────────────────────────

  /** Get comments for a token, ordered newest first */
  getComments: publicProcedure
    .input(
      z.object({
        tokenAddress: z.string().min(1),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = tokenCommentsCol()
        .where('tokenAddress', '==', input.tokenAddress.toLowerCase())
        .where('parentId', '==', null)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await tokenCommentsCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snap = await query.get();
      const comments = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      // Fetch reply counts for each comment
      const withReplyCounts = await Promise.all(
        comments.map(async (comment: any) => {
          const replySnap = await tokenCommentsCol()
            .where('parentId', '==', comment.id)
            .count()
            .get();
          return { ...comment, replyCount: replySnap.data().count };
        })
      );

      return {
        comments: withReplyCounts,
        nextCursor: snap.docs.length === input.limit ? snap.docs[snap.docs.length - 1]?.id : null,
      };
    }),

  /** Get replies to a comment */
  getReplies: publicProcedure
    .input(
      z.object({
        parentId: z.string().min(1),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const snap = await tokenCommentsCol()
        .where('parentId', '==', input.parentId)
        .orderBy('createdAt', 'asc')
        .limit(input.limit)
        .get();

      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  /** Post a comment on a token */
  addComment: protectedProcedure
    .input(
      z.object({
        tokenAddress: z.string().min(1),
        text: z.string().min(1).max(1000),
        parentId: z.string().nullable().default(null),
        imageUrl: z.string().url().nullable().default(null),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = tokenCommentsCol().doc();
      const comment = {
        tokenAddress: input.tokenAddress.toLowerCase(),
        text: input.text,
        imageUrl: input.imageUrl,
        parentId: input.parentId,
        authorUid: ctx.user.uid,
        authorAddress: ctx.user.address ?? ctx.user.uid,
        createdAt: new Date(),
        likes: 0,
        flagged: false,
      };
      await ref.set(comment);
      return { id: ref.id, ...comment };
    }),

  /** Delete own comment */
  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await tokenCommentsCol().doc(input.commentId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if (doc.data()?.authorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your comment' });
      }
      await tokenCommentsCol().doc(input.commentId).delete();
      // Also delete replies
      const replies = await tokenCommentsCol().where('parentId', '==', input.commentId).get();
      const batch = db!.batch();
      replies.docs.forEach((r) => batch.delete(r.ref));
      await batch.commit();
      return { ok: true };
    }),

  /** Like a comment */
  likeComment: protectedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = tokenCommentsCol().doc(input.commentId);
      const likeRef = doc.collection('likes').doc(ctx.user.uid);
      const existing = await likeRef.get();
      if (existing.exists) return { ok: true, liked: true };

      await db!.runTransaction(async (tx) => {
        const snap = await tx.get(doc);
        if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
        tx.set(likeRef, { uid: ctx.user.uid, createdAt: new Date() });
        tx.update(doc, { likes: (snap.data()?.likes ?? 0) + 1 });
      });
      return { ok: true, liked: true };
    }),

  /** Unlike a comment */
  unlikeComment: protectedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = tokenCommentsCol().doc(input.commentId);
      const likeRef = doc.collection('likes').doc(ctx.user.uid);
      const existing = await likeRef.get();
      if (!existing.exists) return { ok: true, liked: false };

      await db!.runTransaction(async (tx) => {
        const snap = await tx.get(doc);
        if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
        tx.delete(likeRef);
        tx.update(doc, { likes: Math.max(0, (snap.data()?.likes ?? 0) - 1) });
      });
      return { ok: true, liked: false };
    }),

  /** Get comment count for a token */
  getCommentCount: publicProcedure
    .input(z.object({ tokenAddress: z.string().min(1) }))
    .query(async ({ input }) => {
      const snap = await tokenCommentsCol()
        .where('tokenAddress', '==', input.tokenAddress.toLowerCase())
        .count()
        .get();
      return snap.data().count;
    }),

  // ─── Watchlist ───────────────────────────────────────────────────────

  /** Get user's watchlist */
  getWatchlist: protectedProcedure.query(async ({ ctx }) => {
    const snap = await tokenWatchlistCol()
      .where('uid', '==', ctx.user.uid)
      .orderBy('addedAt', 'desc')
      .limit(100)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }),

  /** Check if a token is on user's watchlist */
  isWatching: protectedProcedure
    .input(z.object({ tokenAddress: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const snap = await tokenWatchlistCol()
        .where('uid', '==', ctx.user.uid)
        .where('tokenAddress', '==', input.tokenAddress.toLowerCase())
        .limit(1)
        .get();
      return !snap.empty;
    }),

  /** Add token to watchlist */
  watch: protectedProcedure
    .input(z.object({ tokenAddress: z.string().min(1), tokenSymbol: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Check if already watching
      const existing = await tokenWatchlistCol()
        .where('uid', '==', ctx.user.uid)
        .where('tokenAddress', '==', input.tokenAddress.toLowerCase())
        .limit(1)
        .get();
      if (!existing.empty) return { ok: true };

      const ref = tokenWatchlistCol().doc();
      await ref.set({
        uid: ctx.user.uid,
        tokenAddress: input.tokenAddress.toLowerCase(),
        tokenSymbol: input.tokenSymbol ?? '',
        addedAt: new Date(),
      });
      return { ok: true };
    }),

  /** Remove token from watchlist */
  unwatch: protectedProcedure
    .input(z.object({ tokenAddress: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const snap = await tokenWatchlistCol()
        .where('uid', '==', ctx.user.uid)
        .where('tokenAddress', '==', input.tokenAddress.toLowerCase())
        .limit(1)
        .get();
      if (!snap.empty) {
        await snap.docs[0].ref.delete();
      }
      return { ok: true };
    }),

  // ─── Trade Tracking (for PnL) ───────────────────────────────────────

  /** Record a trade (called after swap tx confirmation) */
  recordTrade: protectedProcedure
    .input(
      z.object({
        tokenAddress: z.string().min(1),
        tokenSymbol: z.string(),
        type: z.enum(['buy', 'sell']),
        ethAmount: z.number().positive(),
        tokenAmount: z.number().positive(),
        pricePerToken: z.number().positive(),
        txHash: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = tokenTradesCol().doc();
      await ref.set({
        uid: ctx.user.uid,
        address: ctx.user.address ?? ctx.user.uid,
        tokenAddress: input.tokenAddress.toLowerCase(),
        tokenSymbol: input.tokenSymbol,
        type: input.type,
        ethAmount: input.ethAmount,
        tokenAmount: input.tokenAmount,
        pricePerToken: input.pricePerToken,
        txHash: input.txHash,
        createdAt: new Date(),
      });
      return { id: ref.id };
    }),

  /** Get user's trade history for a specific token */
  getTokenTrades: protectedProcedure
    .input(
      z.object({
        tokenAddress: z.string().min(1),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const snap = await tokenTradesCol()
        .where('uid', '==', ctx.user.uid)
        .where('tokenAddress', '==', input.tokenAddress.toLowerCase())
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  /** Get user's full trade portfolio summary */
  getPortfolio: protectedProcedure.query(async ({ ctx }) => {
    const snap = await tokenTradesCol()
      .where('uid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const trades = snap.docs.map((doc) => doc.data());

    // Aggregate by token
    const byToken = new Map<
      string,
      {
        tokenAddress: string;
        tokenSymbol: string;
        totalBought: number;
        totalSold: number;
        ethSpent: number;
        ethReceived: number;
        trades: number;
        firstTrade: Date;
        lastTrade: Date;
      }
    >();

    for (const trade of trades) {
      const key = trade.tokenAddress;
      const existing = byToken.get(key) ?? {
        tokenAddress: key,
        tokenSymbol: trade.tokenSymbol,
        totalBought: 0,
        totalSold: 0,
        ethSpent: 0,
        ethReceived: 0,
        trades: 0,
        firstTrade: trade.createdAt.toDate(),
        lastTrade: trade.createdAt.toDate(),
      };

      if (trade.type === 'buy') {
        existing.totalBought += trade.tokenAmount;
        existing.ethSpent += trade.ethAmount;
      } else {
        existing.totalSold += trade.tokenAmount;
        existing.ethReceived += trade.ethAmount;
      }
      existing.trades += 1;
      const tradeDate = trade.createdAt.toDate();
      if (tradeDate < existing.firstTrade) existing.firstTrade = tradeDate;
      if (tradeDate > existing.lastTrade) existing.lastTrade = tradeDate;

      byToken.set(key, existing);
    }

    const positions = Array.from(byToken.values()).map((p) => ({
      ...p,
      netTokens: p.totalBought - p.totalSold,
      realizedPnl: p.ethReceived - p.ethSpent,
      avgBuyPrice: p.totalBought > 0 ? p.ethSpent / p.totalBought : 0,
    }));

    const totalRealizedPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0);
    const totalEthSpent = positions.reduce((sum, p) => sum + p.ethSpent, 0);

    return {
      positions,
      totalRealizedPnl,
      totalEthSpent,
      totalTrades: trades.length,
    };
  }),
});
