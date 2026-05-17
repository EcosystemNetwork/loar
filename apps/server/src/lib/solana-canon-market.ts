/**
 * Solana canon_market SDK — wraps the `canon_market` program.
 *
 * v1 surface: vote on submissions + read submission state. Submit /
 * finalize / claim flows are caller-driven and will be added when the
 * server-side voting UI lands.
 *
 * Required env: CANON_MARKET_PROGRAM_ID + Circle Solana DCW.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  buildCanonVoteIx,
  decodeCanonSubmissionAccount,
  deriveCanonConfigPda,
  deriveCanonSubmissionPda,
  deriveCanonVoteLockPda,
  deriveCanonVoteVaultPda,
  type DecodedCanonSubmission,
  type CanonSubmissionState,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaCanonMarketConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.CANON_MARKET_PROGRAM_ID);
}

function canonProgramId(): PublicKey {
  const id = process.env.CANON_MARKET_PROGRAM_ID;
  if (!id) throw new Error('CANON_MARKET_PROGRAM_ID is not set');
  return new PublicKey(id);
}

export interface VoteArgs {
  voterUserId: string;
  universe: PublicKey;
  contentHash: Buffer;
  support: boolean;
  amount: bigint;
  tokenProgramId?: PublicKey;
}

export interface VoteResult {
  txId: string;
  signature?: string;
  submission: string;
  voteLock: string;
  state: string;
}

export async function vote(args: VoteArgs): Promise<VoteResult> {
  if (!isSolanaCanonMarketConfigured()) throw new Error('canon_market not configured');
  if (args.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  const programId = canonProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.voterUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.voterUserId} not found`);
  const voter = new PublicKey(wallet.address);

  // Resolve submission + its token_mint by reading on-chain Submission.
  const [submissionPda] = deriveCanonSubmissionPda(programId, args.universe, args.contentHash);
  const conn = getSolanaConnection();
  const subAcct = await conn.getAccountInfo(submissionPda, 'confirmed');
  if (!subAcct) throw new Error('submission not found for (universe, contentHash)');
  const submission = decodeCanonSubmissionAccount(Buffer.from(subAcct.data.subarray(8)));
  if (!submission) throw new Error('submission decode failed');
  if (submission.state !== 'Active') {
    throw new Error(`submission is in terminal state: ${submission.state}`);
  }

  const tokenMint = submission.tokenMint;
  const [voteVaultAuth] = deriveCanonVoteVaultPda(programId, submissionPda);
  const voteVaultAta = getAssociatedTokenAddressSync(
    tokenMint,
    voteVaultAuth,
    true,
    tokenProgramId
  );
  const voterTokenAta = getAssociatedTokenAddressSync(tokenMint, voter, false, tokenProgramId);

  const ix = buildCanonVoteIx({
    programId,
    voter,
    submission: submissionPda,
    tokenMint,
    tokenProgramId,
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID,
    voterTokenAta,
    voteVaultAta,
    support: args.support,
    amount: args.amount,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 250_000,
  });

  const [voteLockPda] = deriveCanonVoteLockPda(programId, submissionPda, voter);
  return {
    txId: result.txId,
    signature: result.signature,
    submission: submissionPda.toBase58(),
    voteLock: voteLockPda.toBase58(),
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface SubmissionReadResult {
  pda: string;
  exists: boolean;
  submission: DecodedCanonSubmission | null;
  /** Convenience: 0..10000 of (votes_for + votes_against) vs quorum_threshold. */
  participationBps: number;
  /** Current submission state — null if PDA missing. */
  state: CanonSubmissionState | null;
}

export async function readSubmission(
  universe: PublicKey,
  contentHash: Buffer,
  connection?: Connection
): Promise<SubmissionReadResult> {
  if (contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  const programId = canonProgramId();
  const [pda] = deriveCanonSubmissionPda(programId, universe, contentHash);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) {
    return {
      pda: pda.toBase58(),
      exists: false,
      submission: null,
      participationBps: 0,
      state: null,
    };
  }
  const decoded = decodeCanonSubmissionAccount(Buffer.from(acct.data.subarray(8)));
  if (!decoded) {
    return {
      pda: pda.toBase58(),
      exists: true,
      submission: null,
      participationBps: 0,
      state: null,
    };
  }
  const total = decoded.votesFor + decoded.votesAgainst;
  const participationBps =
    decoded.quorumThreshold === 0n ? 0 : Number((total * 10_000n) / decoded.quorumThreshold);
  return {
    pda: pda.toBase58(),
    exists: true,
    submission: decoded,
    participationBps: Math.min(participationBps, 10_000),
    state: decoded.state,
  };
}

export function configPda(): PublicKey {
  const [pda] = deriveCanonConfigPda(canonProgramId());
  return pda;
}
