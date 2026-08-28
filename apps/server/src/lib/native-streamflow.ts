/**
 * Streamflow adapter — wraps `@streamflow/stream` for vesting + LP locks.
 *
 * Use cases:
 *   - Team / creator token vesting (linear with optional cliff)
 *   - Bonding-curve LP locks post-graduation
 *
 * Real SDK path: `SolanaStreamClient` class. We use the `prepare*Instructions`
 * methods so we can hand the instructions to `executeSolanaTransaction`
 * (Circle DCW) for signing — bypassing the SDK's keypair-only signing path.
 *
 * Required env:
 *   STREAMFLOW_PROGRAM_ID — optional override (defaults from native-registry)
 */
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { sendNativeTx, resolveUserSolanaWallet } from './native-base';
import { activeCluster, getSolanaConnection, isCircleSolanaConfigured } from './circle-solana';

export function isStreamflowConfigured(): boolean {
  return isCircleSolanaConfigured();
}

// ── SDK shim types ─────────────────────────────────────────────────────────

interface StreamflowSdk {
  SolanaStreamClient: new (opts: {
    clusterUrl: string;
    cluster: 'devnet' | 'mainnet-beta' | 'testnet';
    commitment?: string;
  }) => SolanaStreamClientApi;
}

interface SolanaStreamClientApi {
  prepareCreateInstructions(
    args: PrepareCreateArgs
  ): Promise<{ ixs: TransactionInstruction[]; metadata: PublicKey }>;
  prepareWithdrawInstructions(
    args: PrepareWithdrawArgs
  ): Promise<{ ixs: TransactionInstruction[] }>;
  prepareCancelInstructions(args: PrepareCancelArgs): Promise<{ ixs: TransactionInstruction[] }>;
  getOne(args: { id: string }): Promise<StreamflowRecord | null>;
}

interface PrepareCreateArgs {
  sender: PublicKey;
  recipient: string;
  mint: string;
  start: number;
  depositedAmount: bigint;
  period: number;
  amountPerPeriod: bigint;
  cliff: number;
  cliffAmount: bigint;
  cancelableBySender: boolean;
  cancelableByRecipient: boolean;
  transferableBySender: boolean;
  transferableByRecipient: boolean;
  automaticWithdrawal: boolean;
  withdrawalFrequency: number;
  canTopup: boolean;
  name: string;
}

interface PrepareWithdrawArgs {
  invoker: PublicKey;
  id: string;
  amount: bigint;
}

interface PrepareCancelArgs {
  invoker: PublicKey;
  id: string;
}

interface StreamflowRecord {
  recipient: string;
  mint: string;
  depositedAmount: bigint;
  withdrawnAmount: bigint;
  start: number;
  end: number;
  cliff: number;
  closed: boolean;
}

let _client: SolanaStreamClientApi | null = null;
async function getClient(): Promise<SolanaStreamClientApi> {
  if (_client) return _client;
  try {
    const sdk = (await import('@streamflow/stream' as never)) as unknown as StreamflowSdk;
    const conn = getSolanaConnection();
    _client = new sdk.SolanaStreamClient({
      clusterUrl: conn.rpcEndpoint,
      cluster: activeCluster() as 'devnet' | 'mainnet-beta' | 'testnet',
      commitment: 'confirmed',
    });
    return _client;
  } catch (e) {
    throw new Error(
      `Streamflow SDK load failed. Ensure \`@streamflow/stream\` is installed in apps/server. (${
        e instanceof Error ? e.message : String(e)
      })`
    );
  }
}

// ── Create vesting stream ──────────────────────────────────────────────────

export interface CreateStreamArgs {
  payerUserId: string;
  recipient: PublicKey;
  mint: PublicKey;
  /** Total amount over the full duration (raw token units). */
  totalAmount: bigint;
  /** Cliff in seconds before any tokens unlock. 0 for no cliff. */
  cliffSecs: number;
  /** Total stream duration including cliff (seconds). */
  durationSecs: number;
  /** Whether the payer can cancel and reclaim unvested funds. Default true. */
  cancelableBySender?: boolean;
  /** Optional stream name (max 64 bytes per Streamflow). */
  name?: string;
}

export interface CreateStreamResult {
  txId: string;
  signature?: string;
  streamId: string;
  state: string;
}

export async function createStream(args: CreateStreamArgs): Promise<CreateStreamResult> {
  if (!isStreamflowConfigured()) throw new Error('streamflow not configured');
  const wallet = await resolveUserSolanaWallet(args.payerUserId);
  const client = await getClient();

  const now = Math.floor(Date.now() / 1000);
  const period = 1; // 1-second granularity for linear vest
  const releasable = BigInt(Math.max(1, args.durationSecs / period));

  // M4: ensure the requested vest is large enough to allocate at least 1 raw
  // token unit per period. Without this, `totalAmount / releasable` truncates
  // to 0 and the recipient receives nothing.
  if (args.totalAmount < releasable) {
    throw new Error(
      `createStream: totalAmount (${args.totalAmount}) must be >= number of release periods (${releasable})`
    );
  }

  const amountPerPeriod = args.totalAmount / releasable;
  // M4: integer-division remainder. Without absorbing it, the recipient is
  // permanently shorted by up to `releasable - 1` raw units (the bonding-curve
  // LP lock case where releasable is on the order of 1e8 can lose a meaningful
  // dust amount across the LP). Roll the remainder into the cliff payout so
  // the totals reconcile against `depositedAmount`.
  const remainder = args.totalAmount - amountPerPeriod * releasable;
  const cliffAmount = remainder > 0n ? remainder : 0n;

  const { ixs, metadata } = await client.prepareCreateInstructions({
    sender: wallet.pubkey,
    recipient: args.recipient.toBase58(),
    mint: args.mint.toBase58(),
    start: now + (args.cliffSecs > 0 ? 0 : 30),
    depositedAmount: args.totalAmount,
    period,
    amountPerPeriod,
    cliff: now + args.cliffSecs,
    cliffAmount,
    cancelableBySender: args.cancelableBySender ?? true,
    cancelableByRecipient: false,
    transferableBySender: false,
    transferableByRecipient: false,
    automaticWithdrawal: false,
    withdrawalFrequency: 0,
    canTopup: false,
    name: (args.name ?? 'LOAR vesting').slice(0, 64),
  });

  const result = await sendNativeTx({
    userId: args.payerUserId,
    instructions: ixs,
    computeUnitLimit: 400_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    streamId: metadata.toBase58(),
    state: result.state,
  };
}

// ── Withdraw ────────────────────────────────────────────────────────────────

export async function withdrawVested(args: {
  recipientUserId: string;
  streamId: string;
  /** Amount to withdraw, or 0n for "all available". */
  amount?: bigint;
}): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isStreamflowConfigured()) throw new Error('streamflow not configured');
  const wallet = await resolveUserSolanaWallet(args.recipientUserId);
  const client = await getClient();
  const { ixs } = await client.prepareWithdrawInstructions({
    invoker: wallet.pubkey,
    id: args.streamId,
    amount: args.amount ?? 0n,
  });
  return sendNativeTx({
    userId: args.recipientUserId,
    instructions: ixs,
    computeUnitLimit: 200_000,
  });
}

// ── Cancel (sender only, returns unvested to sender) ────────────────────────

export async function cancelStream(args: {
  payerUserId: string;
  streamId: string;
}): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isStreamflowConfigured()) throw new Error('streamflow not configured');
  const wallet = await resolveUserSolanaWallet(args.payerUserId);
  const client = await getClient();
  const { ixs } = await client.prepareCancelInstructions({
    invoker: wallet.pubkey,
    id: args.streamId,
  });
  return sendNativeTx({
    userId: args.payerUserId,
    instructions: ixs,
    computeUnitLimit: 200_000,
  });
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface DecodedStream {
  streamId: string;
  recipient: string;
  mint: string;
  totalAmount: bigint;
  withdrawnAmount: bigint;
  startedAt: number;
  endsAt: number;
  cliffAt: number;
  closed: boolean;
  /** Convenience: amount available to withdraw right now. */
  claimableNow: bigint;
}

export async function readStream(streamId: string): Promise<DecodedStream | null> {
  const client = await getClient();
  const rec = await client.getOne({ id: streamId });
  if (!rec) return null;
  const now = Math.floor(Date.now() / 1000);
  // Linear-vest available = (min(now, end) - start) / (end - start) * total - withdrawn
  const span = Math.max(1, rec.end - rec.start);
  const elapsed = Math.max(0, Math.min(now, rec.end) - rec.start);
  const vested = (rec.depositedAmount * BigInt(elapsed)) / BigInt(span);
  const claimableNow = vested > rec.withdrawnAmount ? vested - rec.withdrawnAmount : 0n;
  return {
    streamId,
    recipient: rec.recipient,
    mint: rec.mint,
    totalAmount: rec.depositedAmount,
    withdrawnAmount: rec.withdrawnAmount,
    startedAt: rec.start,
    endsAt: rec.end,
    cliffAt: rec.cliff,
    closed: rec.closed,
    claimableNow,
  };
}
