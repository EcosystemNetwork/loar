/**
 * BullMQ Job Queue Infrastructure
 *
 * Provides persistent, distributed job queues backed by Redis for:
 * - Video/image/audio generation (decouple from HTTP request lifecycle)
 * - File upload redundancy (multi-provider fan-out)
 * - Background tasks (storage persistence, gallery publish, quest tracking)
 *
 * Queues survive process restarts. Workers can run in separate processes
 * for horizontal scaling.
 */

import { Queue, Worker, QueueEvents, type Job, type WorkerOptions } from 'bullmq';
import { getRedisClientAsync } from './redis';

// ── Queue Names ────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  GENERATION: 'generation',
  UPLOAD: 'upload',
  BACKGROUND: 'background',
} as const;

// ── Types ──────────────────────────────────────────────────────────────

export interface GenerationJobData {
  generationId: string;
  userId: string;
  input: Record<string, any>;
  finalModelId: string;
  provider: string;
  creditsCharged: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  providerCostUsd: number;
  reasonCode: string;
  originalPrompt: string;
  resolvedCastUrls?: string[];
  genConfig?: any;
}

export interface GenerationJobResult {
  generationId: string;
  status: 'completed' | 'failed';
  videoUrl?: string;
  fallbackModelId?: string;
  wasFallback: boolean;
  latencyMs: number;
  error?: string;
}

export interface UploadJobData {
  generationId: string;
  videoUrl: string;
  userId: string;
  modelId?: string;
  prompt?: string;
}

export interface BackgroundJobData {
  type: 'gallery_publish' | 'quest_track' | 'entity_attach';
  payload: Record<string, any>;
}

// ── Queue Instances (lazy-initialized) ─────────────────────────────────

let generationQueue: Queue<GenerationJobData, GenerationJobResult> | null = null;
let uploadQueue: Queue<UploadJobData> | null = null;
let backgroundQueue: Queue<BackgroundJobData> | null = null;
let generationEvents: QueueEvents | null = null;

/** Redis connection options extracted from REDIS_URL */
function getConnectionOpts() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for job queue');

  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

// ── Queue Getters ──────────────────────────────────────────────────────

export function getGenerationQueue(): Queue<GenerationJobData, GenerationJobResult> {
  if (!generationQueue) {
    const connection = getConnectionOpts();
    generationQueue = new Queue(QUEUE_NAMES.GENERATION, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600, count: 1000 }, // Keep 1h or 1000 jobs
        removeOnFail: { age: 86400, count: 5000 }, // Keep 24h or 5000 failures
      },
    });
  }
  return generationQueue;
}

export function getUploadQueue(): Queue<UploadJobData> {
  if (!uploadQueue) {
    const connection = getConnectionOpts();
    uploadQueue = new Queue(QUEUE_NAMES.UPLOAD, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400, count: 2000 },
      },
    });
  }
  return uploadQueue;
}

export function getBackgroundQueue(): Queue<BackgroundJobData> {
  if (!backgroundQueue) {
    const connection = getConnectionOpts();
    backgroundQueue = new Queue(QUEUE_NAMES.BACKGROUND, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 1800 },
        removeOnFail: { age: 43200 },
      },
    });
  }
  return backgroundQueue;
}

export function getGenerationEvents(): QueueEvents {
  if (!generationEvents) {
    const connection = getConnectionOpts();
    generationEvents = new QueueEvents(QUEUE_NAMES.GENERATION, { connection });
  }
  return generationEvents;
}

// ── Admission Control ──────────────────────────────────────────────────

const MAX_CONCURRENT_GENERATIONS = parseInt(process.env.MAX_CONCURRENT_GENERATIONS || '50', 10);
const MAX_QUEUED_GENERATIONS = parseInt(process.env.MAX_QUEUED_GENERATIONS || '200', 10);

/**
 * Check if the generation queue can accept a new job.
 * Returns { allowed, position, reason }.
 */
export async function checkAdmission(): Promise<{
  allowed: boolean;
  position?: number;
  queueDepth: number;
  activeCount: number;
  reason?: string;
}> {
  try {
    const queue = getGenerationQueue();
    const [waiting, active] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount()]);

    const queueDepth = waiting + active;

    if (active >= MAX_CONCURRENT_GENERATIONS && waiting >= MAX_QUEUED_GENERATIONS) {
      return {
        allowed: false,
        queueDepth,
        activeCount: active,
        reason: `Server at capacity (${active} active, ${waiting} queued). Please try again in a few minutes.`,
      };
    }

    return {
      allowed: true,
      position: waiting + 1,
      queueDepth,
      activeCount: active,
    };
  } catch {
    // If Redis is down, allow with degraded mode
    return { allowed: true, queueDepth: -1, activeCount: -1 };
  }
}

// ── Queue Metrics ──────────────────────────────────────────────────────

export async function getQueueMetrics() {
  try {
    const queue = getGenerationQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed, healthy: true };
  } catch {
    return { waiting: -1, active: -1, completed: -1, failed: -1, delayed: -1, healthy: false };
  }
}

// ── Graceful Shutdown ──────────────────────────────────────────────────

export async function shutdownQueues(): Promise<void> {
  const closeOps: Promise<void>[] = [];
  if (generationQueue) closeOps.push(generationQueue.close());
  if (uploadQueue) closeOps.push(uploadQueue.close());
  if (backgroundQueue) closeOps.push(backgroundQueue.close());
  if (generationEvents) closeOps.push(generationEvents.close());
  await Promise.allSettled(closeOps);
  generationQueue = null;
  uploadQueue = null;
  backgroundQueue = null;
  generationEvents = null;
}
