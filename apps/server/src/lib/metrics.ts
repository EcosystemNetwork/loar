/**
 * Prometheus metrics for the LOAR server.
 *
 * The registry is populated lazily (prom-client's default registry plus the
 * process metrics it ships with). Export helper functions so call sites record
 * events without importing prom-client directly — keeps instrumentation trivial
 * to add and cheap to remove.
 *
 * Scrape endpoint is mounted in `src/index.ts` at `/metrics` and is protected
 * by `METRICS_AUTH_TOKEN` when set (bearer token).
 */
import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'loar_' });

// ── HTTP ───────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'loar_http_requests_total',
  help: 'Total HTTP requests by method, route, and status class.',
  labelNames: ['method', 'route', 'status'] as const,
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'loar_http_request_duration_seconds',
  help: 'HTTP request duration in seconds by route.',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

// ── Domain counters ────────────────────────────────────────────────────

export const aiGenerationTotal = new Counter({
  name: 'loar_ai_generation_total',
  help: 'AI generation jobs by provider, kind, and outcome.',
  labelNames: ['provider', 'kind', 'status'] as const,
});

export const aiGenerationDurationSeconds = new Histogram({
  name: 'loar_ai_generation_duration_seconds',
  help: 'AI generation wall-clock duration in seconds.',
  labelNames: ['provider', 'kind'] as const,
  buckets: [1, 5, 15, 30, 60, 120, 240, 480, 900],
});

export const storageUploadTotal = new Counter({
  name: 'loar_storage_upload_total',
  help: 'Storage uploads by provider and outcome.',
  labelNames: ['provider', 'status'] as const,
});

export const creditsTxTotal = new Counter({
  name: 'loar_credits_transactions_total',
  help: 'Credit transactions by kind (grant, spend, refund, purchase).',
  labelNames: ['kind', 'status'] as const,
});

export const authEventsTotal = new Counter({
  name: 'loar_auth_events_total',
  help: 'Auth events by kind (nonce, verify, refresh) and outcome.',
  labelNames: ['kind', 'status'] as const,
});

// ── Live gauges (populated on scrape from source of truth) ─────────────

const queueDepthGauge = new Gauge({
  name: 'loar_queue_depth',
  help: 'BullMQ queue depth by queue name and state.',
  labelNames: ['queue', 'state'] as const,
});

const circuitBreakerStateGauge = new Gauge({
  name: 'loar_circuit_breaker_state',
  help: 'Circuit breaker state per provider: 0=closed, 1=half_open, 2=open.',
  labelNames: ['provider'] as const,
});

const circuitBreakerFailuresGauge = new Gauge({
  name: 'loar_circuit_breaker_failures',
  help: 'Current consecutive failure count per provider circuit.',
  labelNames: ['provider'] as const,
});

// ── Recording helpers ──────────────────────────────────────────────────

/** Record an HTTP request. `route` should be the matched route pattern, not the raw URL. */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number
): void {
  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  httpRequestsTotal.labels(method, route, statusClass).inc();
  httpRequestDurationSeconds.labels(method, route).observe(durationSeconds);
}

export function recordAiGeneration(
  provider: string,
  kind: string,
  status: 'success' | 'failure' | 'timeout',
  durationSeconds?: number
): void {
  aiGenerationTotal.labels(provider, kind, status).inc();
  if (typeof durationSeconds === 'number') {
    aiGenerationDurationSeconds.labels(provider, kind).observe(durationSeconds);
  }
}

export function recordStorageUpload(
  provider: string,
  status: 'success' | 'failure' | 'fallback'
): void {
  storageUploadTotal.labels(provider, status).inc();
}

export function recordCreditsTx(
  kind: 'grant' | 'spend' | 'refund' | 'purchase',
  status: 'success' | 'failure'
): void {
  creditsTxTotal.labels(kind, status).inc();
}

export function recordAuthEvent(
  kind: 'nonce' | 'verify' | 'refresh',
  status: 'success' | 'failure'
): void {
  authEventsTotal.labels(kind, status).inc();
}

// ── Scrape-time snapshot ───────────────────────────────────────────────

const CIRCUIT_STATE_CODE: Record<string, number> = {
  closed: 0,
  half_open: 1,
  open: 2,
};

async function refreshLiveGauges(): Promise<void> {
  if (!process.env.REDIS_URL) return;

  try {
    const { getQueueMetrics } = await import('./queue');
    const m = await getQueueMetrics();
    if (m.healthy) {
      queueDepthGauge.labels('generation', 'waiting').set(m.waiting);
      queueDepthGauge.labels('generation', 'active').set(m.active);
      queueDepthGauge.labels('generation', 'delayed').set(m.delayed);
      queueDepthGauge.labels('generation', 'failed').set(m.failed);
    }
  } catch {
    // Queue module may not be initialized yet — skip silently.
  }

  try {
    const { getAllCircuitStates } = await import('./circuit-breaker');
    const states = await getAllCircuitStates();
    for (const [provider, s] of Object.entries(states)) {
      circuitBreakerStateGauge.labels(provider).set(CIRCUIT_STATE_CODE[s.state] ?? 0);
      circuitBreakerFailuresGauge.labels(provider).set(s.failures);
    }
  } catch {
    // Breakers lazily created on first use — pre-init is acceptable.
  }
}

/**
 * Produce the Prometheus exposition payload. Refreshes gauges that mirror
 * live state (queues, circuit breakers) immediately before serialising.
 */
export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  await refreshLiveGauges();
  const body = await register.metrics();
  return { body, contentType: register.contentType };
}

export { register };
