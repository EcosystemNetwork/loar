/**
 * Solana premium_actions SDK — wraps the `premium_actions` program (formerly
 * `loar_burner`, renamed 2026-05-16 as part of BURN-01; on-chain program ID,
 * PDA seeds, and IDL instruction/account names unchanged).
 *
 * This program collects $LOAR for premium actions (priority queue, permanent
 * canon, premium profile, remix boost, custom) and splits between LP +
 * treasury. **No supply destruction** — earlier "burner" framing was UX
 * naming from the EVM side.
 *
 * v1 surface: `executeAction(name)` — user pays an action's configured cost.
 *
 * Required env: `LOAR_BURNER_PROGRAM_ID` (env-var name retained for deploy-
 * config continuity) + Circle Solana DCW.
 */
import { createHash } from 'node:crypto';
import { PublicKey, type Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  buildExecuteBurnerActionIx,
  decodeBurnerActionAccount,
  decodeBurnerConfigAccount,
  deriveBurnerActionPda,
  deriveBurnerConfigPda,
  type DecodedBurnerAction,
  type DecodedBurnerConfig,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaPremiumActionsConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.LOAR_BURNER_PROGRAM_ID);
}

/**
 * H-6: allowlist of human-readable action labels accepted by the
 * `/premium-actions/execute` route. Matches the EVM `PremiumActions.BurnAction`
 * enum (apps/contracts/src/revenue/PremiumActions.sol) one-to-one so the
 * cross-chain action catalogue stays in sync.
 *
 * The route MUST reject any label not in this list — accepting an arbitrary
 * 128-char string lets an attacker (or a buggy MCP integration) execute
 * "actions" that don't exist on-chain (silent failure) or that DO exist but
 * were never meant to be user-callable.
 *
 * `CUSTOM` is intentionally NOT included: it's a privileged catch-all used by
 * admin paths only — surface it through a separate, scoped endpoint if needed.
 */
export const PREMIUM_ACTION_LABELS = [
  'PRIORITY_GENERATION',
  'PERMANENT_CANON',
  'PREMIUM_PROFILE',
  'REMIX_BOOST',
] as const;
export type PremiumActionLabel = (typeof PREMIUM_ACTION_LABELS)[number];

function burnerProgramId(): PublicKey {
  const id = process.env.LOAR_BURNER_PROGRAM_ID;
  if (!id) throw new Error('LOAR_BURNER_PROGRAM_ID is not set');
  return new PublicKey(id);
}

/**
 * Derive the canonical 32-byte action name from a human string. Matches the
 * EVM convention of using `keccak256` for action identifiers — here we use
 * `sha256` since Anchor/Solana doesn't ship keccak natively and the
 * server-controlled action set is the canonical source either way.
 *
 * Convention: `actionNameFromLabel("PRIORITY_GENERATION")` → 32-byte hash.
 * Admin sets the on-chain Action PDA using the same hash; client passes the
 * same hash on `execute_action`.
 */
export function actionNameFromLabel(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

async function resolveConfig(connection: Connection): Promise<DecodedBurnerConfig> {
  const programId = burnerProgramId();
  const [configPda] = deriveBurnerConfigPda(programId);
  const acct = await connection.getAccountInfo(configPda, 'confirmed');
  if (!acct) throw new Error('premium_actions not initialized');
  const decoded = decodeBurnerConfigAccount(Buffer.from(acct.data.subarray(8)));
  if (!decoded) throw new Error('failed to decode Burner Config');
  return decoded;
}

export interface ExecuteActionArgs {
  userUserId: string;
  /** Action name — either the 32-byte hash directly, or a label that we hash. */
  action: Buffer | string;
  tokenProgramId?: PublicKey;
}

export interface ExecuteActionResult {
  txId: string;
  signature?: string;
  costLamports: bigint;
  state: string;
}

export async function executeAction(args: ExecuteActionArgs): Promise<ExecuteActionResult> {
  if (!isSolanaPremiumActionsConfigured()) throw new Error('premium_actions not configured');
  const programId = burnerProgramId();
  const tokenProgramId = args.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;

  const name = typeof args.action === 'string' ? actionNameFromLabel(args.action) : args.action;
  if (name.length !== 32) throw new Error('action name must be 32 bytes');

  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.userUserId);
  if (!wallet?.address) throw new Error(`wallet ${args.userUserId} not found`);
  const user = new PublicKey(wallet.address);

  const conn = getSolanaConnection();
  const cfg = await resolveConfig(conn);
  // Pre-check action exists + active before spending compute.
  const action = await readAction(name);
  if (!action.exists || !action.action) throw new Error('action not configured');
  if (!action.action.active) throw new Error('action is inactive');

  const userLoarAta = getAssociatedTokenAddressSync(cfg.loarMint, user, false, tokenProgramId);
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

  const ix = buildExecuteBurnerActionIx({
    programId,
    user,
    loarMint: cfg.loarMint,
    tokenProgramId,
    userLoarAta,
    lpAta,
    treasuryAta,
    name,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 150_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    costLamports: action.action.cost,
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface ActionReadResult {
  pda: string;
  exists: boolean;
  action: DecodedBurnerAction | null;
}

export async function readAction(
  name: Buffer | string,
  connection?: Connection
): Promise<ActionReadResult> {
  const resolvedName = typeof name === 'string' ? actionNameFromLabel(name) : name;
  if (resolvedName.length !== 32) throw new Error('action name must be 32 bytes');
  const programId = burnerProgramId();
  const [pda] = deriveBurnerActionPda(programId, resolvedName);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) return { pda: pda.toBase58(), exists: false, action: null };
  return {
    pda: pda.toBase58(),
    exists: true,
    action: decodeBurnerActionAccount(Buffer.from(acct.data.subarray(8))),
  };
}

export async function readBurnerConfig(connection?: Connection): Promise<DecodedBurnerConfig> {
  return resolveConfig(connection ?? getSolanaConnection());
}
