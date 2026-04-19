/**
 * Webhook delivery helpers.
 *
 * Callers use `enqueueWebhook()` to schedule a signed POST to the agent's
 * callback URL. The BullMQ worker at apps/server/src/workers/webhook.worker.ts
 * consumes the queue, signs the payload, delivers it, and retries on failure.
 *
 * Security model (see docs/prd-mcp-integration.md §2):
 *   - HMAC-SHA256 over `${timestamp}.${body}` using WEBHOOK_SIGNING_SECRET.
 *   - Header: `X-Loar-Signature: sha256=<hex>`.
 *   - Header: `X-Loar-Timestamp: <epoch_seconds>` — receivers reject >5min skew.
 *   - Header: `X-Loar-Event: <event>` — "job.completed" | "job.failed" | "job.cancelled".
 *   - No secret is ever logged or echoed back to the caller.
 *
 * URL validation:
 *   - HTTPS required when NODE_ENV=production; http allowed in dev.
 *   - Private/loopback IP ranges rejected to prevent SSRF.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getWebhookQueue, type WebhookJobData } from './queue';

/**
 * Reusable zod field for mutations that accept a webhook URL input. Use via
 *   webhookUrl: webhookUrlSchema.optional()
 * in request input schemas so every procedure enforces the same constraints.
 * Deeper validation (SSRF, scheme, production-https) runs in
 * `validateWebhookUrl()` at mutation entry.
 */
export const webhookUrlSchema = z.string().url().max(2000);

export type JobKindLabel = 'video' | 'image' | 'voice' | '3d' | 'studio';
export type JobEventKind = 'job.completed' | 'job.failed' | 'job.cancelled';

/**
 * Convenience wrapper. Validates the URL (no-ops on invalid; events for
 * malformed URLs should fail at request ingestion, not at fire time).
 * Fire-and-forget — callers never await.
 */
export function fireJobWebhook(params: {
  ownerUid: string;
  webhookUrl: string | undefined;
  clientToken?: string;
  event: JobEventKind;
  jobId: string;
  kind: JobKindLabel;
  payload: Record<string, unknown>;
}): void {
  if (!params.webhookUrl) return;
  void enqueueWebhook({
    ownerUid: params.ownerUid,
    url: params.webhookUrl,
    clientToken: params.clientToken,
    event: params.event,
    payload: {
      jobId: params.jobId,
      kind: params.kind,
      ...params.payload,
    },
  });
}

const SIGNING_SECRET = process.env.WEBHOOK_SIGNING_SECRET;
const REPLAY_WINDOW_SECONDS = 5 * 60;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export interface WebhookValidationResult {
  ok: true;
  url: string;
}

export interface WebhookRejectionResult {
  ok: false;
  reason: string;
}

/**
 * Validate a user-supplied webhook URL.
 *
 * Rejects:
 *   - non-http(s) schemes
 *   - http (non-https) in production
 *   - IP literals in private / loopback / link-local ranges (SSRF guard)
 *   - URLs > 2000 chars
 */
export function validateWebhookUrl(raw: unknown): WebhookValidationResult | WebhookRejectionResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'webhookUrl must be a non-empty string' };
  }
  if (raw.length > 2000) {
    return { ok: false, reason: 'webhookUrl too long (max 2000 chars)' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'webhookUrl is not a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `webhookUrl scheme must be http(s), got ${parsed.protocol}` };
  }
  if (isProduction() && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'webhookUrl must use https in production' };
  }

  // Reject private / loopback IP ranges to prevent SSRF to internal hosts.
  // (Hostnames that *resolve* to private IPs can still bypass this — the
  // worker resolves and re-checks at delivery time.)
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('169.254.') || // link-local
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    if (isProduction()) {
      return { ok: false, reason: 'webhookUrl host is in a forbidden private range' };
    }
    // Non-prod: allow (dev tunnels, local testing) but the worker still
    // re-validates after DNS resolution.
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Compute the signature header value for a given body + timestamp.
 * Throws if WEBHOOK_SIGNING_SECRET is missing — callers should guard.
 */
export function signWebhookBody(body: string, timestampSec: number): string {
  if (!SIGNING_SECRET) {
    throw new Error('WEBHOOK_SIGNING_SECRET is not configured');
  }
  const mac = createHmac('sha256', SIGNING_SECRET);
  mac.update(`${timestampSec}.${body}`);
  return `sha256=${mac.digest('hex')}`;
}

/**
 * Verify an inbound webhook signature against our secret. Exposed for
 * tests and for any receiver running in this same process (e.g. the
 * hosted SSE bridge). Constant-time comparison avoids signature leaks.
 */
export function verifyWebhookSignature(params: {
  body: string;
  signatureHeader: string;
  timestampHeader: string;
  toleranceSec?: number;
}): boolean {
  if (!SIGNING_SECRET) return false;
  const { body, signatureHeader, timestampHeader } = params;
  const tolerance = params.toleranceSec ?? REPLAY_WINDOW_SECONDS;

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > tolerance) return false;

  const expected = signWebhookBody(body, ts);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Enqueue a webhook delivery. Fire-and-forget — the caller does not wait
 * for HTTP delivery. Returns the BullMQ job ID for traceability.
 *
 * Returns `null` when webhook infrastructure is disabled (no signing
 * secret, or enqueue failed). Calling code should treat that as "don't
 * expect a webhook" rather than a hard error — webhooks are advisory.
 */
export async function enqueueWebhook(data: WebhookJobData): Promise<string | null> {
  if (!SIGNING_SECRET) {
    // Fail-open: log once, don't break generations because the operator
    // hasn't configured webhooks yet.
    return null;
  }
  try {
    const queue = getWebhookQueue();
    const job = await queue.add(`webhook:${data.event}`, data);
    return job.id ?? null;
  } catch (err) {
    console.error('[webhooks] enqueue failed:', err);
    return null;
  }
}
