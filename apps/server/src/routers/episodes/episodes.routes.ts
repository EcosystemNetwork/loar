/**
 * Episode Builder Router
 *
 * Lets users arrange video + audio nodes into episodes, then export
 * a single concatenated MP4. Also supports Script-to-Episode batch
 * generation with sequential frame continuity.
 *
 *   episodes.create             — Save an episode (ordered list of clips)
 *   episodes.update             — Reorder / add / remove clips
 *   episodes.get                — Fetch a single episode
 *   episodes.list               — List episodes for a universe
 *   episodes.delete             — Delete an episode
 *   episodes.export             — Concat clips into a single MP4 via ffmpeg
 *   episodes.exportStatus       — Poll export job status
 *   episodes.generateFromScript — Batch-generate clips from script, auto-assemble episode
 *   episodes.scriptJobStatus    — Poll script-to-episode job progress
 */
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { firebaseStorageService } from '../../services/firebase-storage';
import { getStorageManager } from '../../services/storage';
import { routeModel, getModelById } from '../../services/video-models';
import { dispatchGeneration, saveGenerationRecord } from '../generation/generation.routes';

// ── Collections ─────────────────────────────────────────────────────────

const episodesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodes');
};

const exportJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodeExportJobs');
};

const scriptJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('scriptToEpisodeJobs');
};

// ── Schemas ─────────────────────────────────────────────────────────────

const clipSchema = z.object({
  /** Node ID on the timeline (blockchain or local) */
  nodeId: z.string().min(1),
  /** Display label */
  label: z.string().max(200).default(''),
  /** Video URL (IPFS, Firebase Storage, or direct) */
  videoUrl: z.string().url(),
  /** Optional audio overlay URL */
  audioUrl: z.string().url().optional(),
  /** Trim start (seconds) */
  trimStart: z.number().min(0).default(0),
  /** Trim end (seconds, 0 = full clip) */
  trimEnd: z.number().min(0).default(0),
});

export type EpisodeClip = z.infer<typeof clipSchema>;

// ── Credit cost ─────────────────────────────────────────────────────────

const EXPORT_BASE_CREDITS = 5; // base cost
const EXPORT_PER_CLIP_CREDITS = 1; // per clip in the episode

// ── Helpers ─────────────────────────────────────────────────────────────

async function deductCredits(uid: string, credits: number): Promise<void> {
  if (!db) return;
  const ref = db.collection('userCredits').doc(uid);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${credits}, have ${balance}.`,
      });
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(uid: string, credits: number): Promise<void> {
  if (!db) return;
  const ref = db.collection('userCredits').doc(uid);
  await ref.update({
    balance: FieldValue.increment(credits),
    totalSpent: FieldValue.increment(-credits),
    updatedAt: new Date(),
  });
}

// ── Background export ───────────────────────────────────────────────────

async function runExport(jobId: string, clips: EpisodeClip[], episodeId: string, userId: string) {
  const jobRef = exportJobsCol().doc(jobId);

  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { writeFile, readFile, unlink, mkdir } = await import('fs/promises');
    const execFileAsync = promisify(execFile);

    const workDir = join(tmpdir(), `episode-${jobId}`);
    await mkdir(workDir, { recursive: true });

    await jobRef.update({ status: 'downloading', progress: 10 });

    // 1. Download all clips
    const localPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const ext = clip.videoUrl.includes('.webm') ? 'webm' : 'mp4';
      const clipPath = join(workDir, `clip-${String(i).padStart(3, '0')}.${ext}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      const res = await fetch(clip.videoUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Failed to download clip ${i}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(clipPath, buf);

      // If clip needs trimming or has audio overlay, re-encode
      if (clip.trimStart > 0 || clip.trimEnd > 0 || clip.audioUrl) {
        const processedPath = join(workDir, `proc-${String(i).padStart(3, '0')}.mp4`);
        const args = ['-y'];

        // Input video
        args.push('-i', clipPath);

        // Optional audio overlay
        if (clip.audioUrl) {
          // Download audio
          const audioPath = join(workDir, `audio-${String(i).padStart(3, '0')}.mp3`);
          const audioRes = await fetch(clip.audioUrl);
          if (audioRes.ok) {
            await writeFile(audioPath, Buffer.from(await audioRes.arrayBuffer()));
            args.push('-i', audioPath);
          }
        }

        // Trim
        if (clip.trimStart > 0) args.push('-ss', String(clip.trimStart));
        if (clip.trimEnd > 0) args.push('-to', String(clip.trimEnd));

        // Re-encode to consistent format for concat
        args.push(
          '-vf',
          'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-shortest',
          processedPath
        );

        await execFileAsync('ffmpeg', args, { timeout: 120_000 });
        localPaths.push(processedPath);
      } else {
        // Re-encode for consistent concat (resolution, codec)
        const processedPath = join(workDir, `proc-${String(i).padStart(3, '0')}.mp4`);
        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-i',
            clipPath,
            '-vf',
            'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-ar',
            '44100',
            '-ac',
            '2',
            processedPath,
          ],
          { timeout: 120_000 }
        );
        localPaths.push(processedPath);
      }

      const pct = Math.round(10 + (i / clips.length) * 60);
      await jobRef.update({ progress: pct });
    }

    await jobRef.update({ status: 'concatenating', progress: 75 });

    // 2. Build concat list
    const listPath = join(workDir, 'concat.txt');
    const listContent = localPaths.map((p) => `file '${p}'`).join('\n');
    await writeFile(listPath, listContent);

    // 3. Concat
    const outputPath = join(workDir, `episode-${jobId}.mp4`);
    await execFileAsync(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
      { timeout: 300_000 }
    );

    await jobRef.update({ status: 'uploading', progress: 90 });

    // 4. Upload to Firebase Storage
    const outputBuffer = await readFile(outputPath);
    const storageKey = await firebaseStorageService.upload(
      outputBuffer,
      `episode-${episodeId}-${Date.now()}.mp4`
    );
    const publicUrl = firebaseStorageService.getPublicUrl(storageKey);

    // 5. Update episode doc with export URL
    await episodesCol()
      .doc(episodeId)
      .update({
        exportUrl: publicUrl,
        exportStorageKey: storageKey,
        exportedAt: new Date().toISOString(),
        exportDurationMs: Date.now() - Date.now(), // approximate
      });

    await jobRef.update({
      status: 'completed',
      progress: 100,
      outputUrl: publicUrl,
      storageKey,
      completedAt: new Date().toISOString(),
    });

    // Cleanup temp files
    for (const p of localPaths) unlink(p).catch(() => {});
    unlink(listPath).catch(() => {});
    unlink(outputPath).catch(() => {});
  } catch (err: any) {
    console.error(`[episode-export] Job ${jobId} failed:`, err);
    await jobRef.update({
      status: 'failed',
      error: err.message?.slice(0, 500) || 'Unknown error',
      completedAt: new Date().toISOString(),
    });

    // Refund credits
    const credits = EXPORT_BASE_CREDITS + clips.length * EXPORT_PER_CLIP_CREDITS;
    try {
      await refundCredits(userId, credits);
    } catch (refundErr) {
      console.error(`[episode-export] Refund failed for ${userId}:`, refundErr);
    }
  }
}

// ── Script-to-Episode schemas ──────────────────────────────────────────

const scriptToEpisodeInputSchema = z.object({
  universeId: z.string().min(1),
  title: z.string().min(1).max(200),
  script: z.string().min(1).max(50_000),
  clipDurationSec: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).default(5),
  targetDurationSec: z.number().min(5).max(1800).optional(),

  // Generation config — forwarded to dispatchGeneration
  routingMode: z.enum(['auto', 'manual']).default('auto'),
  selectedModelId: z.string().optional(),
  aspectRatio: z.string().default('16:9'),
  resolution: z.string().default('720p'),
  castMemberIds: z.array(z.string()).max(5).optional(),
  stylePreset: z.string().nullable().optional(),
  cameraPreset: z.string().nullable().optional(),
  cameraIntensity: z.enum(['subtle', 'standard', 'pronounced']).optional(),
  useWikiContext: z.boolean().default(true),
  qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
});

// ── Script splitting ───────────────────────────────────────────────────

function splitScript(
  script: string,
  clipDurationSec: number,
  targetDurationSec?: number
): string[] {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length > 1) {
    // Multi-scene: each paragraph = one scene prompt
    return paragraphs;
  }

  // Single prompt + target duration → repeat for N clips
  if (targetDurationSec) {
    const clipCount = Math.max(1, Math.ceil(targetDurationSec / clipDurationSec));
    return Array(clipCount).fill(paragraphs[0]);
  }

  return paragraphs;
}

// ── Last frame extraction ──────────────────────────────────────────────

async function extractLastFrame(videoUrl: string, tag: string): Promise<string | null> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { readFile, unlink } = await import('fs/promises');
    const execFileAsync = promisify(execFile);

    const outPath = join(tmpdir(), `lastframe-${tag}.jpg`);

    await execFileAsync(
      'ffmpeg',
      ['-y', '-sseof', '-0.1', '-i', videoUrl, '-frames:v', '1', '-q:v', '2', outPath],
      { timeout: 15_000 }
    );

    const buffer = await readFile(outPath);
    unlink(outPath).catch(() => {});

    const manager = getStorageManager();
    const filename = `lastframe-${tag}.jpg`;
    const manifest = await manager.upload(buffer, filename, 'image/jpeg', 'system');
    return manifest.uploads[0]?.url || null;
  } catch (err) {
    console.warn(`[lastframe] Failed for ${tag}:`, (err as Error).message);
    return null;
  }
}

// ── Script-to-Episode background job ───────────────────────────────────

async function runScriptToEpisode(jobId: string, userId: string): Promise<void> {
  const jobRef = scriptJobsCol().doc(jobId);

  try {
    const jobSnap = await jobRef.get();
    const job = jobSnap.data()!;
    const scenes = job.scenes as { index: number; prompt: string }[];
    const clipDurationSec = job.clipDurationSec as number;

    await jobRef.update({ status: 'generating', updatedAt: new Date().toISOString() });

    // Resolve cast member reference images once
    let resolvedCastUrls: string[] | undefined;
    const castMemberIds = job.castMemberIds as string[] | undefined;
    if (castMemberIds && castMemberIds.length > 0 && db) {
      try {
        const castDocs = await Promise.all(
          castMemberIds.map((id) => db.collection('castMembers').doc(id).get())
        );
        resolvedCastUrls = castDocs
          .filter((doc) => doc.exists)
          .flatMap((doc) => doc.data()?.referenceImageUrls || [])
          .filter(Boolean);
      } catch {
        // Non-fatal
      }
    }

    // Resolve model once
    let model: ReturnType<typeof getModelById>;
    if (job.routingMode === 'manual' && job.selectedModelId) {
      model = getModelById(job.selectedModelId as string);
    } else {
      const decision = routeModel({
        mode: 'text_to_video',
        durationSec: clipDurationSec,
        resolution: job.resolution as string,
        audio: false,
        qualityTarget: job.qualityTarget as any,
      });
      model = getModelById(decision.chosenModelId);
    }
    if (!model) throw new Error('No video model available for generation');

    let previousLastFrameUrl: string | null = null;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      await jobRef.update({
        currentSceneIndex: i,
        [`clipResults.${i}.status`]: 'generating',
        updatedAt: new Date().toISOString(),
      });

      const generateOnce = async (): Promise<{ videoUrl: string; generationId: string }> => {
        const generationId = randomUUID();
        const isFirstClip = i === 0 && !previousLastFrameUrl;

        const input: any = {
          prompt: scene.prompt,
          mode: isFirstClip ? 'text_to_video' : 'image_to_video',
          durationSec: clipDurationSec,
          resolution: job.resolution,
          aspectRatio: job.aspectRatio,
          routingMode: job.routingMode,
          audio: false,
          useWikiContext: job.useWikiContext ?? true,
          universeId: job.universeId,
        };

        if (previousLastFrameUrl) {
          input.startFrameUrl = previousLastFrameUrl;
          input.imageUrl = previousLastFrameUrl;
        }
        if (job.stylePreset) input.stylePreset = job.stylePreset;
        if (job.cameraPreset) input.cameraPreset = job.cameraPreset;
        if (job.cameraIntensity) input.cameraIntensity = job.cameraIntensity;

        const result = await dispatchGeneration(model!, input, resolvedCastUrls);

        if (result.status === 'failed' || !result.videoUrl) {
          throw new Error(result.error || 'Generation failed — no video URL returned');
        }

        // Persist generation record for analytics
        await saveGenerationRecord({
          id: generationId,
          userId,
          universeId: job.universeId as string,
          routingMode: job.routingMode as 'auto' | 'manual',
          finalModelId: model!.id,
          provider: model!.provider,
          status: 'completed',
          prompt: scene.prompt,
          mode: isFirstClip ? 'text_to_video' : 'image_to_video',
          durationSec: clipDurationSec,
          resolution: job.resolution as string,
          aspectRatio: job.aspectRatio as string,
          providerCostUsd: model!.providerCostUsd,
          fiatPriceUsd: model!.fiatPriceUsd,
          loarPriceUsd: model!.loarPriceUsd,
          creditsCharged: job.creditsPerClip as number,
          marginUsd: model!.fiatPriceUsd - model!.providerCostUsd,
          routingReasonCode:
            job.routingMode === 'manual' ? 'manual_user_selection' : 'default_draft_model',
          videoUrl: result.videoUrl,
          createdAt: new Date(),
          completedAt: new Date(),
        });

        return { videoUrl: result.videoUrl, generationId };
      };

      // Try with one retry
      let retried = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { videoUrl, generationId } = await generateOnce();

          // Extract last frame for continuity with next clip
          const lastFrameUrl = await extractLastFrame(videoUrl, `${jobId}-scene-${i}`);
          if (lastFrameUrl) previousLastFrameUrl = lastFrameUrl;

          await jobRef.update({
            [`clipResults.${i}`]: {
              index: i,
              status: 'completed',
              generationId,
              videoUrl,
              lastFrameUrl: lastFrameUrl || null,
              error: null,
              retried,
            },
            updatedAt: new Date().toISOString(),
          });
          break; // success
        } catch (err) {
          retried = true;
          if (attempt === 1) {
            // Final failure — skip clip, refund its credits
            await jobRef.update({
              [`clipResults.${i}`]: {
                index: i,
                status: 'failed',
                error: (err as Error).message?.slice(0, 300) || 'Unknown error',
                retried: true,
              },
              creditsRefunded: FieldValue.increment(job.creditsPerClip as number),
              updatedAt: new Date().toISOString(),
            });
            try {
              await refundCredits(userId, job.creditsPerClip as number);
            } catch (refundErr) {
              console.error(`[script-to-episode] Refund failed for scene ${i}:`, refundErr);
            }
            // Keep previousLastFrameUrl from last successful clip
          }
        }
      }
    }

    // ── Assemble episode from completed clips ──────────────────────────

    await jobRef.update({ status: 'assembling', updatedAt: new Date().toISOString() });

    const finalSnap = await jobRef.get();
    const finalResults = finalSnap.data()!.clipResults as any[];
    const completedClips = finalResults
      .filter((r: any) => r.status === 'completed' && r.videoUrl)
      .map((r: any) => ({
        nodeId: r.generationId || `scene-${r.index}`,
        label: (scenes[r.index]?.prompt || `Scene ${r.index + 1}`).slice(0, 80),
        videoUrl: r.videoUrl as string,
        trimStart: 0,
        trimEnd: 0,
      }));

    if (completedClips.length > 0) {
      const episodeId = randomUUID();
      const now = new Date().toISOString();
      await episodesCol()
        .doc(episodeId)
        .set({
          id: episodeId,
          universeId: job.universeId,
          title: job.title,
          description: `Auto-generated from script (${completedClips.length} clips)`,
          clips: completedClips,
          clipCount: completedClips.length,
          creatorId: userId,
          createdAt: now,
          updatedAt: now,
          exportUrl: null,
          source: 'script_to_episode',
          batchJobId: jobId,
        });

      await jobRef.update({
        status: 'completed',
        episodeId,
        completedAt: now,
        updatedAt: now,
      });
    } else {
      await jobRef.update({
        status: 'failed',
        error: 'All clip generations failed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    console.error(`[script-to-episode] Job ${jobId} failed:`, err);
    await jobRef.update({
      status: 'failed',
      error: err.message?.slice(0, 500) || 'Unknown error',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

// ── Router ──────────────────────────────────────────────────────────────

export const episodesRouter = router({
  /** Create a new episode with an ordered clip list */
  create: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).default(''),
        clips: z.array(clipSchema).min(1).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const episodeId = randomUUID();
      const now = new Date().toISOString();

      await episodesCol().doc(episodeId).set({
        id: episodeId,
        universeId: input.universeId,
        title: input.title,
        description: input.description,
        clips: input.clips,
        clipCount: input.clips.length,
        creatorId: ctx.user.uid,
        createdAt: now,
        updatedAt: now,
        exportUrl: null,
      });

      return { id: episodeId };
    }),

  /** Update clip order, add/remove clips, or change metadata */
  update: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        clips: z.array(clipSchema).min(1).max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await episodesCol().doc(input.episodeId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if (doc.data()?.creatorId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the episode creator' });
      }

      const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
      if (input.title) updates.title = input.title;
      if (input.description !== undefined) updates.description = input.description;
      if (input.clips) {
        updates.clips = input.clips;
        updates.clipCount = input.clips.length;
        // Clear export since clip list changed
        updates.exportUrl = null;
      }

      await episodesCol().doc(input.episodeId).update(updates);
      return { ok: true };
    }),

  /** Get a single episode */
  get: publicProcedure
    .input(z.object({ episodeId: z.string().min(1) }))
    .query(async ({ input }) => {
      const doc = await episodesCol().doc(input.episodeId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      return doc.data();
    }),

  /** List episodes for a universe */
  list: publicProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const snap = await episodesCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snap.docs.map((d) => d.data());
    }),

  /** Delete an episode */
  delete: protectedProcedure
    .input(z.object({ episodeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const doc = await episodesCol().doc(input.episodeId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if (doc.data()?.creatorId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await episodesCol().doc(input.episodeId).delete();
      return { ok: true };
    }),

  /** Kick off a background export job — concat all clips into one MP4 */
  export: protectedProcedure
    .input(z.object({ episodeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const doc = await episodesCol().doc(input.episodeId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });

      const episode = doc.data()!;
      if (episode.creatorId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const clips = episode.clips as EpisodeClip[];
      if (!clips?.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Episode has no clips' });
      }

      // Charge credits
      const credits = EXPORT_BASE_CREDITS + clips.length * EXPORT_PER_CLIP_CREDITS;
      await deductCredits(ctx.user.uid, credits);

      // Create export job
      const jobId = randomUUID();
      await exportJobsCol().doc(jobId).set({
        id: jobId,
        episodeId: input.episodeId,
        universeId: episode.universeId,
        userId: ctx.user.uid,
        status: 'queued',
        progress: 0,
        clipCount: clips.length,
        credits,
        createdAt: new Date().toISOString(),
      });

      // Fire and forget
      runExport(jobId, clips, input.episodeId, ctx.user.uid).catch((err) => {
        console.error(`[episode-export] Uncaught error in job ${jobId}:`, err);
      });

      return { jobId, credits };
    }),

  /** Poll export job status */
  exportStatus: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const doc = await exportJobsCol().doc(input.jobId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = doc.data()!;
      return {
        status: data.status as string,
        progress: data.progress as number,
        outputUrl: data.outputUrl as string | undefined,
        error: data.error as string | undefined,
      };
    }),

  /** Batch-generate video clips from a script and auto-assemble an episode */
  generateFromScript: protectedProcedure
    .input(scriptToEpisodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const scenes = splitScript(input.script, input.clipDurationSec, input.targetDurationSec);
      if (scenes.length > 200) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Maximum 200 scenes. Shorten your script or increase clip duration.',
        });
      }
      if (scenes.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Script produced no scenes.' });
      }

      // Resolve credit cost per clip
      let creditsPerClip: number;
      if (input.routingMode === 'manual' && input.selectedModelId) {
        const model = getModelById(input.selectedModelId);
        if (!model) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected model not found' });
        }
        creditsPerClip = model.creditCost;
      } else {
        const decision = routeModel({
          mode: 'text_to_video',
          durationSec: input.clipDurationSec,
          resolution: input.resolution,
          audio: false,
          qualityTarget: input.qualityTarget,
        });
        creditsPerClip = decision.creditCost;
      }

      const totalCredits = creditsPerClip * scenes.length;

      // Deduct all credits upfront — failed clips get individual refunds
      await deductCredits(ctx.user.uid, totalCredits);

      const jobId = randomUUID();
      const now = new Date().toISOString();

      await scriptJobsCol()
        .doc(jobId)
        .set({
          id: jobId,
          userId: ctx.user.uid,
          universeId: input.universeId,
          title: input.title,
          status: 'pending',
          script: input.script,
          scenes: scenes.map((prompt, i) => ({ index: i, prompt })),
          clipDurationSec: input.clipDurationSec,
          targetDurationSec: input.targetDurationSec || scenes.length * input.clipDurationSec,
          clipCount: scenes.length,
          routingMode: input.routingMode,
          selectedModelId: input.selectedModelId || null,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
          castMemberIds: input.castMemberIds || [],
          stylePreset: input.stylePreset || null,
          cameraPreset: input.cameraPreset || null,
          cameraIntensity: input.cameraIntensity || null,
          useWikiContext: input.useWikiContext,
          qualityTarget: input.qualityTarget || null,
          creditsPerClip,
          totalCredits,
          creditsRefunded: 0,
          currentSceneIndex: 0,
          clipResults: scenes.map((_, i) => ({
            index: i,
            status: 'pending',
            retried: false,
          })),
          createdAt: now,
          updatedAt: now,
        });

      // Fire and forget — same pattern as runExport
      runScriptToEpisode(jobId, ctx.user.uid).catch((err) => {
        console.error(`[script-to-episode] Uncaught error in job ${jobId}:`, err);
      });

      return { jobId, clipCount: scenes.length, totalCredits, creditsPerClip };
    }),

  /** Poll script-to-episode job progress */
  scriptJobStatus: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const doc = await scriptJobsCol().doc(input.jobId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = doc.data()!;
      return {
        status: data.status as string,
        currentSceneIndex: data.currentSceneIndex as number,
        clipCount: data.clipCount as number,
        clipResults: data.clipResults as Array<{
          index: number;
          status: string;
          generationId?: string;
          videoUrl?: string;
          error?: string;
          retried: boolean;
        }>,
        episodeId: (data.episodeId as string) || undefined,
        creditsRefunded: data.creditsRefunded as number,
        error: (data.error as string) || undefined,
      };
    }),
});
