/**
 * 3D model dispatcher — single entry point for text-to-3d / image-to-3d
 * / multi-image / retexture / remesh / rigging / animation. Resolves the
 * registry row, picks the right service (Meshy direct or FAL passthrough),
 * waits for completion, and returns a normalized result.
 *
 * Meshy tasks are async — the dispatcher polls until terminal state up to
 * a per-task budget (defaults to 5 min for geometry, 3 min for rig/anim).
 */
import { TRPCError } from '@trpc/server';
import { resolveProviderKey } from '../../lib/byok';
import { getThreedModelById } from './registry';
import type { ThreedModelConfig, ThreedTask } from './types';

export interface ThreedDispatchInput {
  modelId: string;
  /** Required for text-to-3d* tasks. */
  prompt?: string;
  /** Required for image-to-3d / retexture (single source). */
  imageUrl?: string;
  /** Required for multi-image-to-3d (2–4 images). */
  imageUrls?: string[];
  /** Required for text-to-3d refine — preview task id. */
  previewTaskId?: string;
  /** Required for retexture / rigging on an existing mesh. */
  modelUrl?: string;
  /** Alternative to modelUrl for rigging — reuse a prior task ID. */
  inputTaskId?: string;
  /** Required for animation — rigging task id + Meshy library action id. */
  rigTaskId?: string;
  actionId?: number;
  /** Texture / retopo hints. */
  topology?: 'quad' | 'triangle';
  targetPolycount?: number;
  /** Caller uid for BYOK key resolution. */
  userId?: string | null;
  /** Override the default per-task poll budget (ms). */
  maxWaitMs?: number;
}

export interface ThreedDispatchResult {
  taskId: string;
  status: 'completed' | 'failed';
  /** Primary mesh URL (GLB preferred). */
  modelUrl?: string;
  /** All available mesh format URLs. */
  modelUrls?: {
    glb?: string;
    fbx?: string;
    obj?: string;
    mtl?: string;
    usdz?: string;
    thumbnail?: string;
  };
  thumbnailUrl?: string;
  /** Optional 360° preview video. */
  videoUrl?: string;
  error?: string;
  modelId: string;
  task: ThreedTask;
  provider: ThreedModelConfig['provider'];
}

function need<T>(value: T | undefined | null, field: string, task: ThreedTask): T {
  if (value == null) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Task ${task} requires "${field}"`,
    });
  }
  return value;
}

export async function dispatchThreed(input: ThreedDispatchInput): Promise<ThreedDispatchResult> {
  const model = getThreedModelById(input.modelId);
  if (!model) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown 3D model: ${input.modelId}`,
    });
  }
  if (!model.isEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `3D model ${model.id} is disabled`,
    });
  }

  // ── Meshy ──────────────────────────────────────────────────────────
  if (model.provider === 'meshy') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'meshy');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Meshy key missing — set MESHY_API_KEY or BYOK',
      });
    }
    const { meshyService } = await import('../meshy');
    const waitMs = input.maxWaitMs ?? 5 * 60 * 1000;
    const baseOut = {
      modelId: model.id,
      task: model.task,
      provider: model.provider,
    } as const;

    try {
      switch (model.task) {
        case 'text_to_3d_preview': {
          const prompt = need(input.prompt, 'prompt', model.task);
          const { taskId } = await meshyService.textTo3DPreview({ apiKey, prompt });
          const task = await meshyService.waitForTask(taskId, 'text-to-3d', waitMs, 5000, apiKey);
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: task.model_url ?? task.modelUrls?.glb,
            modelUrls: task.modelUrls,
            thumbnailUrl: task.thumbnailUrl,
            videoUrl: task.videoUrl,
          };
        }
        case 'text_to_3d_refine': {
          const previewTaskId = need(input.previewTaskId, 'previewTaskId', model.task);
          const { taskId } = await meshyService.textTo3DRefine({ apiKey, previewTaskId });
          const task = await meshyService.waitForTask(taskId, 'text-to-3d', waitMs, 5000, apiKey);
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: task.model_url ?? task.modelUrls?.glb,
            modelUrls: task.modelUrls,
            thumbnailUrl: task.thumbnailUrl,
            videoUrl: task.videoUrl,
          };
        }
        case 'image_to_3d': {
          const imageUrl = need(input.imageUrl, 'imageUrl', model.task);
          const { taskId } = await meshyService.imageTo3D({ apiKey, imageUrl });
          const task = await meshyService.waitForTask(taskId, 'image-to-3d', waitMs, 5000, apiKey);
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: task.model_url ?? task.modelUrls?.glb,
            modelUrls: task.modelUrls,
            thumbnailUrl: task.thumbnailUrl,
            videoUrl: task.videoUrl,
          };
        }
        case 'multi_image_to_3d': {
          const imageUrls = need(input.imageUrls, 'imageUrls', model.task);
          const { taskId } = await meshyService.multiImageTo3D({ apiKey, imageUrls });
          const task = await meshyService.waitForTask(taskId, 'image-to-3d', waitMs, 5000, apiKey);
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: task.model_url ?? task.modelUrls?.glb,
            modelUrls: task.modelUrls,
            thumbnailUrl: task.thumbnailUrl,
            videoUrl: task.videoUrl,
          };
        }
        case 'retexture': {
          const prompt = need(input.prompt, 'prompt', model.task);
          const modelUrl = need(input.modelUrl, 'modelUrl', model.task);
          const { taskId } = await meshyService.textToTexture({
            apiKey,
            modelUrl,
            prompt,
          });
          const task = await meshyService.waitForTextureTask(taskId, waitMs, 5000, apiKey);
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: task.modelUrls?.glb,
            modelUrls: task.modelUrls,
            thumbnailUrl: task.thumbnailUrl,
          };
        }
        case 'remesh': {
          // Meshy remesh isn't exposed as a typed method on meshyService —
          // surface a clear error pointing callers at retexture/refine.
          throw new TRPCError({
            code: 'NOT_IMPLEMENTED',
            message:
              'Meshy remesh dispatcher is not wired yet. Use text_to_3d_refine or retexture for now.',
          });
        }
        case 'rigging': {
          const modelUrl = input.modelUrl;
          const inputTaskId = input.inputTaskId;
          if (!modelUrl && !inputTaskId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'rigging task requires modelUrl OR inputTaskId',
            });
          }
          const { taskId } = await meshyService.rigModel({
            apiKey,
            modelUrl,
            inputTaskId,
          });
          const rigBudget = input.maxWaitMs ?? 3 * 60 * 1000;
          const task = await meshyService.waitForRigging(taskId, rigBudget, 5000, apiKey);
          const rigUrls = task.riggedModelUrls ?? task.rigged_model_urls;
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: rigUrls?.glb,
            modelUrls: rigUrls ? { glb: rigUrls.glb, fbx: rigUrls.fbx } : undefined,
            thumbnailUrl: task.thumbnailUrl ?? task.thumbnail_url,
          };
        }
        case 'animation': {
          const rigTaskId = need(input.rigTaskId, 'rigTaskId', model.task);
          const actionId = need(input.actionId, 'actionId', model.task);
          const { taskId } = await meshyService.applyAnimation({
            apiKey,
            rigTaskId,
            actionId,
          });
          const animBudget = input.maxWaitMs ?? 3 * 60 * 1000;
          const task = await meshyService.waitForAnimation(taskId, animBudget, 5000, apiKey);
          const glb = task.animationGlbUrl ?? task.animation_glb_url;
          const fbx = task.animationFbxUrl ?? task.animation_fbx_url;
          return {
            ...baseOut,
            taskId,
            status: 'completed',
            modelUrl: glb,
            modelUrls: { glb, fbx },
            thumbnailUrl: task.thumbnailUrl ?? task.thumbnail_url,
          };
        }
      }
    } catch (err) {
      return {
        ...baseOut,
        taskId: '',
        status: 'failed',
        error: err instanceof Error ? err.message : 'Meshy task failed',
      };
    }
  }

  // ── FAL passthrough — left for follow-up (Pixal3D / Hunyuan / Meshy-v6 on FAL)
  if (model.provider === 'fal') {
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message:
        'FAL 3D passthrough dispatcher is not wired yet. Use direct Meshy or your FAL caller for now.',
    });
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `No 3D dispatcher for provider ${model.provider}`,
  });
}
