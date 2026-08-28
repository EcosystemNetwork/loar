/**
 * EVM → Solana rights sync.
 *
 * Reads the canonical RightsRegistry state on EVM for a given content hash
 * and pushes a signed attestation to the Solana `rights` program. EVM is
 * authoritative; this service makes the Solana cache match.
 *
 * Two entry points:
 *   - `syncRightsHashToSolana(contentHash, chainId)` — pulls current EVM
 *     state and pushes once. Used as a post-step after any EVM tx that
 *     mutates rights (`setRights`, `setRightsWithCreatorSig`, freeze, etc).
 *   - `bulkSyncRightsHashes(contentHashes, chainId)` — same, batched.
 *
 * Failures are non-fatal: if the Solana push fails (operator wallet not
 * funded, RPC blip), the next sync attempt overwrites. The version scheme
 * (EVM block_number << 16 | log_index, or fallback `Date.now()`) makes
 * retries idempotent — late-arriving stale events are rejected by the
 * Solana program's `VersionNotMonotonic` check.
 */
import { type Address, type Hex, hexToBytes } from 'viem';
import { rightsRegistryAbi } from '@loar/abis/generated';
import { PublicKey } from '@solana/web3.js';
import { getChainClient } from '../lib/chain-client';
import { getOnChainEnv, type RightsTypeValue } from './likeness-onchain';
import {
  isSolanaRightsConfigured,
  pushRightsAttestation,
  type PushRightsAttestationResult,
} from '../lib/solana-rights';
import type { SolanaRightsType } from '../lib/anchor-ix';

const EVM_TO_SOLANA_RIGHTS: Record<RightsTypeValue, SolanaRightsType> = {
  0: 'Unset',
  1: 'Fun',
  2: 'Original',
  3: 'Licensed',
  4: 'PublicDomain',
  5: 'Frozen',
};

export interface RightsSyncResult {
  contentHash: Hex;
  chainId: number;
  evmRightsType: RightsTypeValue;
  solanaRightsType: SolanaRightsType;
  evmCreator: Address;
  /** `null` when the Solana bridge is not configured (sync skipped, not failed). */
  push: PushRightsAttestationResult | null;
  skipped: boolean;
  /** Populated when `skipped` is true. */
  reason?: string;
}

/**
 * Pick a version number for a Solana attestation. The Solana program enforces
 * strict monotonicity per content_hash, so we just need any monotonic source.
 *
 * Caller-supplied (preferred): `evmBlock << 16 | evmLogIndex` — captures the
 * exact EVM event ordering, so re-syncing the same event idempotent-passes.
 *
 * Fallback: `Date.now()` in milliseconds. Coarser than block ordering but
 * adequate when the caller doesn't know the originating log.
 */
export function pickVersion(opts?: { evmBlock?: bigint; evmLogIndex?: number }): bigint {
  if (opts?.evmBlock !== undefined && opts.evmLogIndex !== undefined) {
    // 16 bits of log_index headroom (max 65535 logs per block) is fine; mainnet
    // blocks rarely exceed a few hundred logs.
    return (opts.evmBlock << 16n) | BigInt(opts.evmLogIndex);
  }
  return BigInt(Date.now());
}

/**
 * Pull the EVM RightsRegistry state for `contentHash` and mirror it to
 * Solana. Returns `skipped: true` (not an error) if either the EVM or
 * Solana side isn't configured — callers can still log the attempt without
 * branching.
 */
export async function syncRightsHashToSolana(opts: {
  contentHash: Hex;
  chainId: number;
  /** Optional context for version selection — preferred when available. */
  evmBlock?: bigint;
  evmLogIndex?: number;
  /** Optional tx hash from the originating EVM event for forensics. */
  evmTxHash?: Hex;
  /** Optional Solana creator pubkey if the server knows it. */
  solanaCreator?: PublicKey;
}): Promise<RightsSyncResult> {
  const env = getOnChainEnv(opts.chainId);
  if (!env) {
    return {
      contentHash: opts.contentHash,
      chainId: opts.chainId,
      evmRightsType: 0,
      solanaRightsType: 'Unset',
      evmCreator: '0x0000000000000000000000000000000000000000',
      push: null,
      skipped: true,
      reason: `EVM RightsRegistry not configured for chain ${opts.chainId}`,
    };
  }
  if (!isSolanaRightsConfigured()) {
    return {
      contentHash: opts.contentHash,
      chainId: opts.chainId,
      evmRightsType: 0,
      solanaRightsType: 'Unset',
      evmCreator: '0x0000000000000000000000000000000000000000',
      push: null,
      skipped: true,
      reason:
        'Solana rights bridge not configured (RIGHTS_PROGRAM_ID + CIRCLE_RIGHTS_OPERATOR_WALLET_ID required)',
    };
  }

  const client = getChainClient(opts.chainId);

  // Pull EVM canonical state. `rights` + `contentCreator` are public getters
  // on RightsRegistry.sol so two reads suffice.
  const [evmRightsType, evmCreator] = (await Promise.all([
    client.readContract({
      address: env.rightsRegistry,
      abi: rightsRegistryAbi,
      functionName: 'rights',
      args: [opts.contentHash],
    }),
    client.readContract({
      address: env.rightsRegistry,
      abi: rightsRegistryAbi,
      functionName: 'contentCreator',
      args: [opts.contentHash],
    }),
  ])) as [number, Address];

  const solanaRightsType = EVM_TO_SOLANA_RIGHTS[evmRightsType as RightsTypeValue];
  if (!solanaRightsType) {
    throw new Error(`Unknown EVM RightsType variant: ${evmRightsType}`);
  }

  const version = pickVersion({ evmBlock: opts.evmBlock, evmLogIndex: opts.evmLogIndex });

  const push = await pushRightsAttestation({
    contentHash: Buffer.from(hexToBytes(opts.contentHash)),
    rightsType: solanaRightsType,
    creator: opts.solanaCreator ?? PublicKey.default,
    evmCreator: Buffer.from(hexToBytes(evmCreator as `0x${string}`)),
    version,
    evmTxHash: opts.evmTxHash ? Buffer.from(hexToBytes(opts.evmTxHash)) : Buffer.alloc(32, 0),
    evmBlockNumber: opts.evmBlock ?? 0n,
  });

  return {
    contentHash: opts.contentHash,
    chainId: opts.chainId,
    evmRightsType: evmRightsType as RightsTypeValue,
    solanaRightsType,
    evmCreator,
    push,
    skipped: false,
  };
}

/**
 * Batched version of `syncRightsHashToSolana`. Concurrency is bounded to 4
 * so we don't flood the Circle KMS queue when syncing a backlog.
 */
export async function bulkSyncRightsHashes(opts: {
  contentHashes: Hex[];
  chainId: number;
}): Promise<RightsSyncResult[]> {
  const out: RightsSyncResult[] = [];
  const concurrency = 4;
  for (let i = 0; i < opts.contentHashes.length; i += concurrency) {
    const slice = opts.contentHashes.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      slice.map((contentHash) => syncRightsHashToSolana({ contentHash, chainId: opts.chainId }))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        out.push(r.value);
      } else {
        out.push({
          contentHash: slice[j],
          chainId: opts.chainId,
          evmRightsType: 0,
          solanaRightsType: 'Unset',
          evmCreator: '0x0000000000000000000000000000000000000000',
          push: null,
          skipped: true,
          reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }
  return out;
}
