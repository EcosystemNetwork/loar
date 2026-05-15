/**
 * Episode Dubbing Router (script-first)
 *
 * Pro voice pipeline for the Voice Studio: take a written dialogue script
 * per episode/scene, cast a voice to each character, batch-generate the TTS,
 * and composite onto an existing episode video.
 *
 * Collection: dubbingJobs
 *
 * Procedures:
 *   createProject       — create a project with script lines + cast map
 *   update              — patch project metadata (title, baseVideoUrl, castMap)
 *   addLine / updateLine / removeLine — script line CRUD
 *   generateLine        — TTS one line, attach audio + alignment
 *   generateAll         — fan out TTS for all pending lines (capped concurrency)
 *   composite           — merge generated lines onto baseVideoUrl (mux or lipsync)
 *   get / list          — read back
 *
 * Pricing: per-line TTS billed via CHAR_COST (same table as voice.synthesize).
 * Composite is free (server CPU only).
 */

import { router, protectedProcedure, expensiveProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { elevenLabsService, type ElevenLabsVoiceModel } from '../../services/elevenlabs';
import { firebaseStorageService } from '../../services/firebase-storage';
import { lipSyncService } from '../../services/lipsync';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { logFailedRefund } from '../../lib/refund-audit';
import { FieldValue } from 'firebase-admin/firestore';
import { TRPCError } from '@trpc/server';
import { getPlatformConfig } from '../../services/platformConfig';

// ── Pricing ──────────────────────────────────────────────────────────

const LOAR_TO_USD = 0.01;
const CHAR_COST: Record<ElevenLabsVoiceModel, number> = {
  eleven_flash_v2_5: 0.000024,
  eleven_multilingual_v2: 0.00003,
  eleven_turbo_v2: 0.00003,
  eleven_v3: 0.00004,
};

async function getMargins() {
  const cfg = await getPlatformConfig();
  return { fiatMargin: cfg.fiatMargin, loarMargin: cfg.loarMargin };
}
function withFiat(usd: number, m: number) {
  return Math.round(usd * m * 100) / 100;
}
function toCredits(usd: number, m: number) {
  return Math.ceil(withFiat(usd, m) / LOAR_TO_USD);
}

// ── Collections ──────────────────────────────────────────────────────

const dubbingJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('dubbingJobs');
};

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

// ── Schemas ──────────────────────────────────────────────────────────

const voiceModelSchema = z.enum([
  'eleven_flash_v2_5',
  'eleven_multilingual_v2',
  'eleven_turbo_v2',
  'eleven_v3',
]);

const scriptLineSchema = z.object({
  id: z.string(),
  characterId: z.string().optional(),
  characterName: z.string().optional(),
  voiceId: z.string().min(1),
  text: z.string().min(1).max(2000),
  startSec: z.number().min(0).optional(),
  endSec: z.number().min(0).optional(),
  model: voiceModelSchema.optional(),
  stability: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  audioUrl: z.string().url().optional(),
  audioDurationSec: z.number().optional(),
  status: z.enum(['pending', 'generating', 'ready', 'failed']).default('pending'),
  error: z.string().optional(),
});

type ScriptLine = z.infer<typeof scriptLineSchema>;

const castMapSchema = z.record(z.string(), z.string()); // characterId -> voiceId

// ── Credit helpers (mirrors voice.routes pattern) ────────────────────

async function deductCredits(userId: string, credits: number): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(userId, credits);
  const ref = userCreditsCol().doc(userId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new TRPCError({
        code: 'PAYMENT_REQUIRED',
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

async function refundCredits(userId: string, credits: number, jobId?: string): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error(`Dubbing refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'dubbing',
      generationId: jobId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

async function uploadAudio(buffer: Buffer, filename: string): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, filename);
  return firebaseStorageService.getPublicUrl(key);
}

// ── ffmpeg helpers ───────────────────────────────────────────────────

/**
 * Replace the audio track of a video with a given audio URL using ffmpeg.
 * Uses the same `-protocol_whitelist https,tls,tcp` defense as
 * services/video-thumbnail.ts to block SSRF via file://, concat://, etc.
 */
async function muxAudioOntoVideo(videoUrl: string, audioUrl: string): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { readFile, unlink } = await import('fs/promises');
  const execFileAsync = promisify(execFile);

  for (const u of [videoUrl, audioUrl]) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error('Invalid URL passed to ffmpeg mux');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http/https URLs allowed for ffmpeg mux');
    }
  }

  const outPath = join(tmpdir(), `dub-${randomUUID()}.mp4`);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-protocol_whitelist',
      'https,http,tls,tcp',
      '-i',
      videoUrl,
      '-i',
      audioUrl,
      '-c:v',
      'copy',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest',
      outPath,
    ],
    { timeout: 120_000 }
  );

  const out = await readFile(outPath);
  unlink(outPath).catch(() => {});
  return out;
}

/**
 * Concatenate per-line audio buffers with silence between, sized to honor
 * scriptLine.startSec when provided. If startSec is omitted, lines are
 * concatenated back-to-back with a small (200ms) gap.
 *
 * Returns a single mp3 buffer.
 *
 * NOTE: This is a coarse v1 — it uses ffmpeg concat demuxer. Per-line
 * crossfading + precise timing belongs in the multi-track editor's
 * client-driven composite step (out of scope here).
 */
async function concatLinesToMp3(lines: ScriptLine[]): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFile, readFile, unlink } = await import('fs/promises');
  const execFileAsync = promisify(execFile);

  const workdir = join(tmpdir(), `dub-concat-${randomUUID()}`);
  const { mkdir } = await import('fs/promises');
  await mkdir(workdir, { recursive: true });

  const inputList: string[] = [];
  let prevEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.audioUrl) continue;

    // Gap before this line (silence)
    const targetStart = line.startSec ?? prevEnd + 0.2;
    const gap = Math.max(0, targetStart - prevEnd);
    if (gap > 0.01) {
      const silencePath = join(workdir, `silence-${i}.mp3`);
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `anullsrc=channel_layout=mono:sample_rate=44100`,
          '-t',
          gap.toFixed(3),
          '-q:a',
          '9',
          silencePath,
        ],
        { timeout: 30_000 }
      );
      inputList.push(`file '${silencePath}'`);
    }

    // Download line audio to local file
    const linePath = join(workdir, `line-${i}.mp3`);
    const res = await fetch(line.audioUrl);
    if (!res.ok) throw new Error(`Failed to fetch line audio ${line.audioUrl}`);
    const lineBuf = Buffer.from(await res.arrayBuffer());
    await writeFile(linePath, lineBuf);
    inputList.push(`file '${linePath}'`);

    prevEnd = targetStart + (line.audioDurationSec ?? 0);
  }

  const listPath = join(workdir, 'inputs.txt');
  await writeFile(listPath, inputList.join('\n'));
  const outPath = join(workdir, 'out.mp3');
  await execFileAsync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath],
    { timeout: 120_000 }
  );

  const out = await readFile(outPath);
  // Best-effort cleanup
  for (const f of inputList) {
    const path = f.replace(/^file '/, '').replace(/'$/, '');
    unlink(path).catch(() => {});
  }
  unlink(listPath).catch(() => {});
  unlink(outPath).catch(() => {});
  return out;
}

// ── Authorization helper ─────────────────────────────────────────────

async function loadJobOwned(jobId: string, uid: string) {
  const ref = dubbingJobsCol().doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dubbing job not found' });
  const data = snap.data() as Record<string, unknown>;
  if (data.userId !== uid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your dubbing job' });
  }
  return { ref, data };
}

// ── Line generation helper (shared by generateLine + generateAll) ───

interface GenerateLineArgs {
  userId: string;
  jobId: string;
  lineId: string;
  overrideModel?: ElevenLabsVoiceModel;
  overrideStability?: number;
  overrideStyle?: number;
}

async function generateLineInternal(args: GenerateLineArgs) {
  const { ref, data } = await loadJobOwned(args.jobId, args.userId);
  const lines = (data.scriptLines as ScriptLine[]) ?? [];
  const idx = lines.findIndex((l) => l.id === args.lineId);
  if (idx === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Line not found' });
  const line = lines[idx];

  const model = args.overrideModel ?? line.model ?? 'eleven_flash_v2_5';
  const stability = args.overrideStability ?? line.stability ?? 0.5;
  const style = args.overrideStyle ?? line.style ?? 0;
  const text = sanitizePrompt(line.text);

  const { fiatMargin } = await getMargins();
  const credits = Math.max(2, toCredits(CHAR_COST[model] * text.length, fiatMargin));

  await deductCredits(args.userId, credits);

  // Mark generating (best effort — concurrent writes resolved by final tx)
  await ref.update({ updatedAt: new Date() });

  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(args.userId, 'elevenlabs');

    const tts = await elevenLabsService.textToSpeech({
      text,
      voiceId: line.voiceId,
      modelId: model,
      stability,
      similarityBoost: 0.75,
      style,
      useSpeakerBoost: true,
      apiKey,
    });

    const audioUrl = await uploadAudio(
      tts.audioBuffer,
      `dubbing/${args.jobId}/${line.id}-${randomUUID()}.mp3`
    );

    // Best-effort word-level alignment for the multi-track editor.
    let wordTimings: Array<{ word: string; start: number; end: number }> | undefined;
    try {
      const align = await elevenLabsService.forcedAlignment(tts.audioBuffer, text, { apiKey });
      wordTimings = align.words;
    } catch (alignErr) {
      console.warn('forcedAlignment failed for line', line.id, alignErr);
    }

    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const curLines = ((cur.data()?.scriptLines as ScriptLine[]) ?? []).slice();
      const j = curLines.findIndex((l) => l.id === line.id);
      if (j !== -1) {
        curLines[j] = {
          ...curLines[j],
          audioUrl,
          status: 'ready',
          error: undefined,
          ...(wordTimings ? { wordTimings } : {}),
        };
      }
      tx.update(ref, { scriptLines: curLines, updatedAt: new Date() });
    });

    return { audioUrl, creditsCharged: credits };
  } catch (err) {
    await refundCredits(args.userId, credits, args.jobId);

    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const curLines = ((cur.data()?.scriptLines as ScriptLine[]) ?? []).slice();
      const j = curLines.findIndex((l) => l.id === line.id);
      if (j !== -1) {
        curLines[j] = {
          ...curLines[j],
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
      tx.update(ref, { scriptLines: curLines, updatedAt: new Date() });
    });
    throw err;
  }
}

// ── Router ───────────────────────────────────────────────────────────

export const dubbingRouter = router({
  createProject: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().optional(),
        universeId: z.string().optional(),
        title: z.string().max(120).optional(),
        baseVideoUrl: z.string().url().optional(),
        castMap: castMapSchema.optional(),
        scriptLines: z.array(scriptLineSchema.partial({ id: true, status: true })).default([]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const jobId = randomUUID();
      const now = new Date();

      const lines: ScriptLine[] = input.scriptLines.map((l) => ({
        id: l.id || randomUUID(),
        characterId: l.characterId,
        characterName: l.characterName,
        voiceId: l.voiceId,
        text: l.text,
        startSec: l.startSec,
        endSec: l.endSec,
        model: l.model,
        stability: l.stability,
        style: l.style,
        status: 'pending',
      }));

      await dubbingJobsCol()
        .doc(jobId)
        .set({
          id: jobId,
          userId: ctx.user.uid,
          episodeId: input.episodeId ?? null,
          universeId: input.universeId ?? null,
          title: input.title ?? 'Untitled dubbing project',
          baseVideoUrl: input.baseVideoUrl ?? null,
          castMap: input.castMap ?? {},
          scriptLines: lines,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        });

      return { jobId };
    }),

  update: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        title: z.string().max(120).optional(),
        baseVideoUrl: z.string().url().nullable().optional(),
        castMap: castMapSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { ref } = await loadJobOwned(input.jobId, ctx.user.uid);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.baseVideoUrl !== undefined) patch.baseVideoUrl = input.baseVideoUrl;
      if (input.castMap !== undefined) patch.castMap = input.castMap;
      await ref.update(patch);
      return { ok: true };
    }),

  addLine: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        line: scriptLineSchema.partial({ id: true, status: true }),
        afterLineId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { ref, data } = await loadJobOwned(input.jobId, ctx.user.uid);
      const lines = (data.scriptLines as ScriptLine[]) ?? [];
      const newLine: ScriptLine = {
        id: input.line.id || randomUUID(),
        voiceId: input.line.voiceId,
        text: input.line.text,
        characterId: input.line.characterId,
        characterName: input.line.characterName,
        startSec: input.line.startSec,
        endSec: input.line.endSec,
        model: input.line.model,
        stability: input.line.stability,
        style: input.line.style,
        status: 'pending',
      };

      let next: ScriptLine[];
      if (input.afterLineId) {
        const idx = lines.findIndex((l) => l.id === input.afterLineId);
        next =
          idx === -1
            ? [...lines, newLine]
            : [...lines.slice(0, idx + 1), newLine, ...lines.slice(idx + 1)];
      } else {
        next = [...lines, newLine];
      }
      await ref.update({ scriptLines: next, updatedAt: new Date() });
      return { lineId: newLine.id };
    }),

  updateLine: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        lineId: z.string(),
        patch: scriptLineSchema.partial().omit({ id: true }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { ref, data } = await loadJobOwned(input.jobId, ctx.user.uid);
      const lines = (data.scriptLines as ScriptLine[]) ?? [];
      const idx = lines.findIndex((l) => l.id === input.lineId);
      if (idx === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Line not found' });
      const merged: ScriptLine = { ...lines[idx], ...input.patch };
      // Editing text invalidates the cached audio
      if (input.patch.text && input.patch.text !== lines[idx].text) {
        merged.audioUrl = undefined;
        merged.audioDurationSec = undefined;
        merged.status = 'pending';
      }
      const next = [...lines.slice(0, idx), merged, ...lines.slice(idx + 1)];
      await ref.update({ scriptLines: next, updatedAt: new Date() });
      return { ok: true };
    }),

  removeLine: protectedProcedure
    .input(z.object({ jobId: z.string(), lineId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { ref, data } = await loadJobOwned(input.jobId, ctx.user.uid);
      const lines = (data.scriptLines as ScriptLine[]) ?? [];
      const next = lines.filter((l) => l.id !== input.lineId);
      await ref.update({ scriptLines: next, updatedAt: new Date() });
      return { ok: true };
    }),

  /**
   * Generate TTS for a single line. Idempotent on the line — re-running
   * regenerates and replaces audioUrl.
   */
  generateLine: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        jobId: z.string(),
        lineId: z.string(),
        overrideModel: voiceModelSchema.optional(),
        overrideStability: z.number().min(0).max(1).optional(),
        overrideStyle: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return generateLineInternal({
        userId: ctx.user.uid,
        jobId: input.jobId,
        lineId: input.lineId,
        overrideModel: input.overrideModel,
        overrideStability: input.overrideStability,
        overrideStyle: input.overrideStyle,
      });
    }),

  /**
   * Fan out generateLine for every pending/failed line. Capped concurrency
   * keeps ElevenLabs from rate-limiting us; failures don't stop other lines.
   */
  generateAll: protectedProcedure
    .input(z.object({ jobId: z.string(), concurrency: z.number().min(1).max(8).default(4) }))
    .mutation(async ({ input, ctx }) => {
      const { data } = await loadJobOwned(input.jobId, ctx.user.uid);
      const lines = (data.scriptLines as ScriptLine[]) ?? [];
      const pending = lines.filter((l) => l.status !== 'ready' || !l.audioUrl);
      if (pending.length === 0) return { generated: 0, failed: 0 };

      let generated = 0;
      let failed = 0;
      const queue = [...pending];
      const workers = Array.from({ length: input.concurrency }, async () => {
        while (queue.length) {
          const line = queue.shift();
          if (!line) return;
          try {
            await generateLineInternal({
              userId: ctx.user.uid,
              jobId: input.jobId,
              lineId: line.id,
            });
            generated += 1;
          } catch (err) {
            console.warn('generateAll: line failed', line.id, err);
            failed += 1;
          }
        }
      });
      await Promise.all(workers);

      return { generated, failed };
    }),

  /**
   * Concatenate generated lines into a single audio track and (optionally)
   * mux it onto the project's baseVideoUrl. Two modes:
   *   mode='mux'     — straight ffmpeg replace-audio (fast, no lip-sync)
   *   mode='lipsync' — call FAL lip-sync service (slower, mouth-aware)
   */
  composite: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        mode: z.enum(['mux', 'lipsync']).default('mux'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { ref, data } = await loadJobOwned(input.jobId, ctx.user.uid);
      const lines = (data.scriptLines as ScriptLine[]) ?? [];
      const ready = lines.filter((l) => l.status === 'ready' && l.audioUrl);
      if (ready.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No generated lines to composite' });
      }
      const baseVideoUrl = data.baseVideoUrl as string | undefined;

      await ref.update({ status: 'compositing', updatedAt: new Date() });

      try {
        // Step 1: merge dialogue lines into one mp3 (timing-aware via startSec).
        const merged = await concatLinesToMp3(ready);
        const mergedUrl = await uploadAudio(
          merged,
          `dubbing/${input.jobId}/merged-${randomUUID()}.mp3`
        );

        let finalVideoUrl: string | undefined;
        if (baseVideoUrl) {
          if (input.mode === 'lipsync') {
            const sync = await lipSyncService.sync({ videoUrl: baseVideoUrl, audioUrl: mergedUrl });
            if (sync.status !== 'completed' || !sync.videoUrl) {
              throw new Error(sync.error || 'Lip-sync failed');
            }
            finalVideoUrl = sync.videoUrl;
          } else {
            const out = await muxAudioOntoVideo(baseVideoUrl, mergedUrl);
            finalVideoUrl = await uploadAudio(
              out,
              `dubbing/${input.jobId}/composite-${randomUUID()}.mp4`
            );
          }
        }

        await ref.update({
          status: 'complete',
          mergedAudioUrl: mergedUrl,
          finalVideoUrl: finalVideoUrl ?? null,
          compositeMode: input.mode,
          updatedAt: new Date(),
        });

        return { mergedAudioUrl: mergedUrl, finalVideoUrl };
      } catch (err) {
        await ref.update({
          status: 'failed',
          failureReason: err instanceof Error ? err.message : 'Unknown',
          updatedAt: new Date(),
        });
        throw err;
      }
    }),

  get: protectedProcedure.input(z.object({ jobId: z.string() })).query(async ({ input, ctx }) => {
    const { data } = await loadJobOwned(input.jobId, ctx.user.uid);
    return data;
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          episodeId: z.string().optional(),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const params = input ?? { limit: 20 };
      let q = dubbingJobsCol().where('userId', '==', ctx.user.uid) as FirebaseFirestore.Query;
      if (params.episodeId) q = q.where('episodeId', '==', params.episodeId);
      const snap = await q
        .orderBy('createdAt', 'desc')
        .limit(params.limit ?? 20)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  delete: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { ref } = await loadJobOwned(input.jobId, ctx.user.uid);
      await ref.delete();
      return { ok: true };
    }),
});
