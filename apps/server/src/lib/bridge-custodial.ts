/**
 * Custodial $LOAR bridge — server-mediated lock-and-mint between Solana and
 * EVM testnet chains.
 *
 * Trust model: LOAR custody on the source side, mint authority on the
 * destination side. The server holds both (Circle DCW wallet on each chain).
 * Suitable for testnet + closed beta; production path is Wormhole NTT, which
 * removes the trust requirement at the cost of a multi-day on-chain setup.
 *
 * Flow per direction:
 *
 *   Solana → EVM
 *     1. Caller submits { amount, recipient: 0xEVM }.
 *     2. Server signs SPL transfer from caller's Circle DCW Solana wallet →
 *        SOL_BRIDGE_VAULT (a server-controlled SPL token account).
 *     3. Once confirmed, server calls $LOAR.mint(recipient, amount) on EVM
 *        via Circle DCW EVM.
 *     4. Both tx hashes + a bridge-transfer record are persisted.
 *
 *   EVM → Solana
 *     1. Caller submits { amount, recipient: SolanaBase58 }.
 *     2. Server signs $LOAR.transfer(EVM_BRIDGE_VAULT, amount) from caller's
 *        Circle DCW EVM wallet.
 *     3. Once confirmed, server signs SPL mint-to to recipient's ATA via
 *        Circle DCW Solana.
 *
 * Failure-handling: if step 2 lands but step 3 fails, the bridge intent
 * stays in `pending_destination` and an operator can retry the destination
 * leg via /api/bridge/retry/:id. The vault holds the deposited funds so
 * users can be made whole regardless.
 *
 * Required env:
 *   SOL_BRIDGE_VAULT_ATA            SPL token account that receives bridged Solana $LOAR
 *   EVM_BRIDGE_VAULT_ADDRESS        EVM address that receives bridged EVM $LOAR
 *   LOAR_TOKEN_ADDRESS              ERC20 address of $LOAR on Sepolia
 *   LOAR_MINT_DEVNET                SPL mint of $LOAR on Solana
 *
 * Signature ABIs hard-coded below — keeping the bridge service standalone
 * means it doesn't pull in the ABI package (which would force a full
 * monorepo dep chain into the bridge worker).
 */
import { PublicKey } from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { encodeFunctionData, parseUnits } from 'viem';
import {
  activeCluster,
  executeSolanaTransaction,
  getOrCreateSolanaWallet,
  getSolanaConnection,
} from './circle-solana';
import { executeTransaction, getOrCreateWallet } from './circle-wallets';
import { db, firebaseAvailable } from './firebase';

// ── ABIs (minimal, hand-pinned) ─────────────────────────────────────────────

const ERC20_DECIMALS = 18;
const SPL_DECIMALS = 9;
const SCALE_DIFF = BigInt(10) ** BigInt(ERC20_DECIMALS - SPL_DECIMALS); // 10^9

// LoarToken is OpenZeppelin ERC20Mintable + ERC20Burnable; we use:
//   transfer(address to, uint256 amount)  — EVM source-side lock
//   mint(address to, uint256 amount)      — EVM destination-side credit
const erc20TransferAbi = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
] as const;
const erc20MintAbi = [
  {
    name: 'mint',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
] as const;

// ── Configuration ──────────────────────────────────────────────────────────

interface BridgeConfig {
  solVaultAta: string;
  evmVaultAddress: `0x${string}`;
  loarTokenAddress: `0x${string}`;
  loarMint: string;
  evmChainId: number;
}

function getConfig(): BridgeConfig | null {
  const cluster = activeCluster();
  const solVaultAta = process.env.SOL_BRIDGE_VAULT_ATA;
  const evmVaultAddress = process.env.EVM_BRIDGE_VAULT_ADDRESS as `0x${string}` | undefined;
  const loarTokenAddress = process.env.LOAR_TOKEN_ADDRESS as `0x${string}` | undefined;
  const loarMint =
    cluster === 'mainnet-beta' ? process.env.LOAR_MINT_MAINNET : process.env.LOAR_MINT_DEVNET;
  if (!solVaultAta || !evmVaultAddress || !loarTokenAddress || !loarMint) return null;
  // EVM chain id — Sepolia=11155111 for v1; production picks from env.
  const evmChainId = Number(process.env.LOAR_EVM_CHAIN_ID ?? '11155111');
  return { solVaultAta, evmVaultAddress, loarTokenAddress, loarMint, evmChainId };
}

export function isCustodialBridgeConfigured(): boolean {
  return getConfig() !== null;
}

// ── Bridge intent persistence ───────────────────────────────────────────────

export type BridgeDirection = 'sol_to_evm' | 'evm_to_sol';
export type BridgeState = 'pending_source' | 'pending_destination' | 'completed' | 'failed';

export interface BridgeIntent {
  id: string;
  userId: string;
  direction: BridgeDirection;
  /** Amount in source-token base units (lamports for SPL, wei for ERC20). */
  amountBaseUnits: string;
  recipient: string;
  state: BridgeState;
  sourceTxRef?: string;
  destinationTxRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const getCol = () => (firebaseAvailable ? db.collection('bridgeIntents') : null);

async function saveIntent(intent: BridgeIntent): Promise<void> {
  const col = getCol();
  if (col) await col.doc(intent.id).set(intent, { merge: true });
}

export async function getIntent(id: string): Promise<BridgeIntent | null> {
  const col = getCol();
  if (!col) return null;
  const doc = await col.doc(id).get();
  return doc.exists ? (doc.data() as BridgeIntent) : null;
}

// ── Solana → EVM ────────────────────────────────────────────────────────────

interface BridgeSolToEvmArgs {
  userId: string;
  /** Amount in lamports (SPL base units, 9 decimals). */
  amountBaseUnits: string;
  /** EVM 0x recipient. */
  recipient: `0x${string}`;
}

export async function bridgeSolToEvm(args: BridgeSolToEvmArgs): Promise<BridgeIntent> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Custodial bridge not configured');

  const cluster = activeCluster();
  const solWallet = await getOrCreateSolanaWallet(args.userId, cluster);
  const solPubkey = new PublicKey(solWallet.address);
  const mintPk = new PublicKey(cfg.loarMint);
  const vaultPk = new PublicKey(cfg.solVaultAta);

  // Caller's Token-2022 ATA for $LOAR (source).
  const fromAta = getAssociatedTokenAddressSync(
    mintPk,
    solPubkey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // 1. Build SPL transfer to vault. transfer_checked enforces mint+decimals
  // match so the bridge can't be tricked by a malicious token impersonator.
  const transferIx = createTransferCheckedInstruction(
    fromAta,
    mintPk,
    vaultPk,
    solPubkey,
    BigInt(args.amountBaseUnits),
    SPL_DECIMALS,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  // Bridge intent — persisted before we touch the chain so a server crash
  // mid-flight leaves a trail.
  const intent: BridgeIntent = {
    id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: args.userId,
    direction: 'sol_to_evm',
    amountBaseUnits: args.amountBaseUnits,
    recipient: args.recipient,
    state: 'pending_source',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveIntent(intent);

  let sourceTx;
  try {
    sourceTx = await executeSolanaTransaction({
      walletId: solWallet.walletId,
      cluster,
      instructions: [transferIx],
      computeUnitLimit: 100_000,
    });
  } catch (err) {
    intent.state = 'failed';
    intent.error = err instanceof Error ? err.message : 'source transfer failed';
    intent.updatedAt = Date.now();
    await saveIntent(intent);
    return intent;
  }

  intent.sourceTxRef = sourceTx.signature ?? sourceTx.txId;
  intent.state = 'pending_destination';
  intent.updatedAt = Date.now();
  await saveIntent(intent);

  // 2. EVM mint. Bridge holds mint authority on testnet $LOAR. Amount is
  // scaled from SPL 9 decimals → ERC20 18 decimals (× 10^9).
  const evmAmount = BigInt(args.amountBaseUnits) * SCALE_DIFF;
  const calldata = encodeFunctionData({
    abi: erc20MintAbi,
    functionName: 'mint',
    args: [args.recipient, evmAmount],
  });

  // The Circle DCW EVM wallet that runs platform mints — same one used
  // elsewhere for AI-triggered creator stamps.
  const platformWallet = await getOrCreateWallet('platform_bridge_signer', cfg.evmChainId);

  try {
    const evmTx = await executeTransaction({
      walletId: platformWallet.walletId,
      contractAddress: cfg.loarTokenAddress,
      calldata,
      chainId: cfg.evmChainId,
    });
    intent.destinationTxRef = evmTx.txHash ?? evmTx.txId;
    intent.state = 'completed';
  } catch (err) {
    // Source landed but destination failed — recoverable via retry.
    intent.state = 'pending_destination';
    intent.error = err instanceof Error ? err.message : 'destination mint failed';
  }
  intent.updatedAt = Date.now();
  await saveIntent(intent);
  return intent;
}

// ── EVM → Solana ────────────────────────────────────────────────────────────

interface BridgeEvmToSolArgs {
  userId: string;
  /** Amount in wei (ERC20 base units, 18 decimals). */
  amountBaseUnits: string;
  /** Solana base58 recipient. */
  recipient: string;
}

export async function bridgeEvmToSol(args: BridgeEvmToSolArgs): Promise<BridgeIntent> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Custodial bridge not configured');

  const cluster = activeCluster();
  // 1. EVM transfer to vault — caller's Circle EVM wallet signs.
  const evmWallet = await getOrCreateWallet(args.userId, cfg.evmChainId);

  const calldata = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: 'transfer',
    args: [cfg.evmVaultAddress, BigInt(args.amountBaseUnits)],
  });

  const intent: BridgeIntent = {
    id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: args.userId,
    direction: 'evm_to_sol',
    amountBaseUnits: args.amountBaseUnits,
    recipient: args.recipient,
    state: 'pending_source',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveIntent(intent);

  try {
    const evmTx = await executeTransaction({
      walletId: evmWallet.walletId,
      contractAddress: cfg.loarTokenAddress,
      calldata,
      chainId: cfg.evmChainId,
    });
    intent.sourceTxRef = evmTx.txHash ?? evmTx.txId;
    intent.state = 'pending_destination';
  } catch (err) {
    intent.state = 'failed';
    intent.error = err instanceof Error ? err.message : 'source transfer failed';
    intent.updatedAt = Date.now();
    await saveIntent(intent);
    return intent;
  }
  intent.updatedAt = Date.now();
  await saveIntent(intent);

  // 2. Solana mint-to recipient via SPL Token-2022. Amount scaled wei → lamports.
  const splAmount = BigInt(args.amountBaseUnits) / SCALE_DIFF;
  if (splAmount === 0n) {
    intent.state = 'completed';
    intent.error = 'amount too small after decimals truncation';
    await saveIntent(intent);
    return intent;
  }

  const mintPk = new PublicKey(cfg.loarMint);
  const recipientPk = new PublicKey(args.recipient);

  // Platform bridge wallet on Solana holds mint authority.
  const platformWallet = await getOrCreateSolanaWallet('platform_bridge_signer', cluster);
  const mintAuthorityPk = new PublicKey(platformWallet.address);

  const recipientAta = getAssociatedTokenAddressSync(
    mintPk,
    recipientPk,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  // Pre-create the ATA if needed (idempotent on chain).
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    mintAuthorityPk,
    recipientAta,
    recipientPk,
    mintPk,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const mintIx = createMintToCheckedInstruction(
    mintPk,
    recipientAta,
    mintAuthorityPk,
    splAmount,
    SPL_DECIMALS,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  try {
    const solTx = await executeSolanaTransaction({
      walletId: platformWallet.walletId,
      cluster,
      instructions: [ataIx, mintIx],
      computeUnitLimit: 200_000,
    });
    intent.destinationTxRef = solTx.signature ?? solTx.txId;
    intent.state = 'completed';
  } catch (err) {
    intent.state = 'pending_destination';
    intent.error = err instanceof Error ? err.message : 'destination mint failed';
  }
  intent.updatedAt = Date.now();
  await saveIntent(intent);
  return intent;
}

// ── Quote helper ────────────────────────────────────────────────────────────

export interface BridgeQuoteResult {
  configured: boolean;
  estimatedSeconds: number;
  feeNote: string;
}

export function quoteCustodialBridge(): BridgeQuoteResult {
  return {
    configured: isCustodialBridgeConfigured(),
    estimatedSeconds: 30,
    feeNote: 'Testnet only — no protocol fee. Gas covered by Circle DCW platform wallet.',
  };
}

/**
 * Parse a human decimal amount (e.g. "1.5") into source-token base units.
 * Direction determines decimals: SPL=9 for sol_to_evm source, ERC20=18 for
 * evm_to_sol source.
 */
export function parseAmountForDirection(amount: string, direction: BridgeDirection): bigint {
  const decimals = direction === 'sol_to_evm' ? SPL_DECIMALS : ERC20_DECIMALS;
  return parseUnits(amount, decimals);
}
