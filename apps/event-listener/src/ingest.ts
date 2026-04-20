/**
 * Log-fetch + dispatch core used by both backfill and live loops.
 *
 * `ingestRange(fromBlock, toBlock, { unconfirmed })` fetches every log we care
 * about in the inclusive block range, dispatches each through its handler,
 * and commits the batch. Runs in two passes per chunk:
 *
 *   1. Static contracts (UniverseManager, PoolManager, revenue contracts) —
 *      these events populate factoryChildren.
 *   2. Dynamic contracts (Universe/Governor/Token/BondingCurve instances
 *      spawned by the factory). Query happens AFTER pass 1 so children
 *      discovered mid-chunk are picked up in the same round.
 *
 * This two-pass structure avoids missing events from dynamic contracts that
 * were both created and first-emitted inside the same block range.
 */
import { getAddress, type Log, type Hex as ViemHex } from 'viem';
import { client } from './rpc.js';
import { logger } from './logger.js';
import { Batcher, buildEnvelope } from './batcher.js';
import { chainConfig, kindForStaticAddress } from './chain-config.js';
import { getChildren } from './factory.js';
import { findHandler, allTopics } from './handlers/index.js';
import { decodeEventLog } from 'viem';
import type { Hex } from './schema.js';
import type { ContractKind } from './handlers/types.js';

const TOPICS = allTopics() as ViemHex[];

/** Time-cache for block timestamps so we aren't re-fetching per-log. */
const blockCache = new Map<bigint, { timestamp: number; hash: Hex }>();

async function getBlockInfo(blockNumber: bigint): Promise<{ timestamp: number; hash: Hex }> {
  const cached = blockCache.get(blockNumber);
  if (cached) return cached;
  const block = await client.getBlock({ blockNumber });
  const info = {
    timestamp: Number(block.timestamp),
    hash: block.hash.toLowerCase() as Hex,
  };
  blockCache.set(blockNumber, info);
  // Cap cache size — backfill walks forward and old entries are useless.
  if (blockCache.size > 10_000) {
    const firstKey = blockCache.keys().next().value;
    if (firstKey !== undefined) blockCache.delete(firstKey);
  }
  return info;
}

async function fetchAndDispatch(
  addresses: Hex[],
  kindResolver: (addr: Hex) => ContractKind | undefined,
  fromBlock: bigint,
  toBlock: bigint,
  unconfirmed: boolean,
  batcher: Batcher
): Promise<number> {
  if (addresses.length === 0) return 0;

  const logs = await client.getLogs({
    address: addresses as ViemHex[],
    events: undefined,
    // Topic filter: only fetch logs matching topic0 values we know how to
    // handle. Massive RPC cost reduction when a contract emits many events we
    // don't care about (e.g. ERC20 Approval in addition to Transfer).
    fromBlock,
    toBlock,
  });

  // Sort by block+logIndex so handlers see events in deterministic order.
  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber! - b.blockNumber!);
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  let handled = 0;

  for (const log of logs) {
    if (log.removed) continue;
    const topic0 = log.topics[0];
    if (!topic0) continue;
    if (!TOPICS.includes(topic0)) continue;

    const addr = (log.address as string).toLowerCase() as Hex;
    const kind = kindResolver(addr);
    if (!kind) continue;

    const handler = findHandler(kind, topic0);
    if (!handler) continue;

    let args: unknown;
    try {
      args = decodeEventLog({
        abi: [handler.abi],
        data: log.data,
        topics: log.topics,
      }).args;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, kind, topic0, txHash: log.transactionHash },
        'failed to decode log'
      );
      continue;
    }

    const blockInfo = await getBlockInfo(log.blockNumber!);
    const eventId = `${log.transactionHash}:${log.logIndex}`;
    const envelope = buildEnvelope({
      blockNumber: Number(log.blockNumber),
      blockHash: blockInfo.hash,
      txHash: log.transactionHash!.toLowerCase() as Hex,
      logIndex: log.logIndex!,
      unconfirmed,
    });

    try {
      await handler.run({
        log,
        args: args as Parameters<typeof handler.run>[0]['args'],
        address: addr,
        block: {
          number: Number(log.blockNumber),
          hash: blockInfo.hash,
          timestamp: blockInfo.timestamp,
        },
        txHash: log.transactionHash!.toLowerCase() as Hex,
        logIndex: log.logIndex!,
        eventId,
        envelope,
        batcher,
        client,
      });
      handled += 1;
    } catch (err) {
      logger.error(
        {
          err: (err as Error).message,
          kind,
          event: handler.event,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        },
        'handler failed'
      );
      throw err;
    }
  }

  return handled;
}

export async function ingestRange(
  fromBlock: number,
  toBlock: number,
  opts: { unconfirmed: boolean }
): Promise<{ eventCount: number }> {
  const from = BigInt(fromBlock);
  const to = BigInt(toBlock);
  const batcher = new Batcher();

  // Pass 1: static contracts
  const staticAddresses: Hex[] = [];
  for (const [, addr] of Object.entries(chainConfig.staticAddresses)) {
    if (addr) staticAddresses.push(addr);
  }
  const pass1 = await fetchAndDispatch(
    staticAddresses,
    (addr) => kindForStaticAddress(addr),
    from,
    to,
    opts.unconfirmed,
    batcher
  );

  // Flush pass 1 so dynamic queries after this see committed factoryChildren.
  await batcher.commit();

  // Pass 2: dynamic factory children (re-fetched after pass 1 so newly-spawned
  // addresses are included).
  const dynamic: Array<{ kind: ContractKind; addresses: Hex[] }> = [
    { kind: 'Universe', addresses: getChildren('universe') },
    { kind: 'UniverseGovernor', addresses: getChildren('governor') },
    { kind: 'GovernanceToken', addresses: getChildren('token') },
    { kind: 'BondingCurve', addresses: getChildren('bondingCurve') },
  ];

  let pass2 = 0;
  for (const group of dynamic) {
    if (group.addresses.length === 0) continue;
    pass2 += await fetchAndDispatch(
      group.addresses,
      () => group.kind,
      from,
      to,
      opts.unconfirmed,
      batcher
    );
  }
  await batcher.commit();

  return { eventCount: pass1 + pass2 };
}
