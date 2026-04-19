/**
 * SSE endpoint for real-time job status updates.
 *
 * Clients subscribe to /api/jobs/:generationId/stream and receive
 * progress events as the generation worker processes the job.
 * This replaces the blocking inline generation pattern.
 */

import { Hono } from 'hono';
import { getGenerationEvents, getGenerationQueue } from '../lib/queue';
import { verifyAuth } from '../lib/auth';

export const jobStatusRouter = new Hono();

/**
 * GET /api/jobs/:generationId/stream
 *
 * SSE stream that emits:
 *   - progress: { percent: 0-100 }
 *   - completed: { videoUrl, modelUsed, ... }
 *   - failed: { error }
 *   - heartbeat: { ts }
 */
jobStatusRouter.get('/:generationId/stream', async (c) => {
  const generationId = c.req.param('generationId');
  if (!generationId) return c.json({ error: 'generationId required' }, 400);

  // Auth check
  const { getCookie } = await import('hono/cookie');
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  // Ownership gate — a generationId that doesn't belong to the caller
  // is indistinguishable from one that doesn't exist. Prevents a signed-in
  // user from tailing another user's prompt + output URL when they learn
  // a UUID via a shared link, webhook log, or event stream.
  try {
    const queue = getGenerationQueue();
    const job = await queue.getJob(generationId);
    if (job) {
      const ownerUid =
        (job.data as { userId?: string; creatorUid?: string } | undefined)?.userId ??
        (job.data as { creatorUid?: string } | undefined)?.creatorUid;
      if (ownerUid && ownerUid.toLowerCase() !== user.uid.toLowerCase()) {
        return c.json({ error: 'Not found' }, 404);
      }
    }
  } catch {
    // Queue not reachable — let the stream fall through and it will close.
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      let closed = false;

      // Check if job already completed (late subscriber)
      try {
        const queue = getGenerationQueue();
        const job = await queue.getJob(generationId);
        if (job) {
          const state = await job.getState();
          if (state === 'completed') {
            const result = job.returnvalue;
            send('completed', result);
            controller.close();
            return;
          }
          if (state === 'failed') {
            send('failed', { error: job.failedReason || 'Generation failed' });
            controller.close();
            return;
          }
          // Send current progress
          const progress = job.progress;
          if (typeof progress === 'number') {
            send('progress', { percent: progress });
          }
        }
      } catch {
        // Queue not available — fall back to polling
      }

      // Subscribe to events
      const events = getGenerationEvents();

      const onProgress = ({ jobId, data }: { jobId: string; data: any }) => {
        if (jobId === generationId && !closed) {
          send('progress', { percent: typeof data === 'number' ? data : data?.percent || 0 });
        }
      };

      const onCompleted = ({ jobId, returnvalue }: { jobId: string; returnvalue: any }) => {
        if (jobId === generationId && !closed) {
          closed = true;
          const result = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
          send('completed', result);
          cleanup();
          controller.close();
        }
      };

      const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
        if (jobId === generationId && !closed) {
          closed = true;
          send('failed', { error: failedReason || 'Generation failed' });
          cleanup();
          controller.close();
        }
      };

      events.on('progress', onProgress);
      events.on('completed', onCompleted);
      events.on('failed', onFailed);

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (!closed) {
          send('heartbeat', { ts: Date.now() });
        }
      }, 15_000);

      // Timeout — close after 10 minutes no matter what
      const timeout = setTimeout(() => {
        if (!closed) {
          closed = true;
          send('timeout', { message: 'Generation timed out' });
          cleanup();
          controller.close();
        }
      }, 600_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        events.off('progress', onProgress);
        events.off('completed', onCompleted);
        events.off('failed', onFailed);
      };

      // Client disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        closed = true;
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

/**
 * GET /api/jobs/:generationId/status
 *
 * One-shot status check (for clients that don't want SSE).
 */
jobStatusRouter.get('/:generationId/status', async (c) => {
  const generationId = c.req.param('generationId');

  const { getCookie } = await import('hono/cookie');
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const queue = getGenerationQueue();
    const job = await queue.getJob(generationId);

    if (!job) {
      return c.json({ status: 'not_found' }, 404);
    }

    const ownerUid =
      (job.data as { userId?: string; creatorUid?: string } | undefined)?.userId ??
      (job.data as { creatorUid?: string } | undefined)?.creatorUid;
    if (ownerUid && ownerUid.toLowerCase() !== user.uid.toLowerCase()) {
      return c.json({ status: 'not_found' }, 404);
    }

    const state = await job.getState();
    const progress = job.progress;

    return c.json({
      generationId,
      status: state,
      progress: typeof progress === 'number' ? progress : 0,
      result: state === 'completed' ? job.returnvalue : undefined,
      error: state === 'failed' ? job.failedReason : undefined,
    });
  } catch {
    return c.json({ status: 'unknown' }, 500);
  }
});
