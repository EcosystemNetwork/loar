/**
 * Solana credit_manager SDK — wraps the `credit_manager` program.
 *
 * v1 user-facing surface: `purchaseWithSol`, `purchaseWithLoar`, read balance.
 * `spendCredits` + `grantCredits` are platform-only and run from server
 * routes directly (not wrapped here yet — add when those routes land).
 *
 * Required env: CREDIT_MANAGER_PROGRAM_ID + Circle Solana DCW.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  buildPurchaseWithLoarIx,
  buildPurchaseWithSolIx,
  decodeUserCreditsAccount,
  deriveCreditConfigPda,
  deriveCreditLoarVaultPda,
  deriveUserCreditsPda,
  type DecodedUserCredits,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaCreditManagerConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.CREDIT_MANAGER_PROGRAM_ID);
}

function creditProgramId(): PublicKey {
  const id = process.env.CREDIT_MANAGER_PROGRAM_ID;
  if (!id) throw new Error('CREDIT_MANAGER_PROGRAM_ID is not set');
  return new PublicKey(id);
}

async function resolveLoarMint(connection: Connection): Promise<PublicKey> {
  const programId = creditProgramId();
  const [configPda] = deriveCreditConfigPda(programId);
  const acct = await connection.getAccountInfo(configPda, 'confirmed');
  if (!acct) throw new Error('credit_manager is not initialized');
  // Config: admin(32) pending_admin(32) platform(32) pending_platform(32) loar_mint(32) ...
  const body = acct.data.subarray(8);
  return new PublicKey(body.subarray(128, 160));
}

export interface PurchaseWithSolArgs {
  buyerUserId: string;
  packageId: bigint;
}

export interface PurchaseResult {
  txId: string;
  signature?: string;
  userCreditsPda: string;
  state: string;
}

export async function purchaseWithSol(args: PurchaseWithSolArgs): Promise<PurchaseResult> {
  if (!isSolanaCreditManagerConfigured()) throw new Error('credit_manager not configured');
  const programId = creditProgramId();
  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.buyerUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.buyerUserId} not found`);
  const buyer = new PublicKey(wallet.address);

  const ix = buildPurchaseWithSolIx({ programId, buyer, packageId: args.packageId });
  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 80_000,
  });
  const [userCreditsPda] = deriveUserCreditsPda(programId, buyer);
  return {
    txId: result.txId,
    signature: result.signature,
    userCreditsPda: userCreditsPda.toBase58(),
    state: result.state,
  };
}

export interface PurchaseWithLoarArgs {
  buyerUserId: string;
  packageId: bigint;
  tokenProgramId?: PublicKey;
}

export async function purchaseWithLoar(args: PurchaseWithLoarArgs): Promise<PurchaseResult> {
  if (!isSolanaCreditManagerConfigured()) throw new Error('credit_manager not configured');
  const programId = creditProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.buyerUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.buyerUserId} not found`);
  const buyer = new PublicKey(wallet.address);

  const conn = getSolanaConnection();
  const loarMint = await resolveLoarMint(conn);
  const buyerLoarAta = getAssociatedTokenAddressSync(loarMint, buyer, false, tokenProgramId);
  const [loarVault] = deriveCreditLoarVaultPda(programId);
  const loarVaultAta = getAssociatedTokenAddressSync(loarMint, loarVault, true, tokenProgramId);

  const ix = buildPurchaseWithLoarIx({
    programId,
    buyer,
    packageId: args.packageId,
    loarMint,
    tokenProgramId,
    buyerLoarAta,
    loarVaultAta,
  });
  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 120_000,
  });
  const [userCreditsPda] = deriveUserCreditsPda(programId, buyer);
  return {
    txId: result.txId,
    signature: result.signature,
    userCreditsPda: userCreditsPda.toBase58(),
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface UserCreditsReadResult {
  pda: string;
  exists: boolean;
  credits: DecodedUserCredits | null;
}

export async function readUserCredits(
  user: PublicKey,
  connection?: Connection
): Promise<UserCreditsReadResult> {
  const programId = creditProgramId();
  const [pda] = deriveUserCreditsPda(programId, user);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) return { pda: pda.toBase58(), exists: false, credits: null };
  return {
    pda: pda.toBase58(),
    exists: true,
    credits: decodeUserCreditsAccount(Buffer.from(acct.data.subarray(8))),
  };
}
