/**
 * Turns a `generation.generate` response into a finished video URL.
 *
 * With Redis configured the server queues the job and returns immediately
 * (`{ status: 'queued', generationId }`, no `videoUrl`); without it, it runs
 * inline and returns the `videoUrl` directly. Callers shouldn't care which, so
 * they hand the raw response here: an inline result is returned as-is, a queued
 * one is polled (`generation.jobStatus`) until it reaches a terminal state.
 */

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobStatusResult {
  status: JobStatus;
  message?: string | null;
  resultUrl?: string | null;
}

export interface GenerateResponse {
  videoUrl?: string | null;
  status?: string;
  generationId?: string;
}

/** The job was cancelled (by the user) before it produced a video. */
export class GenerationCancelledError extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'GenerationCancelledError';
  }
}

export interface ResolveOptions {
  /** Called once with the server generation id when the job turns out to be queued. */
  onQueued?: (generationId: string) => void;
  /** Stops polling silently (rejects with an AbortError) — e.g. on unmount. */
  signal?: AbortSignal;
  fetchStatus?: (generationId: string) => Promise<JobStatusResult>;
  sleep?: (ms: number) => Promise<void>;
  /** First poll delay; grows by 1.5x up to `maxPollMs`. */
  pollMs?: number;
  maxPollMs?: number;
  timeoutMs?: number;
  /** Consecutive failed status reads tolerated before giving up. */
  maxStatusErrors?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 20 * 60_000;

async function defaultFetchStatus(generationId: string): Promise<JobStatusResult> {
  const { trpcClient } = await import('@/utils/trpc');
  const s = await trpcClient.generation.jobStatus.query({ jobId: generationId });
  return { status: s.status, message: s.message, resultUrl: s.resultUrl };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export async function resolveVideoResult(
  response: GenerateResponse | null | undefined,
  opts: ResolveOptions = {}
): Promise<string> {
  if (response?.videoUrl) return response.videoUrl;

  const generationId = response?.generationId;
  if (!generationId || response?.status !== 'queued') {
    throw new Error('No video returned');
  }
  opts.onQueued?.(generationId);

  const fetchStatus = opts.fetchStatus ?? defaultFetchStatus;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const maxPollMs = opts.maxPollMs ?? 8_000;
  const maxStatusErrors = opts.maxStatusErrors ?? 5;
  const deadline = now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let delay = opts.pollMs ?? 3_000;
  let statusErrors = 0;

  for (;;) {
    if (opts.signal?.aborted) throw abortError();

    let status: JobStatusResult | null = null;
    try {
      status = await fetchStatus(generationId);
      statusErrors = 0;
    } catch (err) {
      // A flaky poll shouldn't fail a render that is still running server-side.
      if (++statusErrors >= maxStatusErrors) throw err;
    }

    if (status) {
      if (status.status === 'completed') {
        if (!status.resultUrl) throw new Error('No video returned');
        return status.resultUrl;
      }
      if (status.status === 'failed') throw new Error(status.message || 'Video generation failed');
      if (status.status === 'cancelled') throw new GenerationCancelledError();
    }

    if (now() >= deadline) throw new Error('Video generation timed out');
    await sleep(delay);
    delay = Math.min(maxPollMs, Math.round(delay * 1.5));
  }
}
