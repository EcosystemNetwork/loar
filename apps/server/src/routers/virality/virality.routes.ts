/**
 * Virality Router — episode hook / hold / replay scoring exposed as tRPC.
 *
 * Reads from `watchSessions` (the silent collector) and the `episodes`
 * collection (for duration + publishedAt), then runs the scoring service
 * to return a composite virality index per episode.
 *
 * Endpoints:
 *   scoreEpisode      — single episode score (public; episodes are public)
 *   scoreUniverse     — top N episodes in a universe, ranked by virality
 *   myTopEpisodes     — caller's own episodes ranked by virality (protected)
 *
 * Cost note: each scoreEpisode call reads up to 1000 watch sessions for
 * that episode. That's bounded by the SCORE_SESSION_LIMIT below, and the
 * default 250 is fine for testnet load. Bump it if the per-episode session
 * count grows and the cardinality of fetches drops accordingly.
 */

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import {
  computeViralityScore,
  describeViralityScore,
  type WatchSessionLike,
  type ViralityScore,
} from '../../services/virality/scoring';
import { predictPromptVirality } from '../../services/virality/prompt-predictor';

/** Cap per-episode session reads. Keep small enough that ranking many
 *  episodes stays under a few hundred reads total. */
const SCORE_SESSION_LIMIT = 250;

const watchSessionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('watchSessions');
};
const episodesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodes');
};

async function fetchSessionsForEpisode(episodeId: string): Promise<WatchSessionLike[]> {
  // No orderBy here — that would require a composite index on
  // (episodeId, lastTickAt). Plain equality + limit gives whatever order
  // Firestore returns, which is fine for sampling and avoids an index spec.
  const snap = await watchSessionsCol()
    .where('episodeId', '==', episodeId)
    .limit(SCORE_SESSION_LIMIT)
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const toDate = (v: unknown): Date | null => {
      if (!v) return null;
      if (v instanceof Date) return v;
      if (typeof v === 'object' && v !== null && 'toDate' in v) {
        try {
          return (v as { toDate(): Date }).toDate();
        } catch {
          return null;
        }
      }
      return null;
    };
    return {
      userId: (data.userId as string) ?? '',
      episodeId: (data.episodeId as string) ?? episodeId,
      positionSec: Number(data.positionSec) || 0,
      secondsWatched: Number(data.secondsWatched) || 0,
      completed: !!data.completed,
      startedAt: toDate(data.startedAt),
      endedAt: toDate(data.endedAt),
      lastTickAt: toDate(data.lastTickAt),
    };
  });
}

async function fetchEpisodeMeta(episodeId: string): Promise<{
  durationSec: number | null;
  publishedAt: Date | null;
  title: string | null;
  universeId: string | null;
  ownerUid: string | null;
}> {
  try {
    const doc = await episodesCol().doc(episodeId).get();
    if (!doc.exists) {
      return {
        durationSec: null,
        publishedAt: null,
        title: null,
        universeId: null,
        ownerUid: null,
      };
    }
    const data = doc.data() as Record<string, unknown>;
    const publishedRaw = data.publishedAt ?? data.canonizedAt ?? data.createdAt;
    let publishedAt: Date | null = null;
    if (publishedRaw instanceof Date) publishedAt = publishedRaw;
    else if (publishedRaw && typeof publishedRaw === 'object' && 'toDate' in publishedRaw) {
      try {
        publishedAt = (publishedRaw as { toDate(): Date }).toDate();
      } catch {
        publishedAt = null;
      }
    }
    return {
      durationSec: typeof data.durationSec === 'number' ? data.durationSec : null,
      publishedAt,
      title: (data.title as string) ?? null,
      universeId: (data.universeId as string) ?? null,
      ownerUid: (data.ownerUid as string) ?? (data.creatorUid as string) ?? null,
    };
  } catch {
    return { durationSec: null, publishedAt: null, title: null, universeId: null, ownerUid: null };
  }
}

export const viralityRouter = router({
  /**
   * Score a prompt BEFORE generation. Heuristic + transparent.
   * Public so the Marketing Studio / Editor / Series form can show it
   * inline as the user types — no auth wall on a query that returns text.
   */
  predictPrompt: publicProcedure
    .input(z.object({ prompt: z.string().min(0).max(4000) }))
    .query(({ input }) => predictPromptVirality(input.prompt)),

  /**
   * Score a single episode. Public — episodes themselves are public reads.
   */
  scoreEpisode: publicProcedure
    .input(z.object({ episodeId: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const [sessions, meta] = await Promise.all([
        fetchSessionsForEpisode(input.episodeId),
        fetchEpisodeMeta(input.episodeId),
      ]);
      const score = computeViralityScore(sessions, {
        durationSec: meta.durationSec ?? undefined,
        publishedAt: meta.publishedAt,
      });
      return {
        episodeId: input.episodeId,
        title: meta.title,
        universeId: meta.universeId,
        score,
        description: describeViralityScore(score),
      };
    }),

  /**
   * Rank a universe's episodes by virality. Returns the top N.
   * Public — same access policy as episodes themselves.
   */
  scoreUniverse: publicProcedure
    .input(
      z.object({
        universeId: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const episodes = await episodesCol()
        .where('universeId', '==', input.universeId)
        .limit(input.limit * 4) // headroom so we can drop episodes with no sessions
        .get();

      const scored = await Promise.all(
        episodes.docs.map(async (d) => {
          const meta = await fetchEpisodeMeta(d.id);
          const sessions = await fetchSessionsForEpisode(d.id);
          const score = computeViralityScore(sessions, {
            durationSec: meta.durationSec ?? undefined,
            publishedAt: meta.publishedAt,
          });
          return {
            episodeId: d.id,
            title: meta.title,
            score,
            description: describeViralityScore(score),
          };
        })
      );

      return scored
        .filter((e) => e.score.sampleSize > 0)
        .sort((a, b) => b.score.viralityIndex - a.score.viralityIndex)
        .slice(0, input.limit);
    }),

  /**
   * The caller's own episodes across all universes, ranked by virality.
   * Protected — uses `ownerUid` / `creatorUid` on the episode doc.
   */
  myTopEpisodes: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(10),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 10;

      // Try ownerUid first (newer schema), fall back to creatorUid
      const [byOwner, byCreator] = await Promise.all([
        episodesCol()
          .where('ownerUid', '==', ctx.user.uid)
          .limit(limit * 4)
          .get(),
        episodesCol()
          .where('creatorUid', '==', ctx.user.uid)
          .limit(limit * 4)
          .get(),
      ]);

      const seen = new Set<string>();
      const docs = [...byOwner.docs, ...byCreator.docs].filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });

      const scored: Array<{
        episodeId: string;
        title: string | null;
        universeId: string | null;
        score: ViralityScore;
        description: string;
      }> = await Promise.all(
        docs.map(async (d) => {
          const meta = await fetchEpisodeMeta(d.id);
          const sessions = await fetchSessionsForEpisode(d.id);
          const score = computeViralityScore(sessions, {
            durationSec: meta.durationSec ?? undefined,
            publishedAt: meta.publishedAt,
          });
          return {
            episodeId: d.id,
            title: meta.title,
            universeId: meta.universeId,
            score,
            description: describeViralityScore(score),
          };
        })
      );

      return scored.sort((a, b) => b.score.viralityIndex - a.score.viralityIndex).slice(0, limit);
    }),
});
