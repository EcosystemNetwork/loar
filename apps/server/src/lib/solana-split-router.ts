/**
 * Solana split_router SDK — wraps the `split_router` program (SOL v1).
 *
 * v1 surface: `routeWithSplits` + read Splits config. Setting splits is a
 * creator-side flow that runs through other server routes; not wrapped here.
 *
 * Required env: SPLIT_ROUTER_PROGRAM_ID + Circle Solana DCW.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  buildRouteWithSplitsIx,
  decodeSplitsAccount,
  deriveSplitsPda,
  deriveSplitRouterConfigPda,
  type DecodedSplits,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaSplitRouterConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.SPLIT_ROUTER_PROGRAM_ID);
}

function splitRouterProgramId(): PublicKey {
  const id = process.env.SPLIT_ROUTER_PROGRAM_ID;
  if (!id) throw new Error('SPLIT_ROUTER_PROGRAM_ID is not set');
  return new PublicKey(id);
}

async function resolveTreasury(connection: Connection): Promise<PublicKey> {
  const programId = splitRouterProgramId();
  const [configPda] = deriveSplitRouterConfigPda(programId);
  const acct = await connection.getAccountInfo(configPda, 'confirmed');
  if (!acct) throw new Error('split_router not initialized');
  // Config: admin(32) pending_admin(32) treasury(32) paused(1) bump(1)
  const body = acct.data.subarray(8);
  return new PublicKey(body.subarray(64, 96));
}

export interface RouteWithSplitsArgs {
  payerUserId: string;
  entityHash: Buffer;
  amountLamports: bigint;
  platformFeeBps: number;
}

export interface RouteWithSplitsResult {
  txId: string;
  signature?: string;
  splitsPda: string;
  state: string;
}

/**
 * Route `amountLamports` SOL through the entity's stored splits + the
 * platform fee. Resolves the recipient list from the on-chain `Splits` PDA
 * and the treasury from `Config`, so the caller doesn't need to mirror
 * either off-chain.
 */
export async function routeWithSplits(args: RouteWithSplitsArgs): Promise<RouteWithSplitsResult> {
  if (!isSolanaSplitRouterConfigured()) throw new Error('split_router not configured');
  if (args.entityHash.length !== 32) throw new Error('entityHash must be 32 bytes');
  if (args.platformFeeBps < 0 || args.platformFeeBps > 5000) {
    throw new Error('platformFeeBps must be in [0, 5000]');
  }
  const programId = splitRouterProgramId();

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.payerUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.payerUserId} not found`);
  const payer = new PublicKey(wallet.address);

  // Read Splits to get the recipient ordering — must match exactly for the
  // route_with_splits ix's remaining_accounts.
  const splits = await readSplits(args.entityHash);
  if (!splits.exists || !splits.splits) {
    throw new Error('no splits configured for this entityHash');
  }

  const conn = getSolanaConnection();
  const treasury = await resolveTreasury(conn);

  const ix = buildRouteWithSplitsIx({
    programId,
    payer,
    entityHash: args.entityHash,
    treasury,
    recipients: splits.splits.recipients,
    amountLamports: args.amountLamports,
    platformFeeBps: args.platformFeeBps,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    // Each recipient transfer + treasury transfer is a system_program CPI;
    // 200k handles up to 10 recipients comfortably.
    computeUnitLimit: 200_000,
  });

  const [splitsPda] = deriveSplitsPda(programId, args.entityHash);
  return {
    txId: result.txId,
    signature: result.signature,
    splitsPda: splitsPda.toBase58(),
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface SplitsReadResult {
  pda: string;
  exists: boolean;
  splits: DecodedSplits | null;
}

export async function readSplits(
  entityHash: Buffer,
  connection?: Connection
): Promise<SplitsReadResult> {
  if (entityHash.length !== 32) throw new Error('entityHash must be 32 bytes');
  const programId = splitRouterProgramId();
  const [pda] = deriveSplitsPda(programId, entityHash);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) return { pda: pda.toBase58(), exists: false, splits: null };
  return {
    pda: pda.toBase58(),
    exists: true,
    splits: decodeSplitsAccount(Buffer.from(acct.data.subarray(8))),
  };
}
