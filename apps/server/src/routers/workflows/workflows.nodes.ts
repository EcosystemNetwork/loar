/**
 * Per-kind node executors for the workflow runner.
 *
 * Each kind exposes:
 *   - inputHandles  — names this node accepts on its input ports
 *   - outputHandles — names this node emits on its output ports
 *   - estimateCost  — credit cost for the run (called pre-flight + reconciled)
 *   - execute       — runs the node and returns its output map
 *
 * Adding a node kind in Phase 3 = adding an entry to NODE_EXECUTORS.
 */
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { assertGenerationAllowed } from '../../lib/generation-guards';
import { googleImagenService } from '../../services/google-imagen';
import { falService } from '../../services/fal';
import { getStorageManager } from '../../services/storage/manager';
import { getModelById, getModelsForMode } from '../../services/video-models/registry';
import { getEntity } from '../entities/entities.handlers';
import type {
  AnimateNodeParams,
  NodeParams,
  PromptNodeParams,
  RefNodeParams,
  UpscaleNodeParams,
  WorkflowNodeKind,
} from './workflows.types';

// ── Shared types ───────────────────────────────────────────────────────

export interface NodeIOContract {
  inputs: string[];
  outputs: string[];
}

export interface NodeRunCtx {
  ownerUid: string;
  runId: string;
  nodeId: string;
  signal: AbortSignal;
}

export interface NodeExecutionResult {
  outputs: Record<string, unknown>;
  modelUsed: string | null;
  providerCostUsd: number;
  creditsCharged: number;
}

export interface NodeExecutor<TParams extends NodeParams = NodeParams> {
  kind: WorkflowNodeKind;
  contract: NodeIOContract;
  estimateCost(params: TParams): number;
  execute(args: {
    params: TParams;
    inputs: Record<string, unknown>;
    ctx: NodeRunCtx;
  }): Promise<NodeExecutionResult>;
}

// ── I/O contracts (used by graph validator + UI) ──────────────────────

export const NODE_IO_CONTRACTS: Record<WorkflowNodeKind, NodeIOContract> = {
  prompt: { inputs: [], outputs: ['imageUrl'] },
  ref: { inputs: [], outputs: ['imageUrl'] },
  animate: { inputs: ['imageUrl'], outputs: ['videoUrl'] },
  upscale: { inputs: ['imageUrl'], outputs: ['imageUrl'] },
};

// ── Credit helpers (mirrors editing.routes.ts pattern) ────────────────

async function deductCredits(uid: string, cost: number, label: string): Promise<void> {
  if (!db) return;
  await assertGenerationAllowed(uid, cost);
  const userRef = db.collection('userCredits').doc(uid);
  await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const balance = (userDoc.data()?.balance as number) || 0;
    if (balance < cost) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${cost}, have ${balance}.`,
      });
    }
    tx.update(userRef, {
      balance: balance - cost,
      totalSpent: ((userDoc.data()?.totalSpent as number) || 0) + cost,
      updatedAt: new Date(),
    });
    const txRef = db.collection('creditTransactions').doc();
    tx.set(txRef, {
      uid,
      type: 'spend',
      generationType: `workflow_${label}`,
      credits: -cost,
      source: 'workflow',
      createdAt: new Date(),
    });
  });
}

export async function refundCredits(uid: string, cost: number): Promise<void> {
  if (!db || cost <= 0) return;
  try {
    await db
      .collection('userCredits')
      .doc(uid)
      .update({
        balance: FieldValue.increment(cost),
        totalSpent: FieldValue.increment(-cost),
        updatedAt: new Date(),
      });
  } catch (err) {
    console.error(`[workflow refund] Failed to refund ${cost} to ${uid}:`, err);
  }
}

// ── Cost estimates ────────────────────────────────────────────────────

const PROMPT_NODE_CREDITS = 3; // Imagen 4 generate
const REF_NODE_CREDITS = 0;
const UPSCALE_NODE_CREDITS_BY_FACTOR: Record<2 | 4, number> = { 2: 5, 4: 10 };

function estimateAnimateCredits(params: AnimateNodeParams): number {
  const decision = routeAnimateModel(params);
  return decision.creditCost;
}

export function estimateNodeCost(params: NodeParams): number {
  switch (params.kind) {
    case 'prompt':
      return PROMPT_NODE_CREDITS;
    case 'ref':
      return REF_NODE_CREDITS;
    case 'animate':
      return estimateAnimateCredits(params);
    case 'upscale':
      return UPSCALE_NODE_CREDITS_BY_FACTOR[params.factor];
  }
}

// ── Animate model routing helper ──────────────────────────────────────

function routeAnimateModel(params: AnimateNodeParams) {
  const latencyPreference =
    params.modelHint === 'fastest'
      ? 'fast'
      : params.modelHint === 'highest_quality'
        ? 'quality'
        : 'balanced';

  // Use a low cost budget when "fastest" is requested; otherwise let scoring decide.
  const candidates = getModelsForMode('image_to_video');
  if (candidates.length === 0) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'No image-to-video models registered',
    });
  }

  // Prefer the routing engine, but cap by duration up-front.
  const eligible = candidates.filter((m) => m.isEnabled && params.durationSec <= m.maxDurationSec);
  if (eligible.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `No enabled image-to-video model supports ${params.durationSec}s duration`,
    });
  }

  // Simple scoring: respect modelHint
  let chosen = eligible[0];
  if (latencyPreference === 'fast') {
    chosen =
      eligible.find((m) => m.speedTier === 'fast') ??
      eligible.find((m) => m.priceTier === 'low') ??
      eligible[0];
  } else if (latencyPreference === 'quality') {
    chosen =
      eligible.find((m) => m.qualityTier === 'premium') ??
      eligible.find((m) => m.qualityTier === 'standard') ??
      eligible[0];
  } else {
    chosen =
      eligible.find((m) => m.qualityTier === 'standard' && m.priceTier !== 'high') ?? eligible[0];
  }

  return chosen;
}

// ── Executors ─────────────────────────────────────────────────────────

const promptExecutor: NodeExecutor<PromptNodeParams> = {
  kind: 'prompt',
  contract: NODE_IO_CONTRACTS.prompt,
  estimateCost: () => PROMPT_NODE_CREDITS,
  async execute({ params, ctx }) {
    ctx.signal.throwIfAborted();
    await deductCredits(ctx.ownerUid, PROMPT_NODE_CREDITS, 'prompt');

    try {
      const result = await googleImagenService.generate({
        prompt: params.text,
        negativePrompt: params.negativePrompt,
        aspectRatio: params.aspectRatio,
        // Imagen 4 hard-coded per project memory
        model: 'imagen-4.0-generate-001',
        numberOfImages: 1,
      });

      ctx.signal.throwIfAborted();

      if (result.images.length === 0) {
        throw new Error('Imagen returned no image (likely safety block)');
      }
      const img = result.images[0];
      const buffer = Buffer.from(img.base64, 'base64');
      const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const filename = `workflow-${ctx.runId}-${ctx.nodeId}.${ext}`;
      const manifest = await getStorageManager().upload(
        buffer,
        filename,
        img.mimeType,
        ctx.ownerUid
      );
      const url = manifest.uploads[0]?.url;
      if (!url) throw new Error('Storage upload returned no URL');

      return {
        outputs: { imageUrl: url, contentHash: manifest.contentHash },
        modelUsed: 'imagen-4.0-generate-001',
        providerCostUsd: 0.04,
        creditsCharged: PROMPT_NODE_CREDITS,
      };
    } catch (err) {
      await refundCredits(ctx.ownerUid, PROMPT_NODE_CREDITS);
      throw err;
    }
  },
};

const refExecutor: NodeExecutor<RefNodeParams> = {
  kind: 'ref',
  contract: NODE_IO_CONTRACTS.ref,
  estimateCost: () => REF_NODE_CREDITS,
  async execute({ params, ctx }) {
    ctx.signal.throwIfAborted();
    if (params.assetUrl) {
      return {
        outputs: { imageUrl: params.assetUrl },
        modelUsed: null,
        providerCostUsd: 0,
        creditsCharged: 0,
      };
    }
    if (!params.entityId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'ref node requires assetUrl or entityId',
      });
    }
    const entity = await getEntity(params.entityId);
    if (!entity) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Entity ${params.entityId} not found` });
    }
    if (!entity.imageUrl) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Entity ${params.entityId} has no imageUrl`,
      });
    }
    return {
      outputs: { imageUrl: entity.imageUrl, entityId: entity.id },
      modelUsed: null,
      providerCostUsd: 0,
      creditsCharged: 0,
    };
  },
};

const animateExecutor: NodeExecutor<AnimateNodeParams> = {
  kind: 'animate',
  contract: NODE_IO_CONTRACTS.animate,
  estimateCost: estimateAnimateCredits,
  async execute({ params, inputs, ctx }) {
    ctx.signal.throwIfAborted();
    const imageUrl = inputs.imageUrl as string | undefined;
    if (!imageUrl) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'animate node requires upstream imageUrl input',
      });
    }
    const chosen = routeAnimateModel(params);
    const cost = chosen.creditCost;

    await deductCredits(ctx.ownerUid, cost, 'animate');

    try {
      const startedAt = Date.now();
      const result = await falService.generateVideo({
        prompt: params.motionPrompt ?? '',
        model: chosen.falModelId as Parameters<typeof falService.generateVideo>[0]['model'],
        imageUrl,
        duration: params.durationSec,
        aspectRatio: params.aspectRatio,
      });
      ctx.signal.throwIfAborted();

      if (result.status === 'failed' || !result.videoUrl) {
        throw new Error(result.error || 'animate failed');
      }

      return {
        outputs: { videoUrl: result.videoUrl, model: chosen.id, latencyMs: Date.now() - startedAt },
        modelUsed: chosen.id,
        providerCostUsd: chosen.providerCostUsd,
        creditsCharged: cost,
      };
    } catch (err) {
      await refundCredits(ctx.ownerUid, cost);
      throw err;
    }
  },
};

const upscaleExecutor: NodeExecutor<UpscaleNodeParams> = {
  kind: 'upscale',
  contract: NODE_IO_CONTRACTS.upscale,
  estimateCost: (p) => UPSCALE_NODE_CREDITS_BY_FACTOR[p.factor],
  async execute({ params, inputs, ctx }) {
    ctx.signal.throwIfAborted();
    const imageUrl = inputs.imageUrl as string | undefined;
    if (!imageUrl) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'upscale node requires upstream imageUrl input',
      });
    }
    const cost = UPSCALE_NODE_CREDITS_BY_FACTOR[params.factor];
    await deductCredits(ctx.ownerUid, cost, 'upscale');

    try {
      const falModel = params.prompt ? 'fal-ai/creative-upscaler' : 'fal-ai/real-esrgan';
      const result = await falService.upscaleImage({
        imageUrl,
        model: falModel,
        prompt: params.prompt,
        scale: params.factor,
      });
      ctx.signal.throwIfAborted();

      if (result.status === 'failed' || !result.imageUrl) {
        throw new Error(result.error || 'upscale failed');
      }

      return {
        outputs: { imageUrl: result.imageUrl, scale: params.factor },
        modelUsed: falModel,
        providerCostUsd: params.factor === 4 ? 0.05 : 0.025,
        creditsCharged: cost,
      };
    } catch (err) {
      await refundCredits(ctx.ownerUid, cost);
      throw err;
    }
  },
};

// ── Registry ──────────────────────────────────────────────────────────

export const NODE_EXECUTORS: Record<WorkflowNodeKind, NodeExecutor> = {
  prompt: promptExecutor as NodeExecutor,
  ref: refExecutor as NodeExecutor,
  animate: animateExecutor as NodeExecutor,
  upscale: upscaleExecutor as NodeExecutor,
};

export function getNodeExecutor(kind: WorkflowNodeKind): NodeExecutor {
  const exec = NODE_EXECUTORS[kind];
  if (!exec) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `No executor registered for node kind ${kind}`,
    });
  }
  return exec;
}
