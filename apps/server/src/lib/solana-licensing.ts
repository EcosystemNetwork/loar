/**
 * Solana licensing SDK — server-side wrapper around the `licensing` program.
 *
 * v1 surface: `buy_content` (the load-bearing user flow). Registration +
 * pricing updates happen via creator-side flows that aren't routed through
 * the server today, so they're not wrapped here yet — add when the
 * creator UI lands on Solana.
 *
 * Required env (in addition to standard Circle Solana config):
 *   LICENSING_PROGRAM_ID  — devnet/mainnet program ID
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  buildBuyContentIx,
  decodeRegistrationAccount,
  deriveRegistrationPda,
  deriveBuyerDealPda,
  type DecodedRegistration,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaLicensingConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.LICENSING_PROGRAM_ID);
}

function licensingProgramId(): PublicKey {
  const id = process.env.LICENSING_PROGRAM_ID;
  if (!id) throw new Error('LICENSING_PROGRAM_ID is not set');
  return new PublicKey(id);
}

// ── Write path ──────────────────────────────────────────────────────────────

export interface BuyContentArgs {
  /** LOAR user id of the buyer. Server resolves the Circle DCW Solana
   * wallet for this user and uses its pubkey as the `buyer` signer. */
  buyerUserId: string;
  contentHash: Buffer; // 32 bytes
}

export interface BuyContentResult {
  txId: string;
  signature?: string;
  buyerDealPda: string;
  state: string;
}

/**
 * Buy permanent access to content. Fetches the on-chain Registration to
 * resolve the seller's wallet (so the SOL transfer routes correctly) and
 * the price (for client-side balance checks / receipt UX).
 *
 * Throws if licensing isn't configured, or if the content isn't registered.
 */
export async function buyContent(args: BuyContentArgs): Promise<BuyContentResult> {
  if (!isSolanaLicensingConfigured()) {
    throw new Error(
      'Solana licensing is not configured — set LICENSING_PROGRAM_ID + Circle Solana DCW env'
    );
  }
  if (args.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');

  const programId = licensingProgramId();
  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.buyerUserId);
  if (!wallet?.address) {
    throw new Error(`buyer Solana wallet for user ${args.buyerUserId} not found`);
  }
  const buyer = new PublicKey(wallet.address);

  // Read Registration to get creator + active state.
  const reg = await readRegistration(args.contentHash);
  if (!reg.exists || !reg.registration) {
    throw new Error('content not registered on Solana licensing');
  }
  if (!reg.registration.active) {
    throw new Error('registration is inactive');
  }

  const ix = buildBuyContentIx({
    programId,
    buyer,
    creator: reg.registration.creator,
    contentHash: args.contentHash,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 80_000,
  });

  const [buyerDealPda] = deriveBuyerDealPda(programId, args.contentHash, buyer);
  return {
    txId: result.txId,
    signature: result.signature,
    buyerDealPda: buyerDealPda.toBase58(),
    state: result.state,
  };
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface RegistrationReadResult {
  pda: string;
  exists: boolean;
  registration: DecodedRegistration | null;
}

export async function readRegistration(
  contentHash: Buffer,
  connection?: Connection
): Promise<RegistrationReadResult> {
  if (contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  const programId = licensingProgramId();
  const [pda] = deriveRegistrationPda(programId, contentHash);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) {
    return { pda: pda.toBase58(), exists: false, registration: null };
  }
  const body = Buffer.from(acct.data.subarray(8));
  return {
    pda: pda.toBase58(),
    exists: true,
    registration: decodeRegistrationAccount(body),
  };
}

/**
 * Does `buyer` hold a BuyerDeal for `contentHash`? True after a successful
 * `buy_content` — the BuyerDeal PDA is created in that ix and lives forever.
 */
export async function hasContentAccess(
  contentHash: Buffer,
  buyer: PublicKey,
  connection?: Connection
): Promise<boolean> {
  const programId = licensingProgramId();
  const [pda] = deriveBuyerDealPda(programId, contentHash, buyer);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  return acct !== null;
}
