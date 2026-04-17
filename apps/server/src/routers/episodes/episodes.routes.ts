/**
 * Episode Builder Router
 *
 * Lets users arrange video + audio nodes into episodes, then export
 * a single concatenated MP4.
 *
 *   episodes.create       — Save an episode (ordered list of clips)
 *   episodes.update       — Reorder / add / remove clips
 *   episodes.get          — Fetch a single episode
 *   episodes.list         — List episodes for a universe
 *   episodes.delete       — Delete an episode
 *   episodes.export       — Concat clips into a single MP4 via ffmpeg
 *   episodes.exportStatus — Poll export job status
 */
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { firebaseStorageService } from '../../services/firebase-storage';

// ── Collections ─────────────────────────────────────────────────────────

const episodesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodes');
};

const exportJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodeExportJobs');
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
});
