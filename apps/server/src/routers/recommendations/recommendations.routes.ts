/**
 * Recommendations Router — Phase 1.
 *
 * Two endpoints:
 *
 *   recommendations.continueWatching   Non-completed watch sessions for the
 *                                       current user, deduplicated to the most
 *                                       recent session per episode, with
 *                                       episode + universe metadata hydrated
 *                                       for the home row card.
 *
 *   recommendations.forMe              "Because you watched X" — episodes
 *                                       from universes the user has watched
 *                                       recently, excluding episodes they've
 *                                       already finished. Cold-start fallback
 *                                       to the most-recently-canonized feed
 *                                       so the row is never empty.
 *
 * Hydration: Firestore is queried for episode + universe docs by id. The
 * route purposely keeps the join logic here (not in the home component) so
 * the wire shape matches what the existing RecentEpisodes card expects.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

interface EpisodeDoc {
  id: string;
  universeId?: string;
  title?: string;
  description?: string;
  clipCount?: number;
  clips?: Array<{ videoUrl?: string }>;
  thumbnailUrl?: string;
  sourceCreator?: string | null;
  isCanon?: boolean;
  createdAt?: { toDate(): Date } | string | null;
}

interface UniverseDoc {
  id: string;
  name?: string;
  imageURL?: string;
  image_url?: string;
  creator?: string | null;
}

export interface FeedEpisode {
  id: string;
  universeId: string;
  title: string;
  description: string;
  clipCount: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  sourceCreator: string | null;
  createdAt: string | null;
  isCanon: boolean;
  universe: { id: string; name: string; imageURL: string; creator: string | null };
  /** Only set on `continueWatching` results. Seconds into the episode. */
  resumePositionSec?: number;
  /** Only set on `continueWatching` results. */
  lastWatchedAt?: string | null;
}

function toIsoString(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (
    typeof v === 'object' &&
    v &&
    'toDate' in v &&
    typeof (v as { toDate(): Date }).toDate === 'function'
  ) {
    return (v as { toDate(): Date }).toDate().toISOString();
  }
  return null;
}

async function loadEpisodes(ids: string[]): Promise<Map<string, EpisodeDoc>> {
  if (!db || ids.length === 0) return new Map();
  // Firestore `in` supports up to 30 ids per query — chunk if needed.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const out = new Map<string, EpisodeDoc>();
  for (const chunk of chunks) {
    const refs = chunk.map((id) => db!.collection('episodes').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.set(snap.id, { ...(snap.data() as EpisodeDoc), id: snap.id });
    }
  }
  return out;
}

async function loadUniverses(ids: string[]): Promise<Map<string, UniverseDoc>> {
  if (!db || ids.length === 0) return new Map();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const out = new Map<string, UniverseDoc>();
  for (const chunk of chunks) {
    const refs = chunk.map((id) => db!.collection('universes').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.set(snap.id, { ...(snap.data() as UniverseDoc), id: snap.id });
    }
  }
  return out;
}

function shapeFeedEpisode(ep: EpisodeDoc, universe: UniverseDoc | undefined): FeedEpisode {
  const firstClip = ep.clips?.[0];
  return {
    id: ep.id,
    universeId: ep.universeId ?? '',
    title: ep.title ?? 'Untitled episode',
    description: ep.description ?? '',
    clipCount: ep.clipCount ?? ep.clips?.length ?? 0,
    videoUrl: firstClip?.videoUrl ?? null,
    thumbnailUrl: ep.thumbnailUrl ?? null,
    sourceCreator: ep.sourceCreator ?? null,
    createdAt: toIsoString(ep.createdAt),
    isCanon: !!ep.isCanon,
    universe: {
      id: universe?.id ?? ep.universeId ?? '',
      name: universe?.name ?? 'Untitled universe',
      imageURL: universe?.imageURL ?? universe?.image_url ?? '',
      creator: universe?.creator ?? null,
    },
  };
}

export const recommendationsRouter = router({
  /**
   * Episodes the user started but did not complete, newest first.
   * Empty array when the user has no watch history yet.
   */
  continueWatching: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(30).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      if (!db) return [] as FeedEpisode[];
      const limit = input?.limit ?? 10;
      const snap = await db
        .collection('watchSessions')
        .where('userId', '==', ctx.user.uid)
        .where('completed', '==', false)
        .orderBy('lastTickAt', 'desc')
        .limit(limit * 2) // over-fetch; dedupe per episodeId below
        .get();
      const seen = new Set<string>();
      const sessions: Array<{
        episodeId: string;
        positionSec: number;
        lastTickAt: string | null;
      }> = [];
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const episodeId = data.episodeId as string;
        if (seen.has(episodeId)) continue;
        seen.add(episodeId);
        sessions.push({
          episodeId,
          positionSec: (data.positionSec as number) ?? 0,
          lastTickAt: toIsoString(data.lastTickAt),
        });
        if (sessions.length >= limit) break;
      }
      if (sessions.length === 0) return [] as FeedEpisode[];

      const episodes = await loadEpisodes(sessions.map((s) => s.episodeId));
      const universeIds = Array.from(
        new Set(
          Array.from(episodes.values())
            .map((e) => e.universeId)
            .filter((id): id is string => !!id)
        )
      );
      const universes = await loadUniverses(universeIds);

      return sessions
        .map((s) => {
          const ep = episodes.get(s.episodeId);
          if (!ep) return null;
          const universe = universes.get(ep.universeId ?? '');
          const shaped = shapeFeedEpisode(ep, universe);
          shaped.resumePositionSec = s.positionSec;
          shaped.lastWatchedAt = s.lastTickAt;
          return shaped;
        })
        .filter((x): x is FeedEpisode => x !== null);
    }),

  /**
   * Personalized recommendations with cold-start fallback.
   *
   * Logic:
   *   1. Load the user's last 30 watch sessions.
   *   2. Derive the universes they've watched, weighted by recency + watch time.
   *   3. Return canon episodes from those universes that they haven't completed.
   *   4. If the user has no watch history, fall back to the global episodes
   *      feed (most-recent canon).
   */
  forMe: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(30).default(15) }).optional())
    .query(async ({ ctx, input }) => {
      if (!db) return [] as FeedEpisode[];
      const limit = input?.limit ?? 15;
      const uid = ctx.user?.uid;

      // Cold start: anonymous or no sessions → fallback to recent canon feed.
      const sessionsSnap = uid
        ? await db
            .collection('watchSessions')
            .where('userId', '==', uid)
            .orderBy('lastTickAt', 'desc')
            .limit(30)
            .get()
        : null;

      if (!sessionsSnap || sessionsSnap.empty) {
        const feedSnap = await db
          .collection('episodes')
          .where('isCanon', '==', true)
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();
        const episodes = feedSnap.docs.map(
          (d) => ({ ...(d.data() as EpisodeDoc), id: d.id }) as EpisodeDoc
        );
        const universeIds = Array.from(
          new Set(episodes.map((e) => e.universeId).filter((id): id is string => !!id))
        );
        const universes = await loadUniverses(universeIds);
        return episodes.map((e) => shapeFeedEpisode(e, universes.get(e.universeId ?? '')));
      }

      // Hot path: build a universe-affinity score, then pull canon episodes
      // from the top-N universes that the user hasn't completed.
      const affinity = new Map<string, number>();
      const completedEpisodes = new Set<string>();
      let i = 0;
      for (const doc of sessionsSnap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const episodeId = data.episodeId as string | undefined;
        if (data.completed === true && episodeId) completedEpisodes.add(episodeId);
        // We don't have universeId on watchSessions directly — resolve below.
        i++;
      }
      void i;

      // Pull the watched episodes' universeIds in one batch.
      const watchedEpisodeIds = Array.from(
        new Set(
          sessionsSnap.docs
            .map((d) => (d.data() as { episodeId?: string }).episodeId)
            .filter((x): x is string => !!x)
        )
      );
      const watchedEpisodes = await loadEpisodes(watchedEpisodeIds);
      sessionsSnap.docs.forEach((doc, idx) => {
        const data = doc.data() as Record<string, unknown>;
        const episodeId = data.episodeId as string;
        const ep = watchedEpisodes.get(episodeId);
        if (!ep?.universeId) return;
        // Recency weight: most recent gets 30, oldest 1.
        const weight = sessionsSnap.docs.length - idx;
        affinity.set(ep.universeId, (affinity.get(ep.universeId) ?? 0) + weight);
      });

      const topUniverses = Array.from(affinity.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([id]) => id);

      if (topUniverses.length === 0) {
        // Watched episodes had no universeId — degenerate; fall back to feed.
        const feedSnap = await db
          .collection('episodes')
          .where('isCanon', '==', true)
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();
        const episodes = feedSnap.docs.map(
          (d) => ({ ...(d.data() as EpisodeDoc), id: d.id }) as EpisodeDoc
        );
        const universeIds = Array.from(
          new Set(episodes.map((e) => e.universeId).filter((id): id is string => !!id))
        );
        const universes = await loadUniverses(universeIds);
        return episodes.map((e) => shapeFeedEpisode(e, universes.get(e.universeId ?? '')));
      }

      // Pull canon episodes from those universes. Firestore `in` is capped
      // at 30 ids so 5 universes fits comfortably.
      const candidatesSnap = await db
        .collection('episodes')
        .where('universeId', 'in', topUniverses)
        .where('isCanon', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(limit * 3)
        .get();

      const candidates = candidatesSnap.docs
        .map((d) => ({ ...(d.data() as EpisodeDoc), id: d.id }) as EpisodeDoc)
        .filter((e) => !completedEpisodes.has(e.id));

      const universeMap = await loadUniverses(topUniverses);
      // Interleave by affinity rank so the highest-affinity universe surfaces first.
      const byUniverse = new Map<string, EpisodeDoc[]>();
      for (const ep of candidates) {
        const list = byUniverse.get(ep.universeId ?? '') ?? [];
        list.push(ep);
        byUniverse.set(ep.universeId ?? '', list);
      }
      const out: FeedEpisode[] = [];
      let pickedAny = true;
      while (out.length < limit && pickedAny) {
        pickedAny = false;
        for (const uId of topUniverses) {
          const list = byUniverse.get(uId);
          const ep = list?.shift();
          if (!ep) continue;
          out.push(shapeFeedEpisode(ep, universeMap.get(uId)));
          pickedAny = true;
          if (out.length >= limit) break;
        }
      }
      return out;
    }),
});
