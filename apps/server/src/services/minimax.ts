/**
 * MiniMax Video Generation Service — Hailuo 02 / 2.3 direct integration.
 *
 * FAL doesn't host MiniMax video models, so we call MiniMax's REST API
 * directly. Three-step flow:
 *
 *   1. POST /v1/video_generation         → returns { task_id }
 *   2. GET  /v1/query/video_generation   → poll until status='Success' (file_id) or 'Fail'
 *   3. GET  /v1/files/retrieve           → returns { file: { download_url } }
 *
 * We expose a single `generateVideo` that wraps all three so the caller
 * gets the same `{ id, status, videoUrl, error }` shape every other provider
 * (FAL / ByteDance / Sora / Z.AI) returns.
 *
 * Auth: `Authorization: Bearer ${MINIMAX_API_KEY}` (server env var).
 * Reference: https://platform.minimax.io/docs/api-reference/video-generation-t2v
 */

const MINIMAX_API_BASE = 'https://api.minimax.io/v1';
const POLL_INTERVAL_MS = 8_000;
const POLL_MAX_ATTEMPTS = 120; // ~16 minutes ceiling

export interface MinimaxVideoOptions {
  apiKey?: string;
  /** e.g. 'MiniMax-Hailuo-02' or 'MiniMax-Hailuo-2.3' */
  model: string;
  prompt: string;
  /** First-frame image URL for image-to-video. Optional. */
  firstFrameImageUrl?: string;
  /** Seconds; MiniMax accepts 6 or 10 depending on model. */
  duration?: number;
  /** '512P' | '768P' | '1080P' — case sensitive per docs. */
  resolution?: string;
  promptOptimizer?: boolean;
}

export interface MinimaxVideoResult {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

interface CreateTaskResponse {
  task_id?: string;
  base_resp?: { status_code: number; status_msg: string };
}

interface QueryTaskResponse {
  task_id?: string;
  status?: 'Preparing' | 'Queueing' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
  base_resp?: { status_code: number; status_msg: string };
}

interface FileRetrieveResponse {
  file?: { download_url?: string; file_id?: string };
  base_resp?: { status_code: number; status_msg: string };
}

function resolveApiKey(suppliedKey?: string): string | null {
  return suppliedKey || process.env.MINIMAX_API_KEY || null;
}

async function createTask(apiKey: string, opts: MinimaxVideoOptions): Promise<CreateTaskResponse> {
  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    duration: opts.duration ?? 6,
    resolution: opts.resolution ?? '768P',
    prompt_optimizer: opts.promptOptimizer ?? true,
  };
  if (opts.firstFrameImageUrl) {
    body.first_frame_image = opts.firstFrameImageUrl;
  }

  const res = await fetch(`${MINIMAX_API_BASE}/video_generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`MiniMax create task HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as CreateTaskResponse;
}

async function queryTask(apiKey: string, taskId: string): Promise<QueryTaskResponse> {
  const url = `${MINIMAX_API_BASE}/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`MiniMax query HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as QueryTaskResponse;
}

async function retrieveFileUrl(apiKey: string, fileId: string): Promise<string | null> {
  const url = `${MINIMAX_API_BASE}/files/retrieve?file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`MiniMax file retrieve HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as FileRetrieveResponse;
  return json.file?.download_url ?? null;
}

class MinimaxService {
  async generateVideo(opts: MinimaxVideoOptions): Promise<MinimaxVideoResult> {
    const apiKey = resolveApiKey(opts.apiKey);
    if (!apiKey) {
      return {
        id: '',
        status: 'failed',
        error: 'MINIMAX_API_KEY is not configured — set one in env or BYOK',
      };
    }

    let taskId: string;
    try {
      const created = await createTask(apiKey, opts);
      if (created.base_resp && created.base_resp.status_code !== 0) {
        return {
          id: '',
          status: 'failed',
          error: `MiniMax create task: ${created.base_resp.status_msg}`,
        };
      }
      if (!created.task_id) {
        return { id: '', status: 'failed', error: 'MiniMax create task returned no task_id' };
      }
      taskId = created.task_id;
    } catch (err) {
      return {
        id: '',
        status: 'failed',
        error: err instanceof Error ? err.message : 'MiniMax create task failed',
      };
    }

    // Poll until the task is in a terminal state.
    let lastStatus: QueryTaskResponse | null = null;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      try {
        const current = await queryTask(apiKey, taskId);
        lastStatus = current;
        if (current.status === 'Success' && current.file_id) {
          const downloadUrl = await retrieveFileUrl(apiKey, current.file_id);
          if (!downloadUrl) {
            return {
              id: taskId,
              status: 'failed',
              error: 'MiniMax succeeded but file_id had no download URL',
            };
          }
          return { id: taskId, status: 'completed', videoUrl: downloadUrl };
        }
        if (current.status === 'Fail') {
          return {
            id: taskId,
            status: 'failed',
            error: current.base_resp?.status_msg || 'MiniMax reported Fail',
          };
        }
      } catch (err) {
        // Single query failure is non-fatal — keep polling. Bail if persistent
        // by counting failures, but for the MVP we let the attempt cap handle it.
        console.warn(`[minimax] poll attempt ${attempt + 1} failed:`, err);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    return {
      id: taskId,
      status: 'failed',
      error: `MiniMax did not complete after ${POLL_MAX_ATTEMPTS} polls (last status: ${
        lastStatus?.status ?? 'unknown'
      })`,
    };
  }
}

export const minimaxService = new MinimaxService();
