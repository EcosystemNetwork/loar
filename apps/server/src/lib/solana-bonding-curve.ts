/**
 * Solana bonding curve SDK — server-side wrapper around the `bonding_curve`
 * program.
 *
 * v1 surface:
 * - `buyTokens` — user pays SOL → universe tokens
 * - `sellTokens` — user returns tokens → SOL (1% fee retained in curve)
 * - read curve state for price/progress UI
 *
 * Curve initialization is per-universe creator flow that should run via
 * `apps/programs/scripts/` or the universe-launch UI; not wrapped here.
 *
 * Required env:
 *   BONDING_CURVE_PROGRAM_ID — devnet/mainnet program ID
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  buildCurveBuyIx,
  buildCurveSellIx,
  decodeCurveAccount,
  deriveCurvePda,
  deriveCurveTokenVaultPda,
  type DecodedCurve,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaBondingCurveConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.BONDING_CURVE_PROGRAM_ID);
}

function bondingCurveProgramId(): PublicKey {
  const id = process.env.BONDING_CURVE_PROGRAM_ID;
  if (!id) throw new Error('BONDING_CURVE_PROGRAM_ID is not set');
  return new PublicKey(id);
}

// ── Write path: buy ─────────────────────────────────────────────────────────

export interface BuyTokensArgs {
  /** Circle DCW wallet id of the buyer. */
  buyerUserId: string;
  /** Universe PDA — bonding curve is per-universe. */
  universe: PublicKey;
  /** Max SOL the buyer is willing to spend (in lamports). */
  solInMaxLamports: bigint;
  /** Min universe tokens the buyer accepts (slippage floor). */
  minTokensOut: bigint;
  /** Tx deadline in unix seconds. Defaults to now + 120s if omitted. */
  deadlineSecs?: bigint;
  /** Token program — defaults to Token-2022 since universe tokens are
   * Token-2022 mints by convention on Solana. */
  tokenProgramId?: PublicKey;
}

export interface BuyTokensResult {
  txId: string;
  signature?: string;
  buyerAta: string;
  state: string;
}

export async function buyTokens(args: BuyTokensArgs): Promise<BuyTokensResult> {
  if (!isSolanaBondingCurveConfigured()) {
    throw new Error('Solana bonding curve is not configured — set BONDING_CURVE_PROGRAM_ID');
  }

  const programId = bondingCurveProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.buyerUserId);
  if (!wallet?.address) {
    throw new Error(`buyer Solana wallet ${args.buyerUserId} not found`);
  }
  const buyer = new PublicKey(wallet.address);

  // Resolve curve state to get the universe token mint.
  const curve = await readCurve(args.universe);
  if (!curve.exists || !curve.curve) {
    throw new Error('curve not initialized for this universe');
  }
  if (curve.curve.graduated) throw new Error('curve has graduated; trading closed');
  if (curve.curve.tradingHalted) throw new Error('trading is halted');

  const tokenMint = curve.curve.tokenMint;
  const buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer, false, tokenProgramId);
  const [tokenVaultAuth] = deriveCurveTokenVaultPda(programId, args.universe);
  const tokenVaultAta = getAssociatedTokenAddressSync(
    tokenMint,
    tokenVaultAuth,
    true,
    tokenProgramId
  );

  const deadlineSecs = args.deadlineSecs ?? BigInt(Math.floor(Date.now() / 1000) + 120);

  const ix = buildCurveBuyIx({
    programId,
    buyer,
    universe: args.universe,
    tokenMint,
    tokenProgramId,
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID,
    buyerTokenAta: buyerAta,
    tokenVaultAta,
    solInMax: args.solInMaxLamports,
    minTokensOut: args.minTokensOut,
    deadline: deadlineSecs,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    // sqrt + multiple SPL transfers + ATA init — give it headroom.
    computeUnitLimit: 300_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    buyerAta: buyerAta.toBase58(),
    state: result.state,
  };
}

// ── Write path: sell ────────────────────────────────────────────────────────

export interface SellTokensArgs {
  sellerUserId: string;
  universe: PublicKey;
  /** Universe-token amount to sell. */
  tokenAmount: bigint;
  /** Slippage floor — minimum SOL out (in lamports) the seller accepts. */
  minSolOutLamports: bigint;
  deadlineSecs?: bigint;
  tokenProgramId?: PublicKey;
}

export interface SellTokensResult {
  txId: string;
  signature?: string;
  state: string;
}

export async function sellTokens(args: SellTokensArgs): Promise<SellTokensResult> {
  if (!isSolanaBondingCurveConfigured()) {
    throw new Error('Solana bonding curve is not configured');
  }

  const programId = bondingCurveProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.sellerUserId);
  if (!wallet?.address) {
    throw new Error(`seller Solana wallet ${args.sellerUserId} not found`);
  }
  const seller = new PublicKey(wallet.address);

  const curve = await readCurve(args.universe);
  if (!curve.exists || !curve.curve) {
    throw new Error('curve not initialized for this universe');
  }
  if (curve.curve.graduated) throw new Error('curve has graduated; trading closed');
  if (curve.curve.tradingHalted) throw new Error('trading is halted');

  const tokenMint = curve.curve.tokenMint;
  const sellerAta = getAssociatedTokenAddressSync(tokenMint, seller, false, tokenProgramId);
  const [tokenVaultAuth] = deriveCurveTokenVaultPda(programId, args.universe);
  const tokenVaultAta = getAssociatedTokenAddressSync(
    tokenMint,
    tokenVaultAuth,
    true,
    tokenProgramId
  );

  const deadlineSecs = args.deadlineSecs ?? BigInt(Math.floor(Date.now() / 1000) + 120);

  const ix = buildCurveSellIx({
    programId,
    seller,
    universe: args.universe,
    tokenMint,
    tokenProgramId,
    sellerTokenAta: sellerAta,
    tokenVaultAta,
    tokenAmount: args.tokenAmount,
    minSolOut: args.minSolOutLamports,
    deadline: deadlineSecs,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 200_000,
  });

  return { txId: result.txId, signature: result.signature, state: result.state };
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface CurveReadResult {
  pda: string;
  exists: boolean;
  curve: DecodedCurve | null;
  /** Progress toward graduation in basis points (0..10000). */
  progressBps: number;
}

export async function readCurve(
  universe: PublicKey,
  connection?: Connection
): Promise<CurveReadResult> {
  const programId = bondingCurveProgramId();
  const [pda] = deriveCurvePda(programId, universe);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) {
    return { pda: pda.toBase58(), exists: false, curve: null, progressBps: 0 };
  }
  const body = Buffer.from(acct.data.subarray(8));
  const decoded = decodeCurveAccount(body);
  if (!decoded) {
    return { pda: pda.toBase58(), exists: true, curve: null, progressBps: 0 };
  }
  const progressBps =
    decoded.graduationLamports === 0n
      ? 0
      : Number((decoded.solRaised * 10_000n) / decoded.graduationLamports);
  return {
    pda: pda.toBase58(),
    exists: true,
    curve: decoded,
    progressBps: Math.min(progressBps, 10_000),
  };
}
