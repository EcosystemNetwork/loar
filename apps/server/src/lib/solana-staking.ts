/**
 * Solana staking SDK — wraps the `staking` program (LaunchpadStaking v1).
 *
 * v1 surface: global stake / unstake. Per-universe variants follow the same
 * shape; add when the launchpad flow lands on Solana.
 *
 * Required env: STAKING_PROGRAM_ID + Circle Solana DCW.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  buildStakeIx,
  buildUnstakeIx,
  decodeStakeInfoAccount,
  deriveStakeInfoPda,
  deriveStakingConfigPda,
  deriveStakingGlobalVaultPda,
  type DecodedStakeInfo,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaStakingConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.STAKING_PROGRAM_ID);
}

function stakingProgramId(): PublicKey {
  const id = process.env.STAKING_PROGRAM_ID;
  if (!id) throw new Error('STAKING_PROGRAM_ID is not set');
  return new PublicKey(id);
}

async function resolveLoarMint(connection: Connection): Promise<PublicKey> {
  // Read Config.loar_mint from chain so we don't drift from program state.
  const programId = stakingProgramId();
  const [configPda] = deriveStakingConfigPda(programId);
  const acct = await connection.getAccountInfo(configPda, 'confirmed');
  if (!acct) throw new Error('staking program is not initialized');
  // Config layout: admin(32) pending_admin(32) loar_mint(32) ...; skip 8-byte disc.
  const body = acct.data.subarray(8);
  return new PublicKey(body.subarray(64, 96));
}

export interface StakeArgs {
  userUserId: string;
  amount: bigint; // in raw token units (Token-2022 decimals applied client-side)
  tokenProgramId?: PublicKey;
}

export interface StakeResult {
  txId: string;
  signature?: string;
  state: string;
}

export async function stake(args: StakeArgs): Promise<StakeResult> {
  if (!isSolanaStakingConfigured()) throw new Error('staking not configured');
  const programId = stakingProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.userUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.userUserId} not found`);
  const user = new PublicKey(wallet.address);

  const conn = getSolanaConnection();
  const loarMint = await resolveLoarMint(conn);
  const userLoarAta = getAssociatedTokenAddressSync(loarMint, user, false, tokenProgramId);
  const [globalVault] = deriveStakingGlobalVaultPda(programId);
  const globalVaultAta = getAssociatedTokenAddressSync(loarMint, globalVault, true, tokenProgramId);

  const ix = buildStakeIx({
    programId,
    user,
    loarMint,
    tokenProgramId,
    userLoarAta,
    globalVaultAta,
    amount: args.amount,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 150_000,
  });
  return { txId: result.txId, signature: result.signature, state: result.state };
}

export interface UnstakeArgs extends StakeArgs {
  /** Penalty destination: ATA owned by the configured LP wallet. Caller resolves. */
  penaltyDestinationAta: PublicKey;
}

export async function unstake(args: UnstakeArgs): Promise<StakeResult> {
  if (!isSolanaStakingConfigured()) throw new Error('staking not configured');
  const programId = stakingProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.userUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.userUserId} not found`);
  const user = new PublicKey(wallet.address);

  const conn = getSolanaConnection();
  const loarMint = await resolveLoarMint(conn);
  const userLoarAta = getAssociatedTokenAddressSync(loarMint, user, false, tokenProgramId);
  const [globalVault] = deriveStakingGlobalVaultPda(programId);
  const globalVaultAta = getAssociatedTokenAddressSync(loarMint, globalVault, true, tokenProgramId);

  const ix = buildUnstakeIx({
    programId,
    user,
    loarMint,
    tokenProgramId,
    userLoarAta,
    globalVaultAta,
    amount: args.amount,
    penaltyDestinationAta: args.penaltyDestinationAta,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 150_000,
  });
  return { txId: result.txId, signature: result.signature, state: result.state };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface StakeInfoReadResult {
  pda: string;
  exists: boolean;
  stakeInfo: DecodedStakeInfo | null;
}

export async function readStakeInfo(
  user: PublicKey,
  connection?: Connection
): Promise<StakeInfoReadResult> {
  const programId = stakingProgramId();
  const [pda] = deriveStakeInfoPda(programId, user);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) return { pda: pda.toBase58(), exists: false, stakeInfo: null };
  return {
    pda: pda.toBase58(),
    exists: true,
    stakeInfo: decodeStakeInfoAccount(Buffer.from(acct.data.subarray(8))),
  };
}
