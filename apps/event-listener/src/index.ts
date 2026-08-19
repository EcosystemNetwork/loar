/**
 * Event-listener entry point. Starts a tiny Hono health server on PORT so
 * Railway's healthcheck can validate the service, hydrates the factory cache,
 * runs historical backfill, and then enters the live follow loop.
 *
 * The health endpoint MUST respond instantly (<1s) even during heavy backfill.
 * Railway marks the service FAILED if the healthcheck times out. We read from
 * an in-memory snapshot that the loops update; no Firestore calls on the hot
 * path.
 */
import { env } from './env.js';
import { logger } from './logger.js';
import './firestore.js'; // side-effectful init
import { runBackfill } from './backfill.js';
import { runLiveLoop } from './live.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

// In-memory health snapshot updated by the loops. Health check reads this
// synchronously — no awaited I/O — so healthcheck latency is independent of
// backfill load on the Firestore client.
const state = {
  ready: false,
  phase: 'booting' as 'booting' | 'backfilling' | 'live',
  lastBlockIndexed: 0,
  lastIndexedAt: 0,
  startedAt: Date.now(),
};

export function setPhase(phase: typeof state.phase) {
  state.phase = phase;
}
export function setLastBlock(block: number) {
  state.lastBlockIndexed = block;
  state.lastIndexedAt = Date.now();
}
export function markReady() {
  state.ready = true;
}

app.get('/health', (c) => {
  const stale = state.phase === 'live' && Date.now() - state.lastIndexedAt > 120_000;
  return c.json(
    {
      status: state.ready && !stale ? 'ok' : stale ? 'stale' : 'starting',
      phase: state.phase,
      chain: env.LISTENER_CHAIN,
      lastBlockIndexed: state.lastBlockIndexed,
      lastIndexedAt: state.lastIndexedAt || null,
      uptimeMs: Date.now() - state.startedAt,
    },
    stale ? 503 : 200
  );
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'health server listening');
});

process.on('unhandledRejection', (err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'unhandledRejection');
  process.exit(1);
});

async function main(): Promise<void> {
  logger.info({ chain: env.LISTENER_CHAIN }, 'event-listener booting');

  setPhase('backfilling');
  const lastBackfilled = await runBackfill();
  setLastBlock(lastBackfilled);
  setPhase('live');
  markReady();
  logger.info('backfill complete, entering live loop');
  await runLiveLoop(setLastBlock);
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message, stack: (err as Error).stack }, 'main crashed');
  process.exit(1);
});
