/**
 * Historical backfill loop.
 *
 * Walks from checkpoint.lastBlockIndexed (or startBlock on cold start) up to
 * the current head minus finalityDepth in chunks of MAX_BLOCK_RANGE. Each
 * chunk delegates to `ingestRange` which handles fetch + dispatch + commit.
 * Writes the new checkpoint after every successful chunk so a crash replays
 * at most one chunk.
 */
import { env } from './env.js';
import { logger } from './logger.js';
import { chainConfig } from './chain-config.js';
import { client } from './rpc.js';
import { loadCheckpoint, writeCheckpoint } from './checkpoint.js';
import { hydrateFactoryCache } from './factory.js';
import { ingestRange } from './ingest.js';

export async function runBackfill(): Promise<number> {
  await hydrateFactoryCache();

  const existing = await loadCheckpoint();
  const fromBlock =
    existing && existing.lastBlockIndexed >= chainConfig.startBlock
      ? existing.lastBlockIndexed + 1
      : chainConfig.startBlock;

  const head = Number(await client.getBlockNumber());
  const target = Math.max(chainConfig.startBlock, head - env.LISTENER_FINALITY_DEPTH);

  if (fromBlock > target) {
    logger.info({ fromBlock, target }, 'backfill up to date');
    return target;
  }

  logger.info({ fromBlock, target, gap: target - fromBlock }, 'starting backfill');

  let currentBlock = fromBlock;
  while (currentBlock <= target) {
    const toBlock = Math.min(currentBlock + env.LISTENER_BLOCK_RANGE - 1, target);
    const start = Date.now();
    try {
      const { eventCount } = await ingestRange(currentBlock, toBlock, { unconfirmed: false });
      await writeCheckpoint(toBlock, head);
      logger.info(
        {
          fromBlock: currentBlock,
          toBlock,
          eventCount,
          durationMs: Date.now() - start,
          progressPct: (((toBlock - fromBlock) / (target - fromBlock)) * 100).toFixed(1),
        },
        'backfill chunk complete'
      );
      currentBlock = toBlock + 1;
    } catch (err) {
      logger.error(
        { err: (err as Error).message, fromBlock: currentBlock, toBlock },
        'backfill chunk failed — retrying after delay'
      );
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  return target;
}
