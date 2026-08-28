/**
 * Solana remix_fees SDK — wraps the `remix_fees` program.
 *
 * v1 surface: `chargeRemixFee` — the load-bearing flow that runs every time
 * someone remixes content. 3-way SPL split: creator / LP / treasury.
 *
 * Required env: REMIX_FEES_PROGRAM_ID + Circle Solana DCW.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  buildChargeRemixFeeIx,
  decodeRemixFeesConfigAccount,
  deriveRemixFeesConfigPda,
  deriveUniverseFeePda,
  type DecodedRemixFeesConfig,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaRemixFeesConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.REMIX_FEES_PROGRAM_ID);
}

function remixFeesProgramId(): PublicKey {
  const id = process.env.REMIX_FEES_PROGRAM_ID;
  if (!id) throw new Error('REMIX_FEES_PROGRAM_ID is not set');
  return new PublicKey(id);
}

async function resolveConfig(connection: Connection): Promise<DecodedRemixFeesConfig> {
  const programId = remixFeesProgramId();
  const [configPda] = deriveRemixFeesConfigPda(programId);
  const acct = await connection.getAccountInfo(configPda, 'confirmed');
  if (!acct) throw new Error('remix_fees not initialized');
  const decoded = decodeRemixFeesConfigAccount(Buffer.from(acct.data.subarray(8)));
  if (!decoded) throw new Error('failed to decode RemixFees Config');
  return decoded;
}

export interface ChargeRemixFeeArgs {
  remixerUserId: string;
  /** Universe PDA (the on-chain universe identifier). */
  universe: PublicKey;
  /** Original creator pubkey — from Universe.creator. */
  originalCreator: PublicKey;
  contentHash: Buffer; // 32 bytes
  tokenProgramId?: PublicKey;
}

export interface ChargeRemixFeeResult {
  txId: string;
  signature?: string;
  feeLamports: bigint;
  state: string;
}

export async function chargeRemixFee(args: ChargeRemixFeeArgs): Promise<ChargeRemixFeeResult> {
  if (!isSolanaRemixFeesConfigured()) throw new Error('remix_fees not configured');
  if (args.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  const programId = remixFeesProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.remixerUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.remixerUserId} not found`);
  const remixer = new PublicKey(wallet.address);

  const conn = getSolanaConnection();
  const cfg = await resolveConfig(conn);

  // ATAs for all 3 destinations + remixer source.
  const remixerAta = getAssociatedTokenAddressSync(cfg.loarMint, remixer, false, tokenProgramId);
  const creatorAta = getAssociatedTokenAddressSync(
    cfg.loarMint,
    args.originalCreator,
    false,
    tokenProgramId
  );
  const lpAta = getAssociatedTokenAddressSync(
    cfg.loarMint,
    cfg.liquidityPool,
    false,
    tokenProgramId
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    cfg.loarMint,
    cfg.treasury,
    false,
    tokenProgramId
  );

  const ix = buildChargeRemixFeeIx({
    programId,
    remixer,
    universeAccount: args.universe,
    universe: args.universe,
    loarMint: cfg.loarMint,
    tokenProgramId,
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID,
    remixerAta,
    originalCreator: args.originalCreator,
    creatorAta,
    lpAta,
    treasuryAta,
    contentHash: args.contentHash,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 250_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    feeLamports: cfg.defaultRemixFee, // best-effort hint; on-chain may use per-universe override
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function readRemixFeesConfig(
  connection?: Connection
): Promise<DecodedRemixFeesConfig> {
  return resolveConfig(connection ?? getSolanaConnection());
}

/** Returns the per-universe override (if set) or null when default applies. */
export async function readUniverseFee(
  universe: PublicKey,
  connection?: Connection
): Promise<{ custom: boolean; feeLamports: bigint | null }> {
  const programId = remixFeesProgramId();
  const [pda] = deriveUniverseFeePda(programId, universe);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) return { custom: false, feeLamports: null };
  const body = acct.data.subarray(8);
  // body: universe Pubkey(32) + fee u64(8) + custom_fee bool(1) + bump u8(1)
  if (body.length < 42) return { custom: false, feeLamports: null };
  const feeLamports = body.readBigUInt64LE(32);
  const custom = body.readUInt8(40) !== 0;
  return { custom, feeLamports: custom ? feeLamports : null };
}
