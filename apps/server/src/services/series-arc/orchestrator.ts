/**
 * Series Arc Orchestrator — runs N sequential video generations linked by
 * locked cast/style/world and frame-to-frame visual handoff.
 *
 * Design:
 *   • Episode 1 generates from a text-to-video prompt with the locked cast,
 *     style preset, and universe wiki context.
 *   • Episodes 2..N use the previous episode's video URL as the start frame
 *     (image-to-video mode) plus a continuity-scaffolded prompt referencing
 *     the prior beat. The model treats the last frame as the visual anchor.
 *   • Each child generation goes through the existing `generation.generate`
 *     tRPC procedure via `appRouter.createCaller`, so credit reservation,
 *     model routing, fallback, gallery publish, lineage and webhooks all
 *     reuse the production code path. No bypass.
 *
 * Persistence:
 *   • Parent arc: `seriesArcs/{arcId}` — overall status + episode summaries
 *   • Each episode is also a regular `videoGenerations/{generationId}` doc
 *     tagged with `seriesArcId` + `episodeNumber` for cross-query.
 *
 * Failure handling:
 *   • If episode K fails, arc is marked `partial` and stops — no auto-retry
 *     (continuity from a failed episode is meaningless). User can re-run
 *     from episode K via a future `seriesArc.resume` endpoint (not in MVP).
 */

import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import type { AuthUser } from '../../lib/auth';

export type SeriesArcStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface SeriesArcEpisode {
  episodeNumber: number;
  /** videoGenerations doc id once dispatched. */
  generationId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  videoUrl: string | null;
  prompt: string;
  modelUsed: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface SeriesArcRecord {
  id: string;
  userId: string;
  status: SeriesArcStatus;
  episodeCount: number;
  /** Story beat that drives every episode prompt. */
  premise: string;
  /** Optional title shown in UI. Defaults to the first 60 chars of premise. */
  title: string;
  /** Locked across all episodes for visual continuity. */
  stylePreset: string | null;
  castMemberIds: string[];
  universeId: string | null;
  /** Per-episode results. */
  episodes: SeriesArcEpisode[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

export interface CreateSeriesArcInput {
  premise: string;
  episodeCount: number;
  title?: string;
  stylePreset?: string | null;
  castMemberIds?: string[];
  universeId?: string;
}

const arcsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('seriesArcs');
};

/**
 * Generate the per-episode prompt with continuity scaffolding.
 * Episode 1 introduces the premise. Episodes 2..N reference the prior beat.
 */
export function buildEpisodePrompt(
  premise: string,
  episodeNumber: number,
  totalEpisodes: number,
  priorEpisodePrompt: string | null
): string {
  if (episodeNumber === 1) {
    return `Episode 1 of ${totalEpisodes}. Opening beat. ${premise}`;
  }
  const continuity = priorEpisodePrompt
    ? `Continuing from: "${priorEpisodePrompt.slice(0, 200)}". `
    : '';
  return `Episode ${episodeNumber} of ${totalEpisodes}. ${continuity}${premise} Maintain visual continuity with the previous episode — same character appearance, same world.`;
}

/**
 * Persist a fresh arc with placeholder episode entries.
 * Returns the arc id; the caller is responsible for kicking off the runner.
 */
export async function createArcRecord(
  userId: string,
  input: CreateSeriesArcInput
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const title = input.title?.trim() || input.premise.slice(0, 60);

  const episodes: SeriesArcEpisode[] = Array.from({ length: input.episodeCount }, (_, i) => ({
    episodeNumber: i + 1,
    generationId: null,
    status: 'queued',
    videoUrl: null,
    prompt: '',
    modelUsed: null,
    startedAt: null,
    completedAt: null,
    error: null,
  }));

  const record: SeriesArcRecord = {
    id,
    userId,
    status: 'queued',
    episodeCount: input.episodeCount,
    premise: input.premise,
    title,
    stylePreset: input.stylePreset ?? null,
    castMemberIds: input.castMemberIds ?? [],
    universeId: input.universeId ?? null,
    episodes,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    error: null,
  };

  await arcsCol().doc(id).set(record);
  return id;
}

/**
 * Run the arc to completion. Designed to be called fire-and-forget from
 * the tRPC mutation — the parent caller just gets `{ arcId, status: 'queued' }`
 * back, and the UI polls `seriesArc.status` to watch episodes land.
 *
 * The `callerFactory` closure exists so this module can stay free of the
 * tRPC router import (would be a circular dep with `appRouter`).
 */
export interface SeriesArcCaller {
  generation: {
    generate: (input: any) => Promise<{
      generationId: string;
      videoUrl?: string | null;
      modelUsed?: string | null;
      status: string;
    }>;
  };
}

export async function runArc(
  arcId: string,
  user: AuthUser,
  callerFactory: (user: AuthUser) => SeriesArcCaller
): Promise<void> {
  const ref = arcsCol().doc(arcId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Series arc ${arcId} not found`);
  const arc = snap.data() as SeriesArcRecord;

  await ref.update({ status: 'running' as SeriesArcStatus, updatedAt: new Date() });

  const caller = callerFactory(user);
  let priorVideoUrl: string | null = null;
  let priorPrompt: string | null = null;
  const updatedEpisodes = [...arc.episodes];

  for (let i = 0; i < arc.episodeCount; i++) {
    const episodeNumber = i + 1;
    const episodePrompt = buildEpisodePrompt(
      arc.premise,
      episodeNumber,
      arc.episodeCount,
      priorPrompt
    );

    updatedEpisodes[i] = {
      ...updatedEpisodes[i],
      status: 'running',
      prompt: episodePrompt,
      startedAt: new Date(),
    };
    await ref.update({ episodes: updatedEpisodes, updatedAt: new Date() });

    try {
      const result = await caller.generation.generate({
        prompt: episodePrompt,
        mode: priorVideoUrl ? 'image_to_video' : 'text_to_video',
        // Visual handoff: prior episode's permanent URL is treated as the
        // starting image by the image-to-video pipeline.
        imageUrl: priorVideoUrl ?? undefined,
        durationSec: 5,
        resolution: '720p',
        aspectRatio: '16:9',
        audio: false,
        routingMode: 'auto',
        stylePreset: arc.stylePreset ?? undefined,
        castMemberIds: arc.castMemberIds.length > 0 ? arc.castMemberIds : undefined,
        universeId: arc.universeId ?? undefined,
        useWikiContext: !!arc.universeId,
      });

      updatedEpisodes[i] = {
        ...updatedEpisodes[i],
        status: result.videoUrl ? 'completed' : 'failed',
        generationId: result.generationId,
        videoUrl: result.videoUrl ?? null,
        modelUsed: result.modelUsed ?? null,
        completedAt: new Date(),
        error: result.videoUrl ? null : 'Generation returned no video URL',
      };
      await ref.update({ episodes: updatedEpisodes, updatedAt: new Date() });

      if (!result.videoUrl) {
        await ref.update({
          status: 'partial' as SeriesArcStatus,
          error: `Episode ${episodeNumber} returned no video`,
          updatedAt: new Date(),
          completedAt: new Date(),
        });
        return;
      }

      priorVideoUrl = result.videoUrl;
      priorPrompt = episodePrompt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      updatedEpisodes[i] = {
        ...updatedEpisodes[i],
        status: 'failed',
        error: msg,
        completedAt: new Date(),
      };
      await ref.update({
        episodes: updatedEpisodes,
        status: 'partial' as SeriesArcStatus,
        error: `Episode ${episodeNumber}: ${msg}`,
        updatedAt: new Date(),
        completedAt: new Date(),
      });
      return;
    }
  }

  await ref.update({
    status: 'completed' as SeriesArcStatus,
    completedAt: new Date(),
    updatedAt: new Date(),
  });
}
