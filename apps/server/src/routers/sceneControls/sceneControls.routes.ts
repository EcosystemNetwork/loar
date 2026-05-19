/**
 * Scene Controls Router
 *
 * Exposes camera presets, style presets, VFX presets, and VFX processing
 * endpoints to the frontend. Also handles VFX composite rendering.
 */

import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import {
  CAMERA_PRESETS,
  STYLE_PRESETS,
  VFX_PRESETS,
  PROVIDER_CAPABILITIES,
  type CameraPresetId,
  type CameraIntensity,
  type StylePresetId,
  type VfxPresetId,
} from '../../services/scene-controls/types';
import { translateCameraPreset } from '../../services/scene-controls/camera';
import { listStylePresets } from '../../services/scene-controls/styles';
import { listVfxPresets, buildVfxFilterChain } from '../../services/scene-controls/vfx';
import { listViralPresets, getViralPreset } from '../../services/scene-controls/viral-presets';

// ── Collection refs ──────────────────────────────────────────────────

const vfxJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('vfxJobs');
};

// ── Router ───────────────────────────────────────────────────────────

export const sceneControlsRouter = router({
  /**
   * List all camera presets with metadata.
   */
  listCameraPresets: publicProcedure.query(() => {
    return Object.entries(CAMERA_PRESETS).map(([id, config]) => ({
      id: id as CameraPresetId,
      label: config.label,
      category: config.category,
      description: config.description,
    }));
  }),

  /**
   * List all style presets with display info.
   */
  listStylePresets: publicProcedure.query(() => {
    return listStylePresets();
  }),

  /**
   * List all VFX presets grouped by category.
   */
  listVfxPresets: publicProcedure.query(() => {
    return listVfxPresets();
  }),

  /**
   * List all viral presets (camera + style + shot + VFX combos with branded names).
   * Frontend renders these as a gallery; clicking a card resolves to the four
   * primitives and feeds them into the existing generate pipeline.
   */
  listViralPresets: publicProcedure.query(() => {
    return listViralPresets();
  }),

  /**
   * Resolve a viral preset id to its underlying camera/style/shot/vfx primitives.
   * Returns null if the id is unknown so the client can surface a clean error
   * instead of crashing the generate request.
   */
  getViralPreset: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const preset = getViralPreset(input.id);
    if (!preset) return null;
    return {
      id: preset.id,
      label: preset.label,
      tagline: preset.tagline,
      category: preset.category,
      camera: preset.camera,
      cameraIntensity: preset.cameraIntensity,
      style: preset.style,
      shot: preset.shot,
      vfx: preset.vfx,
      promptHint: preset.promptHint ?? null,
    };
  }),

  /**
   * Get provider capabilities for scene controls.
   */
  providerCapabilities: publicProcedure.query(() => {
    return PROVIDER_CAPABILITIES;
  }),

  /**
   * Preview what a camera preset translates to for a given provider.
   */
  previewCameraTranslation: publicProcedure
    .input(
      z.object({
        preset: z.string(),
        intensity: z.enum(['subtle', 'standard', 'pronounced']).default('standard'),
        provider: z.string().default('fal'),
      })
    )
    .query(({ input }) => {
      return translateCameraPreset(
        input.provider,
        input.preset as CameraPresetId,
        input.intensity as CameraIntensity
      );
    }),

  /**
   * Submit a VFX composite job.
   * Takes an existing video URL and applies VFX presets.
   * Returns a job ID for polling.
   */
  applyVfx: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        presets: z.array(z.string()).min(1).max(10),
        nodeId: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const jobId = randomUUID();
      const now = new Date();

      // Validate presets
      const validPresets = input.presets.filter((p) => p in VFX_PRESETS) as VfxPresetId[];
      if (validPresets.length === 0) {
        throw new Error('No valid VFX presets provided');
      }

      const filterChain = buildVfxFilterChain(validPresets);

      // Create job record
      await vfxJobsCol()
        .doc(jobId)
        .set({
          userId: ctx.user.uid,
          sourceVideoUrl: input.videoUrl,
          presets: validPresets,
          filterChain,
          nodeId: input.nodeId || null,
          universeId: input.universeId || null,
          status: 'queued',
          outputVideoUrl: null,
          createdAt: now,
          completedAt: null,
          error: null,
        });

      // Fire-and-forget: process the VFX
      // In production this would be a job queue (Bull, Cloud Tasks, etc.)
      // For now, we'll process inline with a timeout
      processVfxJob(jobId, input.videoUrl, validPresets, filterChain).catch((err) => {
        console.error(`[VFX] Job ${jobId} failed:`, err);
        vfxJobsCol()
          .doc(jobId)
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : 'VFX processing failed',
            completedAt: new Date(),
          })
          .catch(() => {});
      });

      return {
        jobId,
        status: 'queued',
        presets: validPresets,
        filterChain,
      };
    }),

  /**
   * Poll VFX job status.
   */
  vfxJobStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const doc = await vfxJobsCol().doc(input.jobId).get();
      if (!doc.exists) {
        return { status: 'not_found' as const };
      }
      const data = doc.data()!;
      return {
        status: data.status as 'queued' | 'processing' | 'completed' | 'failed',
        outputVideoUrl: data.outputVideoUrl || null,
        presets: data.presets,
        error: data.error || null,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        completedAt: data.completedAt?.toDate?.() || null,
      };
    }),

  /**
   * Save scene control data for a node to Firestore.
   * This persists camera, cast, VFX, style, mask, and keyframe settings.
   */
  saveNodeControls: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        nodeId: z.string(),
        controls: z.object({
          cameraPreset: z.string().nullable().optional(),
          cameraIntensity: z.enum(['subtle', 'standard', 'pronounced']).optional(),
          castMemberIds: z.array(z.string()).optional(),
          motionMaskHash: z.string().nullable().optional(),
          useSourceMask: z.boolean().optional(),
          startFrameFrom: z.string().nullable().optional(),
          endFrameTarget: z.string().nullable().optional(),
          vfxPresets: z.array(z.string()).optional(),
          stylePreset: z.string().nullable().optional(),
          styleInherits: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      const docId = `${input.universeId}_${input.nodeId}`;
      await db
        .collection('nodeSceneControls')
        .doc(docId)
        .set(
          {
            universeId: input.universeId,
            nodeId: input.nodeId,
            ...input.controls,
            updatedBy: ctx.user.uid,
            updatedAt: new Date(),
          },
          { merge: true }
        );

      return { saved: true, docId };
    }),

  /**
   * Load scene control data for a node.
   */
  getNodeControls: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        nodeId: z.string(),
      })
    )
    .query(async ({ input }) => {
      if (!db) throw new Error('Firebase is not configured');

      const docId = `${input.universeId}_${input.nodeId}`;
      const doc = await db.collection('nodeSceneControls').doc(docId).get();

      if (!doc.exists) {
        return null;
      }

      return doc.data();
    }),

  /**
   * Load scene controls for all nodes in a universe (batch).
   */
  getUniverseNodeControls: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      if (!db) throw new Error('Firebase is not configured');

      const snapshot = await db
        .collection('nodeSceneControls')
        .where('universeId', '==', input.universeId)
        .get();

      const controls: Record<string, any> = {};
      for (const doc of snapshot.docs) {
        const data = doc.data();
        controls[data.nodeId] = data;
      }

      return controls;
    }),
});

// ── VFX Processing — real ffmpeg pipeline ────────────────────────────
//
// Runs the composite inline in the server process. Same execFile-with-array-args
// pattern as services/video-thumbnail.ts (no shell, protocol-whitelist on
// ffmpeg). For higher throughput this is the obvious place to swap to a
// dedicated worker queue (Cloud Tasks / Bull) without touching the API surface.

async function processVfxJob(
  jobId: string,
  videoUrl: string,
  _presets: VfxPresetId[],
  filterChain: string
): Promise<void> {
  await vfxJobsCol().doc(jobId).update({ status: 'processing' });

  // Validate URL — ffmpeg's default protocol allowlist accepts `file:` /
  // `concat:` / `subfile:` and HLS-with-nested-`file:`, all of which read
  // local files into the encoded output when the URL is attacker-controlled.
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    await vfxJobsCol().doc(jobId).update({
      status: 'failed',
      error: 'Invalid video URL',
      completedAt: new Date(),
    });
    return;
  }
  if (parsed.protocol !== 'https:') {
    await vfxJobsCol().doc(jobId).update({
      status: 'failed',
      error: 'Only https:// video URLs are supported',
      completedAt: new Date(),
    });
    return;
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { readFile, unlink, stat } = await import('fs/promises');
  const execFileAsync = promisify(execFile);

  const outPath = join(tmpdir(), `vfx-${jobId}.mp4`);

  try {
    // Single-pass: read from the remote URL, apply the filter chain, write
    // an mp4 to /tmp. `-vf <chain>` carries the composite; `-c:a copy`
    // preserves the original audio track without re-encoding.
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-protocol_whitelist',
        'https,tls,tcp',
        '-i',
        videoUrl,
        '-vf',
        filterChain,
        '-c:a',
        'copy',
        '-preset',
        'fast',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { timeout: 5 * 60 * 1000 } // 5 min — 5-10s clip + chain shouldn't exceed
    );

    // Sanity check: ffmpeg can exit 0 with an empty file on certain errors.
    const stats = await stat(outPath);
    if (stats.size < 1024) {
      throw new Error(`ffmpeg produced suspiciously small file (${stats.size} bytes)`);
    }

    const buffer = await readFile(outPath);
    unlink(outPath).catch(() => {});

    const { getStorageManager } = await import('../../services/storage');
    const manager = getStorageManager();
    const manifest = await manager.upload(
      buffer,
      `vfx-${jobId}.mp4`,
      'video/mp4',
      'system' // uploader uid; vfxJobs already track the requesting user
    );
    const outputVideoUrl = manifest.uploads[0]?.url ?? null;

    if (!outputVideoUrl) {
      throw new Error('Storage upload succeeded but returned no URL');
    }

    await vfxJobsCol().doc(jobId).update({
      status: 'completed',
      outputVideoUrl,
      filterChain,
      completedAt: new Date(),
    });
  } catch (err) {
    unlink(outPath).catch(() => {});
    const msg = err instanceof Error ? err.message : 'VFX processing failed';
    console.error(`[VFX] Job ${jobId} ffmpeg/upload failed:`, msg);
    await vfxJobsCol().doc(jobId).update({
      status: 'failed',
      error: msg,
      completedAt: new Date(),
    });
  }
}
