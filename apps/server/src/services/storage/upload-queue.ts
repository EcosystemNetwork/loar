/**
 * In-memory upload queue with retry logic (3x exponential backoff).
 * Jobs are processed in the background and can be polled for status.
 * Completed/failed jobs are cleaned up after 1 hour.
 */
import type { StorageManifest, ProviderStatus } from './types';
import { getStorageManager } from './manager';

export interface UploadJob {
  id: string;
  userId: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number; // 0-100
  filename: string;
  mimeType: string;
  sourceUrl?: string;
  manifest?: StorageManifest;
  error?: string;
  providers: ProviderStatus[];
  createdAt: number;
  updatedAt: number;
  retryCount: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2_000, 5_000, 15_000]; // Exponential-ish backoff
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_QUEUE_SIZE = 1000;

export class UploadQueue {
  private static instance: UploadQueue | null = null;
  private jobs = new Map<string, UploadJob>();

  static getInstance(): UploadQueue {
    if (!this.instance) {
      this.instance = new UploadQueue();
    }
    return this.instance;
  }

  private constructor() {
    // Periodic cleanup of old completed/failed jobs
    setInterval(() => this.cleanup(), 1 * 60 * 1000);
  }

  /** Enqueue an upload from URL. Returns job ID immediately. */
  async enqueue(
    sourceUrl: string,
    filename: string,
    mimeType: string,
    userId: string
  ): Promise<string> {
    if (this.jobs.size >= MAX_QUEUE_SIZE) {
      throw new Error(`Upload queue is full (${MAX_QUEUE_SIZE} jobs). Try again later.`);
    }

    const jobId = crypto.randomUUID();
    const now = Date.now();

    const job: UploadJob = {
      id: jobId,
      userId,
      status: 'pending',
      progress: 0,
      filename,
      mimeType,
      sourceUrl,
      providers: [],
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
    };

    this.jobs.set(jobId, job);

    // Start processing in background
    this.processJob(jobId);

    return jobId;
  }

  /** Enqueue a direct buffer upload. Returns job ID immediately. */
  async enqueueBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    userId: string
  ): Promise<string> {
    if (this.jobs.size >= MAX_QUEUE_SIZE) {
      throw new Error(`Upload queue is full (${MAX_QUEUE_SIZE} jobs). Try again later.`);
    }

    const jobId = crypto.randomUUID();
    const now = Date.now();

    const job: UploadJob = {
      id: jobId,
      userId,
      status: 'pending',
      progress: 0,
      filename,
      mimeType,
      providers: [],
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
    };

    this.jobs.set(jobId, job);

    // Start processing in background with buffer
    this.processBufferJob(jobId, buffer);

    return jobId;
  }

  getStatus(jobId: string): UploadJob | undefined {
    return this.jobs.get(jobId);
  }

  getActiveJobs(userId?: string): UploadJob[] {
    const all = [...this.jobs.values()];
    const active = all.filter((j) => j.status === 'pending' || j.status === 'uploading');
    if (userId) {
      return active.filter((j) => j.userId === userId);
    }
    return active;
  }

  getRecentJobs(userId?: string, limit = 20): UploadJob[] {
    let all = [...this.jobs.values()];
    if (userId) {
      all = all.filter((j) => j.userId === userId);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  /** Retry a failed job. */
  async retry(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'failed') return false;

    job.status = 'pending';
    job.progress = 0;
    job.error = undefined;
    job.retryCount++;
    job.updatedAt = Date.now();

    if (job.sourceUrl) {
      this.processJob(jobId);
    }
    return true;
  }

  // ─── Internal Processing ──────────────────────────────────

  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !job.sourceUrl) return;

    job.status = 'uploading';
    job.progress = 10;
    job.updatedAt = Date.now();

    try {
      const manager = getStorageManager();
      job.progress = 30;
      job.updatedAt = Date.now();

      const manifest = await manager.uploadFromUrl(job.sourceUrl, job.filename);

      job.status = 'completed';
      job.progress = 100;
      job.manifest = manifest;
      job.providers = manifest.uploads.map((u) => ({
        name: u.provider,
        status: 'completed' as const,
        contentId: u.contentId,
        url: u.url,
      }));
      job.updatedAt = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.error = msg;

      if (job.retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[job.retryCount] || 15_000;
        job.status = 'pending';
        job.retryCount++;
        job.updatedAt = Date.now();

        console.log(
          `[UploadQueue] Job ${jobId} failed, retrying in ${delay}ms (attempt ${job.retryCount}/${MAX_RETRIES})`
        );

        setTimeout(() => this.processJob(jobId), delay);
      } else {
        job.status = 'failed';
        job.updatedAt = Date.now();
        console.error(
          `[UploadQueue] Job ${jobId} permanently failed after ${MAX_RETRIES} retries: ${msg}`
        );
      }
    }
  }

  private async processBufferJob(jobId: string, buffer: Buffer): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'uploading';
    job.progress = 10;
    job.updatedAt = Date.now();

    try {
      const manager = getStorageManager();
      job.progress = 30;
      job.updatedAt = Date.now();

      const manifest = await manager.upload(buffer, job.filename, job.mimeType);

      job.status = 'completed';
      job.progress = 100;
      job.manifest = manifest;
      job.providers = manifest.uploads.map((u) => ({
        name: u.provider,
        status: 'completed' as const,
        contentId: u.contentId,
        url: u.url,
      }));
      job.updatedAt = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.error = msg;

      if (job.retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[job.retryCount] || 15_000;
        job.status = 'pending';
        job.retryCount++;
        job.updatedAt = Date.now();

        console.log(
          `[UploadQueue] Buffer job ${jobId} failed, retrying in ${delay}ms (attempt ${job.retryCount}/${MAX_RETRIES})`
        );

        setTimeout(() => this.processBufferJob(jobId, buffer), delay);
      } else {
        job.status = 'failed';
        job.updatedAt = Date.now();
        console.error(
          `[UploadQueue] Buffer job ${jobId} permanently failed after ${MAX_RETRIES} retries: ${msg}`
        );
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        now - job.updatedAt > JOB_TTL_MS
      ) {
        this.jobs.delete(id);
      }
    }
  }
}

export function getUploadQueue(): UploadQueue {
  return UploadQueue.getInstance();
}
