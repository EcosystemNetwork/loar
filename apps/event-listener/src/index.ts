/**
 * Event-listener entry point. Starts a tiny Hono health server on PORT so
 * Railway's healthcheck can validate the service, hydrates the factory cache,
 * runs historical backfill, and then enters the live follow loop.
 */
import { env } from './env.js';
import { logger } from './logger.js';
import './firestore.js'; // side-effectful init
import { runBackfill } from './backfill.js';
import { runLiveLoop } from './live.js';
import { loadCheckpoint } from './checkpoint.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

let ready = false;

app.get('/health', async (c) => {
  const cp = await loadCheckpoint().catch(() => null);
  return c.json({
    status: ready ? 'ok' : 'starting',
    chain: env.LISTENER_CHAIN,
    checkpoint: cp
      ? {
          lastBlockIndexed: cp.lastBlockIndexed,
          lastBlockFinalized: cp.lastBlockFinalized,
          headBlockKnown: cp.headBlockKnown,
        }
      : null,
  });
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'health server listening');
});

process.on('unhandledRejection', (err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'unhandledRejection');
  process.exit(1);
});

async function main(): Promise<void> {
  logger.info(
    {
      chain: env.LISTENER_CHAIN,
      skipBackfill: false,
    },
    'event-listener booting'
  );

  await runBackfill();
  ready = true;
  logger.info('backfill complete, entering live loop');
  await runLiveLoop();
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message, stack: (err as Error).stack }, 'main crashed');
  process.exit(1);
});
