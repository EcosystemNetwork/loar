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
import { router, protectedProcedure, publicProcedure, adminProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { firebaseStorageService } from '../../services/firebase-storage';
import { getStorageManager } from '../../services/storage';
import { routeModel, getModelById } from '../../services/video-models';
import { dispatchGeneration, saveGenerationRecord } from '../generation/generation.routes';
import { publishToGallery } from '../../lib/gallery-publish';
import { isUniverseCollaborator, isUniverseAdmin, getChainClient } from '../../lib/safe-admin';
import { validateAgainstLaws } from '../physics/physics.handlers';
import { runEpisodeCanonCheck, shouldBlockCanonPublish } from '../../services/canon-check';
import { decodeEventLog, getAddress, keccak256, toBytes } from 'viem';

/**
 * Minimal ABI for the EpisodeCanonized event so we can decode receipts
 * without depending on the full wagmi-generated universeAbi (which may be
 * stale until forge + wagmi generate is re-run).
 */
const EPISODE_CANONIZED_EVENT_ABI = [
  {
    type: 'event',
    name: 'EpisodeCanonized',
    inputs: [
      { name: 'episodeHash', type: 'bytes32', indexed: true },
      { name: 'tipNodeId', type: 'uint256', indexed: true },
      { name: 'canonizer', type: 'address', indexed: false },
    ],
  },
] as const;

// ── Collections ─────────────────────────────────────────────────────────

// Per-user in-memory rate limits for control/start endpoints. Prevents a
// single user from signal-flooding (1 Firestore read/write per tick) or
// parking unbounded concurrent jobs. Cleared on process restart.
const controlRate = new Map<string, number[]>();
const CONTROL_WINDOW_MS = 60_000;
const CONTROL_MAX = 30; // per user per minute

function checkControlRate(uid: string): void {
  const now = Date.now();
  const arr = (controlRate.get(uid) ?? []).filter((t) => now - t < CONTROL_WINDOW_MS);
  if (arr.length >= CONTROL_MAX) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Control signals rate limit: ${CONTROL_MAX}/min`,
    });
  }
  arr.push(now);
  controlRate.set(uid, arr);
}

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

// ── Backfill grouping ───────────────────────────────────────────────────

/** Max clips concatenated into a single auto-grouped episode. */
const BACKFILL_MAX_CLIPS = 6;
/** Time gap (ms) that breaks a contiguous run between same-creator nodes. */
const BACKFILL_GAP_MS = 24 * 60 * 60 * 1000;

// ── Helpers ─────────────────────────────────────────────────────────────

async function deductCredits(uid: string, credits: number): Promise<void> {
  if (!db) return;
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(uid, credits);
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
  const { recordCreditsTx, recordAiGeneration } = await import('../../lib/metrics');
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
    recordCreditsTx('refund', 'success');
  } catch (err) {
    recordCreditsTx('refund', 'failure');
    throw err;
  }
  recordAiGeneration('multi', 'episodes', 'failure');
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

      const { validateUploadUrl } = await import('../../lib/url-validator');
      await validateUploadUrl(clip.videoUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      const res = await fetch(clip.videoUrl, {
        signal: controller.signal,
        redirect: 'error',
      });
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
          await validateUploadUrl(clip.audioUrl);
          const audioPath = join(workDir, `audio-${String(i).padStart(3, '0')}.mp3`);
          const audioRes = await fetch(clip.audioUrl, { redirect: 'error' });
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

  /**
   * continuity  — each scene's last frame seeds the next (i2v). A failed scene
   *               blocks the loop: retry with backoff until it succeeds, the
   *               user skips it, or the user aborts. Never advances with a
   *               stale frame.
   * independent — scenes are generated independently. A failed scene is
   *               refunded and skipped; subsequent scenes continue without a
   *               seed frame from that point.
   */
  mode: z.enum(['continuity', 'independent']).default('continuity'),

  /** Max auto-retry attempts per scene before requiring user intervention. */
  maxRetries: z.number().int().min(1).max(50).default(10),

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

/**
 * Read a one-shot control signal the user has written onto the job doc,
 * consuming it (clearing the field) so the loop only acts on it once.
 * Signals: 'abort' (stop job), 'skip' (give up on current scene), or
 * 'retry' (wake from awaiting_intervention and try the current scene again).
 */
async function consumeControlSignal(
  jobRef: FirebaseFirestore.DocumentReference
): Promise<'abort' | 'skip' | 'retry' | null> {
  const snap = await jobRef.get();
  const signal = snap.data()?.controlSignal as 'abort' | 'skip' | 'retry' | undefined;
  if (!signal) return null;
  await jobRef.update({
    controlSignal: FieldValue.delete(),
    controlSignalAt: FieldValue.delete(),
  });
  return signal;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function runScriptToEpisode(jobId: string, userId: string): Promise<void> {
  const jobRef = scriptJobsCol().doc(jobId);

  try {
    const jobSnap = await jobRef.get();
    const job = jobSnap.data()!;
    const scenes = job.scenes as { index: number; prompt: string }[];
    const clipDurationSec = job.clipDurationSec as number;
    const mode = (job.mode as 'continuity' | 'independent') || 'continuity';
    const maxRetries = Math.max(1, Math.min(50, (job.maxRetries as number) || 10));

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
    let aborted = false;

    for (let i = 0; i < scenes.length; i++) {
      if (aborted) break;
      const scene = scenes[i];

      await jobRef.update({
        currentSceneIndex: i,
        [`clipResults.${i}.status`]: 'generating',
        [`clipResults.${i}.retryAttempt`]: 0,
        [`clipResults.${i}.retryStatus`]: null,
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

      // ── Retry loop ──────────────────────────────────────────────────
      //
      // In continuity mode, a scene failure blocks the loop — we cannot
      // advance without its last frame. Retry with exponential backoff
      // up to maxRetries. If still failing, transition to
      // `awaiting_intervention` and wait for the user to skip, abort, or
      // hit retry. In independent mode, fall back to the legacy 2-attempt
      // behavior where a failed scene is refunded and the loop moves on.
      //
      // Backoff: 10s → 20s → 40s → ... capped at 5 minutes.
      //
      const hardRetryCap = mode === 'continuity' ? maxRetries : 2;
      const BACKOFF_BASE_MS = 10_000;
      const BACKOFF_CAP_MS = 5 * 60_000;

      let attempt = 0;
      let retried = false;
      let clipDone = false;
      let sceneSkipped = false;
      let lastError: string | undefined;

      while (!clipDone && !aborted) {
        // Honor any user signal queued before this attempt starts.
        const pre = await consumeControlSignal(jobRef);
        if (pre === 'abort') {
          aborted = true;
          break;
        }
        if (pre === 'skip') {
          sceneSkipped = true;
          break;
        }

        try {
          if (attempt > 0) {
            await jobRef.update({
              [`clipResults.${i}.retryStatus`]: 'retrying',
              [`clipResults.${i}.retryAttempt`]: attempt,
              [`clipResults.${i}.status`]: 'generating',
              updatedAt: new Date().toISOString(),
            });
          }

          const { videoUrl, generationId } = await generateOnce();

          const lastFrameUrl = await extractLastFrame(videoUrl, `${jobId}-scene-${i}`);
          if (lastFrameUrl) previousLastFrameUrl = lastFrameUrl;

          void publishToGallery({
            creatorUid: userId,
            universeId: job.universeId as string,
            mediaUrl: videoUrl,
            mediaType: 'ai-video',
            title: `${job.title as string} — Scene ${i + 1}`,
            description: scene.prompt,
            thumbnailUrl: lastFrameUrl,
            generationId,
            generationModel: model!.id,
            tags: ['episode', 'script-to-episode'],
          });

          await jobRef.update({
            [`clipResults.${i}`]: {
              index: i,
              status: 'completed',
              generationId,
              videoUrl,
              lastFrameUrl: lastFrameUrl || null,
              error: null,
              retried,
              retryAttempt: attempt,
              retryStatus: null,
            },
            updatedAt: new Date().toISOString(),
          });
          clipDone = true;
        } catch (err) {
          lastError = (err as Error).message?.slice(0, 300) || 'Unknown error';
          retried = attempt > 0 ? true : retried;
          attempt++;

          if (attempt < hardRetryCap) {
            const backoffMs = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
            const retryAt = new Date(Date.now() + backoffMs).toISOString();
            await jobRef.update({
              [`clipResults.${i}.retryAttempt`]: attempt,
              [`clipResults.${i}.retryStatus`]: 'backing_off',
              [`clipResults.${i}.retryAt`]: retryAt,
              [`clipResults.${i}.error`]: lastError,
              updatedAt: new Date().toISOString(),
            });
            // Sleep in 2s ticks so user signals are seen promptly.
            const deadline = Date.now() + backoffMs;
            while (Date.now() < deadline && !aborted) {
              const s = await consumeControlSignal(jobRef);
              if (s === 'abort') {
                aborted = true;
                break;
              }
              if (s === 'skip') {
                sceneSkipped = true;
                break;
              }
              // 'retry' during backoff means "try now" — break out of sleep.
              if (s === 'retry') break;
              await sleep(Math.min(2000, deadline - Date.now()));
            }
            if (sceneSkipped || aborted) break;
            continue;
          }

          // ── Retries exhausted ─────────────────────────────────────
          if (mode === 'independent') {
            // Legacy behavior: refund and keep going. `previousLastFrameUrl`
            // is preserved from the last successful clip.
            sceneSkipped = true;
            break;
          }

          // Continuity: park the job and wait for the user.
          const parkedAt = Date.now();
          await jobRef.update({
            status: 'awaiting_intervention',
            [`clipResults.${i}.status`]: 'awaiting_intervention',
            [`clipResults.${i}.retryAttempt`]: attempt,
            [`clipResults.${i}.retryStatus`]: 'awaiting_intervention',
            [`clipResults.${i}.error`]: lastError,
            awaitingInterventionAt: new Date(parkedAt).toISOString(),
            updatedAt: new Date(parkedAt).toISOString(),
          });

          // Poll for a user decision. Auto-abort after AWAITING_INTERVENTION_TIMEOUT_MS
          // so orphaned jobs don't park workers indefinitely (Firestore 2+ reads/sec).
          const AWAITING_INTERVENTION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
          while (!clipDone && !aborted && !sceneSkipped) {
            const s = await consumeControlSignal(jobRef);
            if (s === 'abort') {
              aborted = true;
              break;
            }
            if (s === 'skip') {
              sceneSkipped = true;
              break;
            }
            if (s === 'retry') {
              // Reset counter so user gets a fresh retry budget.
              attempt = 0;
              retried = true;
              await jobRef.update({
                status: 'generating',
                [`clipResults.${i}.status`]: 'generating',
                [`clipResults.${i}.retryStatus`]: 'retrying',
                [`clipResults.${i}.retryAttempt`]: 0,
                [`clipResults.${i}.error`]: null,
                awaitingInterventionAt: FieldValue.delete(),
                updatedAt: new Date().toISOString(),
              });
              break; // exits inner poll; outer `while (!clipDone)` retries.
            }
            if (Date.now() - parkedAt > AWAITING_INTERVENTION_TIMEOUT_MS) {
              console.warn(
                `[script-to-episode] Job ${jobId} scene ${i} auto-aborted after ` +
                  `${AWAITING_INTERVENTION_TIMEOUT_MS}ms without user intervention`
              );
              aborted = true;
              await jobRef.update({
                [`clipResults.${i}.error`]:
                  (lastError ? lastError + ' — ' : '') + 'Auto-aborted after 24h no intervention',
                updatedAt: new Date().toISOString(),
              });
              break;
            }
            await sleep(3000);
          }
        }
      }

      if (sceneSkipped) {
        await jobRef.update({
          [`clipResults.${i}`]: {
            index: i,
            status: 'failed',
            error: lastError || 'Skipped by user',
            retried: true,
            retryAttempt: attempt,
            retryStatus: 'skipped',
          },
          creditsRefunded: FieldValue.increment(job.creditsPerClip as number),
          updatedAt: new Date().toISOString(),
        });
        try {
          await refundCredits(userId, job.creditsPerClip as number);
        } catch (refundErr) {
          console.error(`[script-to-episode] Refund failed for scene ${i}:`, refundErr);
        }
        // Continuity chain is broken for this scene: clear the seed frame so
        // the next scene starts as text_to_video rather than i2v from a
        // frame that no longer matches the narrative beat.
        if (mode === 'continuity') previousLastFrameUrl = null;
      }
    }

    if (aborted) {
      await jobRef.update({
        status: 'aborted',
        abortedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
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
        // Episodes start as drafts. `publishAsCanon` is the one-way gesture
        // that flips `isCanon` to true. `canonTipNodeId` records the on-chain
        // anchor (for monetized universes) so a future multi-branch canon
        // model can migrate without an on-chain rewrite.
        isCanon: false,
        canonTipNodeId: null,
        canonizedAt: null,
        canonTxHash: null,
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

  /**
   * Get a single episode.
   *
   * Drafts (isCanon === false) are only visible to the creator, the universe
   * admin (creator or Safe signer), or an active team member. Public viewers
   * only ever see canon episodes.
   */
  get: publicProcedure
    .input(z.object({ episodeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const doc = await episodesCol().doc(input.episodeId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = doc.data()!;

      if (data.isCanon) return data;

      const callerUid = ctx.user?.uid?.toLowerCase();
      if (callerUid && data.creatorId?.toLowerCase?.() === callerUid) return data;

      if (
        data.universeId &&
        (await isUniverseCollaborator(data.universeId as string, ctx.user?.address ?? callerUid))
      ) {
        return data;
      }

      throw new TRPCError({ code: 'NOT_FOUND' });
    }),

  /**
   * List episodes for a universe.
   *
   * Drafts are only returned to the creator, the universe admin, or an active
   * team member. Public viewers receive canon-only listings.
   */
  list: publicProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const canSeeDrafts = await isUniverseCollaborator(
        input.universeId,
        ctx.user?.address ?? ctx.user?.uid
      );

      let query = episodesCol().where('universeId', '==', input.universeId);
      if (!canSeeDrafts) {
        query = query.where('isCanon', '==', true);
      }

      const snap = await query.orderBy('createdAt', 'desc').limit(input.limit).get();
      return snap.docs.map((d) => d.data());
    }),

  /**
   * Cross-universe feed of canon episodes for the home page rails. Returns
   * each episode hydrated with light universe metadata (name, image, creator)
   * so the client can render Netflix-style cards without a second round-trip.
   * Hidden and private universes are filtered out.
   */
  feed: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        /** Cap how many episodes a single universe can occupy in the feed so a
         *  bursty universe (e.g. one that just backfilled dozens of episodes)
         *  doesn't drown out everyone else. Default 3. Set to 0 to disable. */
        perUniverseCap: z.number().min(0).max(50).default(3),
      })
    )
    .query(async ({ input }) => {
      // Overfetch generously so the per-universe cap still leaves us with
      // enough material to fill `limit` slots when one universe dominates the
      // newest tail. 12× plus a 200 floor keeps us well under Firestore's
      // single-query budget while giving us room for ~20+ distinct universes.
      const fetchLimit = Math.min(Math.max(input.limit * 12, 200), 500);
      const snap = await episodesCol()
        .where('isCanon', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(fetchLimit)
        .get();

      const episodes = snap.docs.map((d) => d.data() as any);
      if (episodes.length === 0) return [] as Array<any>;

      const universeIds = Array.from(
        new Set(
          episodes
            .map((e) => (e.universeId as string | undefined)?.toLowerCase())
            .filter((id): id is string => !!id)
        )
      );
      if (universeIds.length === 0) return [] as Array<any>;

      const refs = universeIds.map((id) => db.collection('cinematicUniverses').doc(id));
      const universeDocs = await db.getAll(...refs);
      const universeMap = new Map<
        string,
        { id: string; name: string; imageURL: string; creator: string | null }
      >();
      for (const doc of universeDocs) {
        if (!doc.exists) continue;
        const data = doc.data() as any;
        if (data.isHidden || data.isPrivate) continue;
        universeMap.set(doc.id, {
          id: doc.id,
          name: data.name || data.description?.slice(0, 40) || '',
          imageURL: data.image_url || data.imageURL || data.portrait_image_url || '',
          creator: data.creator || null,
        });
      }

      // Cap per-universe so a single bursty universe (Voidborn-style backfill)
      // can't fill the entire rail. Episodes are already createdAt-desc, so
      // each universe keeps its newest N. Falls back to the legacy uncapped
      // behavior when perUniverseCap is 0.
      const perUniverseCount = new Map<string, number>();
      const cap = input.perUniverseCap;
      const hydrated = episodes
        .map((ep) => {
          const universeKey = (ep.universeId as string)?.toLowerCase?.() ?? '';
          const u = universeMap.get(universeKey);
          if (!u) return null;
          if (cap > 0) {
            const used = perUniverseCount.get(universeKey) ?? 0;
            if (used >= cap) return null;
            perUniverseCount.set(universeKey, used + 1);
          }
          const firstClip = Array.isArray(ep.clips) ? ep.clips[0] : null;
          return {
            id: ep.id as string,
            universeId: ep.universeId as string,
            title: (ep.title as string) || 'Untitled episode',
            description: (ep.description as string) || '',
            clipCount: (ep.clipCount as number) ?? (Array.isArray(ep.clips) ? ep.clips.length : 0),
            videoUrl: (firstClip?.videoUrl as string | undefined) ?? null,
            thumbnailUrl: (ep.thumbnailUrl as string | undefined) ?? null,
            exportUrl: (ep.exportUrl as string | undefined) ?? null,
            sourceCreator: (ep.sourceCreator as string | null) ?? null,
            createdAt: (ep.createdAt as string | null) ?? null,
            isCanon: !!ep.isCanon,
            universe: u,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);

      // If the cap left us short of `limit` (e.g., only 1–2 universes have
      // canon episodes at all), top up with the dropped overflow rather than
      // returning a near-empty rail.
      if (hydrated.length < input.limit && cap > 0) {
        const seen = new Set(hydrated.map((h) => h.id));
        const overflow = episodes
          .map((ep) => {
            if (seen.has(ep.id)) return null;
            const universeKey = (ep.universeId as string)?.toLowerCase?.() ?? '';
            const u = universeMap.get(universeKey);
            if (!u) return null;
            const firstClip = Array.isArray(ep.clips) ? ep.clips[0] : null;
            return {
              id: ep.id as string,
              universeId: ep.universeId as string,
              title: (ep.title as string) || 'Untitled episode',
              description: (ep.description as string) || '',
              clipCount:
                (ep.clipCount as number) ?? (Array.isArray(ep.clips) ? ep.clips.length : 0),
              videoUrl: (firstClip?.videoUrl as string | undefined) ?? null,
              thumbnailUrl: (ep.thumbnailUrl as string | undefined) ?? null,
              exportUrl: (ep.exportUrl as string | undefined) ?? null,
              sourceCreator: (ep.sourceCreator as string | null) ?? null,
              createdAt: (ep.createdAt as string | null) ?? null,
              isCanon: !!ep.isCanon,
              universe: u,
            };
          })
          .filter((x): x is NonNullable<typeof x> => !!x);
        hydrated.push(...overflow);
      }

      return hydrated.slice(0, input.limit);
    }),

  /**
   * Top universes ranked by canon-episode count. Used by the home page
   * "Binge-Worthy" rail so we can rank by real episodes (multi-clip groups
   * count once each) rather than raw on-chain node count.
   */
  topUniverses: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(15) }))
    .query(async ({ input }) => {
      const snap = await episodesCol().where('isCanon', '==', true).get();
      const counts = new Map<string, number>();
      for (const doc of snap.docs) {
        const uid = (doc.data().universeId as string | undefined)?.toLowerCase();
        if (!uid) continue;
        counts.set(uid, (counts.get(uid) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, input.limit)
        .map(([universeId, count]) => ({ universeId, count }));
    }),

  /**
   * Promote an episode to canon. **One-way** — cannot be reversed.
   *
   * For `fun` universes, canon is a Firestore flag only (off-chain).
   * For `monetized` universes, canon is an on-chain concept. The client must
   * first sign `Universe.setCanonForEpisode(tipNodeId, episodeHash)` and pass
   * the resulting txHash + tipNodeId here; we verify the `EpisodeCanonized`
   * event in the receipt matches and then mirror `isCanon: true` to Firestore.
   * The on-chain event remains the source of truth.
   */
  publishAsCanon: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().min(1),
        /** Required for monetized universes; ignored for fun. */
        txHash: z
          .string()
          .regex(/^0x[a-fA-F0-9]{64}$/)
          .optional(),
        /** On-chain canon tip node id at the moment of canonization. Recorded
         *  for forward-compat with a future multi-branch canon model. */
        canonTipNodeId: z.string().optional(),
        /** Skip the Z.AI vision-based canon-consistency advisory. Use when
         *  the creator has already reviewed the score from the preview
         *  endpoint and wants to override an off-canon-high verdict. */
        bypassCanonCheck: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = episodesCol().doc(input.episodeId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });

      const data = doc.data()!;
      if (data.isCanon) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Episode is already canon',
        });
      }

      const universeId = (data.universeId as string | undefined)?.toLowerCase();
      if (!universeId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Episode is missing universeId',
        });
      }

      const callerUid = ctx.user.uid.toLowerCase();
      const isCreator = data.creatorId?.toLowerCase?.() === callerUid;
      const isAdmin = await isUniverseAdmin(universeId, ctx.user.uid);
      if (!isCreator && !isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the episode creator or the universe admin can publish canon',
        });
      }

      const universeDoc = await db.collection('cinematicUniverses').doc(universeId).get();
      if (!universeDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
      }
      const universeType =
        (universeDoc.data()?.universeType as 'fun' | 'monetized' | undefined) ?? 'monetized';

      // Physics gate: block canon if the episode content (description +
      // clip labels) trips any `must`-severity law. `should` violations are
      // advisory; universes with no declared laws return zero violations.
      // Concatenate and call once — one Firestore read for laws, and the
      // handler emits at most one violation per law so dedup isn't needed.
      const description = (data.description as string | undefined) ?? '';
      const clipLabels = Array.isArray(data.clips)
        ? (data.clips as Array<{ label?: string }>)
            .map((c) => c?.label ?? '')
            .filter((s) => s.length > 0)
            .join('\n')
        : '';
      const physicsBlob = [description, clipLabels].filter((s) => s.length > 0).join('\n');
      if (physicsBlob.trim().length > 0) {
        const { violations } = await validateAgainstLaws(universeId, physicsBlob);
        const blocking = violations.filter((v) => v.severity === 'must');
        if (blocking.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Canon blocked by physics: ${blocking.map((v) => v.name).join(', ')}`,
          });
        }
      }

      // Z.AI canon advisory — vision check on the first clip's frame against
      // the universe lore. Soft-fails to null on infra issues (no key, no
      // playable clip, ffmpeg failure) so it cannot DOS canon. Hard blocks
      // only on verdict="off-canon" with at least one high-severity
      // contradiction; the creator can override by re-calling with
      // bypassCanonCheck=true after reviewing the preview.
      const canonAdvisory = input.bypassCanonCheck
        ? null
        : await runEpisodeCanonCheck(input.episodeId, ctx.user.uid).catch((err) => {
            console.warn('[publishAsCanon] canon advisory failed', err);
            return null;
          });
      if (shouldBlockCanonPublish(canonAdvisory)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Canon blocked by Z.AI consistency review (score ${canonAdvisory?.score}/100): ${canonAdvisory?.summary}. Re-call with bypassCanonCheck=true to override.`,
        });
      }

      const now = new Date().toISOString();

      if (universeType === 'fun') {
        const batch = db.batch();
        batch.update(ref, {
          isCanon: true,
          canonizedAt: now,
          canonTipNodeId: input.canonTipNodeId ?? null,
          updatedAt: now,
        });
        batch.set(db.collection('contentAuditLog').doc(), {
          action: 'episode_canonized',
          universeId,
          episodeId: input.episodeId,
          universeType,
          actorUid: ctx.user.uid,
          actorAddress: ctx.user.address ?? null,
          canonAdvisory: canonAdvisory
            ? {
                score: canonAdvisory.score,
                verdict: canonAdvisory.verdict,
                contradictionCount: canonAdvisory.contradictions.length,
                bypassed: !!input.bypassCanonCheck,
              }
            : null,
          createdAt: now,
        });
        await batch.commit();
        return {
          ok: true,
          isCanon: true,
          universeType,
          canonAdvisory: canonAdvisory ?? null,
        };
      }

      // Monetized: on-chain canon required. The creator must have already
      // called `Universe.setCanonForEpisode(tipNodeId, episodeHash)` and passes
      // the resulting txHash here. We fetch the receipt, verify the
      // `EpisodeCanonized` event matches this episode, then flip the Firestore
      // mirror. The on-chain event is the source of truth; this mirror exists
      // only for fast listing queries.
      if (!input.txHash || !input.canonTipNodeId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Monetized universes require txHash + canonTipNodeId from a signed setCanonForEpisode transaction',
        });
      }

      const chainId = universeDoc.data()?.chainId as number | undefined;
      const client = getChainClient(chainId);
      const receipt = await client.getTransactionReceipt({
        hash: input.txHash as `0x${string}`,
      });
      if (receipt.status !== 'success') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Transaction did not succeed on-chain',
        });
      }

      const expectedAddress = getAddress(universeId);
      const expectedEpisodeHash = keccak256(toBytes(input.episodeId));
      let expectedTipNodeId: bigint;
      try {
        expectedTipNodeId = BigInt(input.canonTipNodeId);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'canonTipNodeId is not a valid integer',
        });
      }

      let matched = false;
      let canonizer: string | null = null;
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== expectedAddress) continue;
        try {
          const decoded = decodeEventLog({
            abi: EPISODE_CANONIZED_EVENT_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== 'EpisodeCanonized') continue;
          const args = decoded.args as {
            episodeHash: `0x${string}`;
            tipNodeId: bigint;
            canonizer: `0x${string}`;
          };
          if (
            args.episodeHash.toLowerCase() === expectedEpisodeHash.toLowerCase() &&
            args.tipNodeId === expectedTipNodeId
          ) {
            matched = true;
            canonizer = args.canonizer.toLowerCase();
            break;
          }
        } catch {
          // Not an EpisodeCanonized log; keep scanning.
        }
      }

      if (!matched) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Receipt did not contain an EpisodeCanonized event matching this episode and tip node',
        });
      }

      const batch = db.batch();
      batch.update(ref, {
        isCanon: true,
        canonizedAt: now,
        canonTipNodeId: input.canonTipNodeId,
        canonTxHash: input.txHash,
        canonizer,
        updatedAt: now,
      });
      batch.set(db.collection('contentAuditLog').doc(), {
        action: 'episode_canonized',
        universeId,
        episodeId: input.episodeId,
        universeType,
        txHash: input.txHash,
        canonTipNodeId: input.canonTipNodeId,
        canonizer,
        actorUid: ctx.user.uid,
        actorAddress: ctx.user.address ?? null,
        canonAdvisory: canonAdvisory
          ? {
              score: canonAdvisory.score,
              verdict: canonAdvisory.verdict,
              contradictionCount: canonAdvisory.contradictions.length,
              bypassed: !!input.bypassCanonCheck,
            }
          : null,
        createdAt: now,
      });
      await batch.commit();

      return {
        ok: true,
        isCanon: true,
        universeType,
        txHash: input.txHash,
        canonAdvisory: canonAdvisory ?? null,
      };
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

  /**
   * Backfill canon episodes from on-chain video nodes.
   *
   * Walks the input nodes in chronological order and groups consecutive
   * nodes from the same creator into a single multi-clip episode. A new
   * episode starts whenever the creator changes, the gap between two
   * adjacent nodes exceeds {@link BACKFILL_GAP_MS}, or the running group
   * already holds {@link BACKFILL_MAX_CLIPS} clips. Nodes already claimed
   * by an existing Firestore episode are skipped (and act as a group
   * boundary, since they break the contiguous run).
   *
   * For `fun` universes the new episodes are auto-canoned (off-chain
   * flag). For `monetized` universes they stay as drafts — canon requires
   * the on-chain `setCanonForEpisode` gesture.
   *
   * Admin-only: caller must be the universe creator or a Safe signer.
   */
  backfillFromNodes: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        nodes: z
          .array(
            z.object({
              nodeId: z.string().min(1),
              videoUrl: z.string().url(),
              plot: z.string().default(''),
              creator: z.string().optional(),
              createdAt: z.number().optional(),
            })
          )
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();

      const isAdmin = await isUniverseAdmin(universeId, ctx.user.uid);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can backfill episodes',
        });
      }

      const uDoc = await db.collection('cinematicUniverses').doc(universeId).get();
      const universeType =
        (uDoc.data()?.universeType as 'fun' | 'monetized' | undefined) ?? 'monetized';

      // Index existing episodes by nodeId so we don't duplicate. Episodes
      // can hold multiple clips; we dedup on any clip that already points to
      // a given on-chain node.
      const existing = await episodesCol().where('universeId', '==', universeId).get();
      const claimed = new Set<string>();
      for (const doc of existing.docs) {
        const clips = (doc.data().clips || []) as Array<{ nodeId?: string }>;
        for (const c of clips) {
          if (c?.nodeId) claimed.add(String(c.nodeId));
        }
      }

      // Sort chronologically so chain-walk grouping is deterministic. Nodes
      // without `createdAt` sink to the end (treated as newest).
      const sorted = [...input.nodes].sort((a, b) => {
        const ta = a.createdAt ?? Number.MAX_SAFE_INTEGER;
        const tb = b.createdAt ?? Number.MAX_SAFE_INTEGER;
        if (ta !== tb) return ta - tb;
        return Number(a.nodeId) - Number(b.nodeId);
      });

      type Group = {
        creator: string | null;
        nodes: typeof sorted;
      };
      const groups: Group[] = [];
      let skippedClaimed = 0;

      for (const n of sorted) {
        if (claimed.has(String(n.nodeId))) {
          skippedClaimed++;
          continue;
        }
        const creator = (n.creator ?? '').toLowerCase() || null;
        const last = groups[groups.length - 1];
        const lastNode = last?.nodes[last.nodes.length - 1];
        const gapMs =
          last && lastNode && n.createdAt && lastNode.createdAt
            ? (n.createdAt - lastNode.createdAt) * 1000
            : 0;
        const startNew =
          !last ||
          last.creator !== creator ||
          last.nodes.length >= BACKFILL_MAX_CLIPS ||
          gapMs > BACKFILL_GAP_MS;
        if (startNew) {
          groups.push({ creator, nodes: [n] });
        } else {
          last.nodes.push(n);
        }
      }

      const now = new Date().toISOString();
      const batch = db.batch();
      let created = 0;

      for (const group of groups) {
        const head = group.nodes[0];
        const plot = (head.plot || '').trim();
        const firstLine =
          plot
            .split(/[\n.!?]/)[0]
            ?.trim()
            .slice(0, 120) || '';
        const baseTitle = firstLine || `Episode ${head.nodeId}`;
        const title =
          group.nodes.length > 1 ? `${baseTitle} (${group.nodes.length} parts)` : baseTitle;

        const episodeId = randomUUID();
        const ref = episodesCol().doc(episodeId);
        const isFun = universeType === 'fun';

        const clips = group.nodes.map((n, i) => {
          const nPlot = (n.plot || '').trim();
          const nFirst =
            nPlot
              .split(/[\n.!?]/)[0]
              ?.trim()
              .slice(0, 120) || '';
          return {
            nodeId: String(n.nodeId),
            label: nFirst || `Part ${i + 1}`,
            videoUrl: n.videoUrl,
            trimStart: 0,
            trimEnd: 0,
          };
        });

        const description =
          group.nodes
            .map((n) => (n.plot || '').trim())
            .filter(Boolean)
            .join('\n\n') || plot;

        batch.set(ref, {
          id: episodeId,
          universeId,
          title,
          description,
          clips,
          clipCount: clips.length,
          creatorId: ctx.user.uid,
          createdAt: now,
          updatedAt: now,
          exportUrl: null,
          isCanon: isFun,
          canonizedAt: isFun ? now : null,
          canonTipNodeId: null,
          canonTxHash: null,
          sourceNodeId: String(head.nodeId),
          sourceNodeIds: group.nodes.map((n) => String(n.nodeId)),
          sourceCreator: head.creator ?? null,
          sourceCreatedAt: head.createdAt ?? null,
        });
        for (const n of group.nodes) claimed.add(String(n.nodeId));
        created++;
      }

      if (created > 0) await batch.commit();

      return {
        created,
        skipped: skippedClaimed,
        universeType,
        autoCanoned: universeType === 'fun' ? created : 0,
        clipsTotal: groups.reduce((acc, g) => acc + g.nodes.length, 0),
      };
    }),

  /**
   * One-shot retro-canon for fun universes. Mirrors the auto-canon path the
   * event-listener now runs on every new `NodeCreated`, but applied to every
   * pre-existing on-chain node we missed before that handler shipped.
   *
   * Idempotent — uses the same deterministic episode ID as the event-listener
   * (`auto-{universe}-{nodeId}`), so re-running just overwrites with the same
   * payload and never double-creates. Honors existing manually-created
   * episodes too (those nodes are already "claimed" via `clips[].nodeId` and
   * are skipped).
   *
   * Platform-admin only (ADMIN_ADDRESSES). Does NOT touch monetized universes.
   */
  retroBackfillFunUniverses: adminProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        maxNodesPerUniverse: z.number().int().min(1).max(50000).default(10000),
      })
    )
    .mutation(async ({ input }) => {
      // 1. Resolve target set: a single fun universe (if specified) or all of them.
      let funUniverseIds: string[] = [];
      if (input.universeId) {
        const lc = input.universeId.toLowerCase();
        const doc = await db.collection('cinematicUniverses').doc(lc).get();
        const data = doc.data();
        if (!doc.exists || (data?.universeType as string | undefined) !== 'fun') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Universe is not a fun universe',
          });
        }
        funUniverseIds = [lc];
      } else {
        const snap = await db
          .collection('cinematicUniverses')
          .where('universeType', '==', 'fun')
          .get();
        funUniverseIds = snap.docs.map((d) => d.id);
      }

      let totalCreated = 0;
      let totalSkipped = 0;
      const perUniverse: Array<{ id: string; created: number; skipped: number }> = [];

      for (const universeId of funUniverseIds) {
        // 2. Build the "claimed" node-id set from any existing episodes for this
        // universe. Both manual `backfillFromNodes` and the event-listener
        // auto-canon land here, so this picks up either source.
        const existing = await episodesCol().where('universeId', '==', universeId).get();
        const claimed = new Set<string>();
        for (const d of existing.docs) {
          const clips = (d.data().clips || []) as Array<{ nodeId?: string }>;
          for (const c of clips) {
            if (c?.nodeId) claimed.add(String(c.nodeId));
          }
        }

        // 3. Pull on-chain nodes for this universe from the indexer mirror.
        const nodesSnap = await db
          .collection('indexer_nodes')
          .where('universeAddress', '==', universeId)
          .get();
        const nodes = nodesSnap.docs.map(
          (d) => d.data() as { nodeId: number; creator: string | null; createdAt: number }
        );
        if (nodes.length === 0) {
          perUniverse.push({ id: universeId, created: 0, skipped: 0 });
          continue;
        }

        // 4. Bulk-fetch matching content docs in chunks (Firestore getAll cap).
        const contentMap = new Map<string, { videoLink: string | null; plot: string | null }>();
        for (let i = 0; i < nodes.length; i += 300) {
          const slice = nodes.slice(i, i + 300);
          const refs = slice.map((n) =>
            db.collection('indexer_nodeContents').doc(`${universeId}:${n.nodeId}`)
          );
          const docs = await db.getAll(...refs);
          for (const d of docs) {
            if (!d.exists) continue;
            const cd = d.data() as { videoLink?: string | null; plot?: string | null };
            contentMap.set(d.id, { videoLink: cd.videoLink ?? null, plot: cd.plot ?? null });
          }
        }

        // 5. Write auto-canon episodes in batches of 400 (Firestore batch cap is 500).
        let batch = db.batch();
        let batchCount = 0;
        let created = 0;
        let skipped = 0;
        let processed = 0;

        for (const n of nodes) {
          if (processed >= input.maxNodesPerUniverse) break;
          processed++;
          const nodeId = String(n.nodeId);
          if (claimed.has(nodeId)) {
            skipped++;
            continue;
          }
          const content = contentMap.get(`${universeId}:${nodeId}`);
          if (!content?.videoLink) {
            skipped++;
            continue;
          }
          const plot = (content.plot || '').trim();
          const firstLine =
            plot
              .split(/[\n.!?]/)[0]
              ?.trim()
              .slice(0, 120) || '';
          const title = firstLine || `Episode ${nodeId}`;
          const createdAtIso = new Date(Number(n.createdAt || 0) * 1000).toISOString();
          const episodeId = `auto-${universeId}-${nodeId}`;
          const creator = (n.creator || '').toLowerCase() || null;

          batch.set(episodesCol().doc(episodeId), {
            id: episodeId,
            universeId,
            title,
            description: plot,
            clips: [
              {
                nodeId,
                label: title,
                videoUrl: content.videoLink,
                trimStart: 0,
                trimEnd: 0,
              },
            ],
            clipCount: 1,
            creatorId: creator,
            createdAt: createdAtIso,
            updatedAt: createdAtIso,
            exportUrl: null,
            isCanon: true,
            canonizedAt: createdAtIso,
            canonTipNodeId: null,
            canonTxHash: null,
            sourceNodeId: nodeId,
            sourceNodeIds: [nodeId],
            sourceCreator: creator,
            sourceCreatedAt: Number(n.createdAt || 0),
            autoCanon: true,
            autoCanonRetro: true,
          });
          batchCount++;
          created++;

          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        totalCreated += created;
        totalSkipped += skipped;
        perUniverse.push({ id: universeId, created, skipped });
      }

      return {
        universesProcessed: funUniverseIds.length,
        totalCreated,
        totalSkipped,
        perUniverse,
      };
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

  /** Poll export job status. Owner-only — UUIDs are unguessable but a leaked
   *  jobId (logs, screen-share, debug trace) would otherwise expose another
   *  user's outputUrl + error strings. */
  exportStatus: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const doc = await exportJobsCol().doc(input.jobId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = doc.data()!;
      if (data.userId && data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
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
      // Per-user concurrent-job cap so a single account can't park N workers
      // in long-running generation or awaiting_intervention loops. Covers both
      // states that block a worker thread.
      const MAX_CONCURRENT_JOBS_PER_USER = 3;
      const inFlight = await scriptJobsCol()
        .where('userId', '==', ctx.user.uid)
        .where('status', 'in', ['pending', 'generating', 'awaiting_intervention', 'assembling'])
        .limit(MAX_CONCURRENT_JOBS_PER_USER + 1)
        .get();
      if (inFlight.size >= MAX_CONCURRENT_JOBS_PER_USER) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `You have ${inFlight.size} running jobs. Wait for one to finish or abort it before starting another.`,
        });
      }

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
          mode: input.mode,
          maxRetries: input.maxRetries,
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
            retryAttempt: 0,
            retryStatus: null,
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

  /** Poll script-to-episode job progress. Owner-only — see exportStatus. */
  scriptJobStatus: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const doc = await scriptJobsCol().doc(input.jobId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = doc.data()!;
      if (data.userId && data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return {
        status: data.status as string,
        currentSceneIndex: data.currentSceneIndex as number,
        clipCount: data.clipCount as number,
        mode: (data.mode as 'continuity' | 'independent') || 'continuity',
        maxRetries: (data.maxRetries as number) || 10,
        clipResults: data.clipResults as Array<{
          index: number;
          status: string;
          generationId?: string;
          videoUrl?: string;
          error?: string;
          retried: boolean;
          retryAttempt?: number;
          retryStatus?: 'retrying' | 'backing_off' | 'awaiting_intervention' | 'skipped' | null;
          retryAt?: string;
        }>,
        episodeId: (data.episodeId as string) || undefined,
        creditsRefunded: data.creditsRefunded as number,
        error: (data.error as string) || undefined,
      };
    }),

  /**
   * Send a control signal to a running script-to-episode job.
   * - abort: stop the whole job after the current attempt
   * - skip:  give up on the current scene (breaks continuity chain) and move on
   * - retry: during backoff, try immediately; in awaiting_intervention, resume
   */
  controlJob: protectedProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
        action: z.enum(['abort', 'skip', 'retry']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      checkControlRate(ctx.user.uid);
      const ref = scriptJobsCol().doc(input.jobId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if (doc.data()?.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the job owner' });
      }
      const status = doc.data()?.status as string;
      if (status === 'completed' || status === 'failed' || status === 'aborted') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Job already ${status} — cannot signal`,
        });
      }
      await ref.update({
        controlSignal: input.action,
        controlSignalAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }),
});
