/**
 * Webhook Worker — delivers signed POSTs from the `webhook` BullMQ queue.
 *
 * Each job:
 *   1. Serializes payload to JSON.
 *   2. Signs with HMAC-SHA256 (see lib/webhooks.ts).
 *   3. POSTs to the target URL with a 10s fetch timeout.
 *   4. Treats 2xx as success. Any other outcome throws → BullMQ retries
 *      per the queue's exponential backoff (1s, 4s, 16s, 64s, 256s, 5 attempts).
 *   5. On final failure, the job is marked failed and surfaces in
 *      `getQueueMetrics()`; admin ops can inspect via BullMQ dashboards.
 *
 * Usage (standalone):
 *   node --loader tsx apps/server/src/workers/webhook.worker.ts
 *
 * Or import and `startWebhookWorker()` from the main server process.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type WebhookJobData, type WebhookJobResult } from '../lib/queue';
import { signWebhookBody } from '../lib/webhooks';

// ── Connection ─────────────────────────────────────────────────────────

function getConnectionOpts() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for webhook worker');
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

// ── Delivery ───────────────────────────────────────────────────────────

const DELIVERY_TIMEOUT_MS = 10_000;

async function deliver(job: Job<WebhookJobData, WebhookJobResult>): Promise<WebhookJobResult> {
  const { url, event, payload, clientToken, ownerUid } = job.data;

  // Stable payload shape — receivers should treat unknown fields as
  // additive; never rely on field order.
  const body = JSON.stringify({
    event,
    ownerUid,
    clientToken: clientToken ?? null,
    deliveredAt: new Date().toISOString(),
    ...payload,
  });

  const timestampSec = Math.floor(Date.now() / 1000);
  const signature = signWebhookBody(body, timestampSec);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'loar-webhook/1.0',
        'X-Loar-Event': event,
        'X-Loar-Signature': signature,
        'X-Loar-Timestamp': String(timestampSec),
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`webhook delivery returned HTTP ${res.status}`);
    }

    return {
      status: 'delivered',
      statusCode: res.status,
      attempts: job.attemptsMade + 1,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Throw to signal BullMQ to retry per the queue's backoff policy.
    // The final `WebhookJobResult` is only returned when delivery succeeds.
    throw new Error(`[webhook ${event} → ${url}] ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Worker Bootstrap ───────────────────────────────────────────────────

let worker: Worker<WebhookJobData, WebhookJobResult> | null = null;

export function startWebhookWorker(): Worker<WebhookJobData, WebhookJobResult> {
  if (worker) return worker;
  const connection = getConnectionOpts();
  const concurrency = parseInt(process.env.WEBHOOK_WORKER_CONCURRENCY || '10', 10);

  worker = new Worker<WebhookJobData, WebhookJobResult>(QUEUE_NAMES.WEBHOOK, deliver, {
    connection,
    concurrency,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 5);
    const prefix = final ? '[webhook FINAL_FAIL]' : '[webhook retry]';
    console.error(
      `${prefix} ${job.data.event} → ${job.data.url} (attempt ${job.attemptsMade}): ${err.message}`
    );
  });

  worker.on('completed', (job, result) => {
    console.error(
      `[webhook delivered] ${job.data.event} → ${job.data.url} ` +
        `(HTTP ${result.statusCode}, attempts=${result.attempts})`
    );
  });

  console.error(`Webhook worker started (concurrency=${concurrency})`);
  return worker;
}

export async function stopWebhookWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}

// If this file is the entry point, start the worker standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  startWebhookWorker();
  const shutdown = async () => {
    await stopWebhookWorker();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
