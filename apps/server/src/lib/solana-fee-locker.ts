/**
 * Solana fee_locker SDK — wraps the `fee_locker` program.
 *
 * v1 user-facing surface: `claim` (owner pulls their accrued fees for a
 * given mint). `store_fees` is depositor-only (server-internal flow,
 * called by other programs/services that mark fee accrual).
 *
 * Required env: FEE_LOCKER_PROGRAM_ID + Circle Solana DCW.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  buildFeeLockerClaimIx,
  decodeFeeBalanceAccount,
  deriveFeeBalancePda,
  deriveFeeVaultPda,
  type DecodedFeeBalance,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaFeeLockerConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.FEE_LOCKER_PROGRAM_ID);
}

function feeLockerProgramId(): PublicKey {
  const id = process.env.FEE_LOCKER_PROGRAM_ID;
  if (!id) throw new Error('FEE_LOCKER_PROGRAM_ID is not set');
  return new PublicKey(id);
}

export interface ClaimFeesArgs {
  feeOwnerUserId: string;
  mint: PublicKey;
  tokenProgramId?: PublicKey;
}

export interface ClaimFeesResult {
  txId: string;
  signature?: string;
  feeBalancePda: string;
  state: string;
}

export async function claimFees(args: ClaimFeesArgs): Promise<ClaimFeesResult> {
  if (!isSolanaFeeLockerConfigured()) throw new Error('fee_locker not configured');
  const programId = feeLockerProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.feeOwnerUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.feeOwnerUserId} not found`);
  const feeOwner = new PublicKey(wallet.address);

  const [vaultAuth] = deriveFeeVaultPda(programId, args.mint);
  const vaultAta = getAssociatedTokenAddressSync(args.mint, vaultAuth, true, tokenProgramId);
  const feeOwnerAta = getAssociatedTokenAddressSync(args.mint, feeOwner, false, tokenProgramId);

  const ix = buildFeeLockerClaimIx({
    programId,
    feeOwner,
    mint: args.mint,
    tokenProgramId,
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID,
    vaultAta,
    feeOwnerAta,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 150_000,
  });

  const [feeBalancePda] = deriveFeeBalancePda(programId, feeOwner, args.mint);
  return {
    txId: result.txId,
    signature: result.signature,
    feeBalancePda: feeBalancePda.toBase58(),
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface FeeBalanceReadResult {
  pda: string;
  exists: boolean;
  balance: DecodedFeeBalance | null;
}

export async function readFeeBalance(
  feeOwner: PublicKey,
  mint: PublicKey,
  connection?: Connection
): Promise<FeeBalanceReadResult> {
  const programId = feeLockerProgramId();
  const [pda] = deriveFeeBalancePda(programId, feeOwner, mint);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) return { pda: pda.toBase58(), exists: false, balance: null };
  return {
    pda: pda.toBase58(),
    exists: true,
    balance: decodeFeeBalanceAccount(Buffer.from(acct.data.subarray(8))),
  };
}
