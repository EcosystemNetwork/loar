/**
 * Impression batcher (A5) — flushes pending ad-impression counts on-chain.
 *
 * Off-chain `sponsorships.impressions` is incremented in real time by
 * `ads.recordImpression`. Pushing a tx for every impression is gas-prohibitive
 * for active campaigns, so this batcher accumulates deltas and emits one
 * AdPlacement.recordImpressionsBatch tx per run.
 *
 * Schema additions on `sponsorships`:
 *   - onChainImpressions: number — high-water mark of impressions already
 *     reflected on-chain. Initialized to 0.
 *   - onChainSponsorshipId: number — the uint256 the contract uses (set
 *     when the sponsorship's accept tx confirms; until then the row is
 *     skipped).
 *
 * Invocation: call `flushImpressionsOnce()` from a scheduler (Cloud
 * Scheduler / Railway cron / GitHub Actions). Stays a pure function so
 * it's testable; we deliberately do NOT auto-start a setInterval on
 * server boot to avoid double-flushing across replicas.
 */
import { db } from '../lib/firebase';
import { encodeFunctionData, getAddress, isAddress, type Abi, type Hex } from 'viem';
import { executeTransaction, getOrCreateWallet } from '../lib/circle-wallets';

const AD_PLACEMENT_ABI = [
  {
    type: 'function',
    name: 'recordImpressionsBatch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sponsorshipIds', type: 'uint256[]' },
      { name: 'counts', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/** Max sponsorships per tx — keeps calldata + gas under typical limits. */
const BATCH_SIZE = 50;

function adPlacementAddress(): Hex | null {
  const env = process.env.AD_PLACEMENT_ADDRESS;
  if (!env || !isAddress(env)) return null;
  return getAddress(env) as Hex;
}

function platformChainId(): number {
  return Number(process.env.PLATFORM_CHAIN_ID ?? '84532');
}

function platformWalletUid(): string {
  return process.env.PLATFORM_CIRCLE_WALLET_UID ?? 'platform-registry-caller';
}

export interface FlushResult {
  /** Number of sponsorships flushed in this run. */
  flushed: number;
  /** Sum of impressions newly mirrored on-chain. */
  totalImpressions: number;
  /** Tx hashes produced (one per batch). */
  txHashes: string[];
  /** Sponsorships skipped because their on-chain id wasn't ready yet. */
  pendingOnChainId: number;
  /** True when the registry env var isn't set (caller can no-op silently). */
  skipped?: boolean;
  reason?: string;
}

export async function flushImpressionsOnce(): Promise<FlushResult> {
  const addr = adPlacementAddress();
  if (!addr) {
    return {
      flushed: 0,
      totalImpressions: 0,
      txHashes: [],
      pendingOnChainId: 0,
      skipped: true,
      reason: 'AD_PLACEMENT_ADDRESS not configured',
    };
  }
  if (!db) {
    return {
      flushed: 0,
      totalImpressions: 0,
      txHashes: [],
      pendingOnChainId: 0,
      skipped: true,
      reason: 'Firebase not configured',
    };
  }

  // Pull active sponsorships that have impressions ahead of the on-chain mark.
  // We over-fetch a bit and filter in memory because Firestore can't compare
  // two doc fields in a single query.
  const snap = await db.collection('sponsorships').where('active', '==', true).limit(500).get();

  const pending: Array<{ id: string; onChainSlotId: number; delta: number; total: number }> = [];
  let pendingOnChainId = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as {
      onChainSponsorshipId?: number;
      impressions?: number;
      onChainImpressions?: number;
    };
    const offChain = data.impressions ?? 0;
    const onChain = data.onChainImpressions ?? 0;
    if (offChain <= onChain) continue;

    if (data.onChainSponsorshipId == null) {
      pendingOnChainId++;
      continue;
    }
    pending.push({
      id: doc.id,
      onChainSlotId: data.onChainSponsorshipId,
      delta: offChain - onChain,
      total: offChain,
    });
  }

  if (pending.length === 0) {
    return { flushed: 0, totalImpressions: 0, txHashes: [], pendingOnChainId };
  }

  const chainId = platformChainId();
  const wallet = await getOrCreateWallet(platformWalletUid(), chainId);
  const txHashes: string[] = [];
  let flushed = 0;
  let totalImpressions = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const sponsorshipIds = batch.map((p) => BigInt(p.onChainSlotId));
    const counts = batch.map((p) => BigInt(p.delta));

    const calldata = encodeFunctionData({
      abi: AD_PLACEMENT_ABI,
      functionName: 'recordImpressionsBatch',
      args: [sponsorshipIds, counts],
    }) as Hex;

    const result = await executeTransaction({
      walletId: wallet.walletId,
      contractAddress: addr,
      calldata,
      chainId,
    });

    if (!result.txHash) {
      console.error(
        '[impressionBatcher] tx returned no hash (state',
        result.state,
        ') — leaving batch unflushed for retry'
      );
      continue;
    }
    txHashes.push(result.txHash);

    // Commit per-batch — if a later batch fails, prior batches are still
    // reflected. Update the high-water mark to the value we just confirmed.
    const writeBatch = db.batch();
    for (const p of batch) {
      writeBatch.update(db.collection('sponsorships').doc(p.id), {
        onChainImpressions: p.total,
        lastImpressionFlushTxHash: result.txHash,
        lastImpressionFlushAt: new Date(),
      });
    }
    await writeBatch.commit();

    flushed += batch.length;
    totalImpressions += batch.reduce((sum, p) => sum + p.delta, 0);
  }

  return { flushed, totalImpressions, txHashes, pendingOnChainId };
}
