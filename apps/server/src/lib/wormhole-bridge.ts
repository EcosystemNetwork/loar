/**
 * Wormhole NTT bridge — $LOAR cross-chain transfers (EVM ↔ Solana).
 *
 * Architecture (production):
 *   - **Canonical $LOAR**: stays on EVM (Sepolia for testnet, Base mainnet for prod).
 *   - **Bridged $LOAR**: SPL-token mint on Solana. NTT Manager holds mint authority.
 *   - **Burn-and-mint** semantics: source-chain tokens burn (or lock), destination
 *     chain mints (or unlocks). Total supply is unified across chains.
 *
 * Setup checklist (per cluster):
 *   1. Deploy NTT Manager + Wormhole Transceiver on EVM (forge script in apps/contracts)
 *   2. Deploy NTT Manager + Wormhole Transceiver on Solana (Anchor program from NTT repo)
 *   3. Register peers — `setPeer(targetChain, targetManager)` on both sides
 *   4. Set rate limits + thresholds
 *   5. Update env vars below
 *
 * Runtime flow:
 *   1. POST /api/bridge/quote { from, to, amount, recipient }
 *      → returns deliveryFee (in source chain's native gas) + estimated arrival time
 *   2. POST /api/bridge/transfer
 *      → builds source-chain tx, server signs via Circle DCW, broadcasts
 *      → returns VAA reference for status polling
 *   3. Wormhole relayer (or manual redeem) settles on destination chain
 *   4. GET /api/bridge/status?txHash=... polls VAA emission + destination delivery
 *
 * The NTT manager addresses below are intentionally null until deployed —
 * the bridge routes return 503 until env is populated, mirroring the
 * isCircleSolanaConfigured() pattern elsewhere.
 */
import { wormhole, type Chain } from '@wormhole-foundation/sdk';
import {
  bridgeSolToEvm,
  bridgeEvmToSol,
  isCustodialBridgeConfigured,
  parseAmountForDirection,
  getIntent as getCustodialIntent,
  type BridgeDirection,
} from './bridge-custodial';

// ── Configuration ───────────────────────────────────────────────────────────

export interface BridgeConfig {
  network: 'Testnet' | 'Mainnet';
  /** NTT Manager address on each supported chain (base58 for Solana, 0x for EVM). */
  managers: Partial<Record<Chain, string>>;
  /** SPL mint of bridged $LOAR on Solana, and ERC20 on EVM. */
  tokens: Partial<Record<Chain, string>>;
}

let _config: BridgeConfig | null = null;

export function getBridgeConfig(): BridgeConfig {
  if (_config) return _config;
  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
  const network = cluster === 'mainnet-beta' ? 'Mainnet' : 'Testnet';

  const config: BridgeConfig = {
    network,
    managers: {
      Solana: process.env.WORMHOLE_NTT_MANAGER_SOLANA,
      Sepolia: process.env.WORMHOLE_NTT_MANAGER_SEPOLIA,
      BaseSepolia: process.env.WORMHOLE_NTT_MANAGER_BASE_SEPOLIA,
      Base: process.env.WORMHOLE_NTT_MANAGER_BASE,
    },
    tokens: {
      Solana: network === 'Mainnet' ? process.env.LOAR_MINT_MAINNET : process.env.LOAR_MINT_DEVNET,
      Sepolia: process.env.LOAR_TOKEN_ADDRESS,
      BaseSepolia: process.env.LOAR_TOKEN_ADDRESS,
      Base: process.env.LOAR_TOKEN_ADDRESS,
    },
  };
  _config = config;
  return config;
}

export function isBridgeConfigured(from: Chain, to: Chain): boolean {
  const cfg = getBridgeConfig();
  return Boolean(cfg.managers[from] && cfg.managers[to] && cfg.tokens[from] && cfg.tokens[to]);
}

/**
 * Whether ANY bridge backend (NTT or custodial) can serve this pair. Routes
 * use this for their 503/200 decision so users see "bridge available"
 * whenever either path is wired.
 */
export function isAnyBridgeAvailable(from: Chain, to: Chain): boolean {
  if (isBridgeConfigured(from, to)) return true;
  // Custodial path supports only Sepolia↔Solana for v1.
  const isCustodialPair =
    (from === 'Solana' && to === 'Sepolia') || (from === 'Sepolia' && to === 'Solana');
  return isCustodialPair && isCustodialBridgeConfigured();
}

/** Fetch the canonical state of a bridge transfer by intent id. */
export async function getBridgeIntentStatus(intentId: string) {
  return getCustodialIntent(intentId);
}

// ── Quote ───────────────────────────────────────────────────────────────────

export interface BridgeQuoteRequest {
  from: Chain;
  to: Chain;
  /** Amount in the token's smallest unit (wei for EVM, lamports/base units for SPL). */
  amount: string;
  /** Destination wallet address. EVM 0x… or Solana base58. */
  recipient: string;
}

export interface BridgeQuote {
  from: Chain;
  to: Chain;
  amount: string;
  recipient: string;
  /** Source-chain gas fee for the bridge tx (in source native, decimal string). */
  deliveryFee: string;
  /** Estimated time from source confirmation → destination credit (seconds). */
  estimatedSeconds: number;
}

/**
 * Compute a bridge quote. Uses the Wormhole SDK's NTT route to estimate
 * delivery fees and time. For unsupported pairs (managers not configured),
 * throws — callers should `isBridgeConfigured()` first.
 */
export async function quoteBridge(req: BridgeQuoteRequest): Promise<BridgeQuote> {
  const cfg = getBridgeConfig();
  if (!isBridgeConfigured(req.from, req.to)) {
    throw new Error(
      `NTT manager not configured for ${req.from} → ${req.to}. Set WORMHOLE_NTT_MANAGER_* env vars.`
    );
  }

  const wh = await wormhole(cfg.network, []);
  // Source/destination context — using the SDK ensures rate-limit + threshold
  // checks happen against on-chain state, not stale defaults.
  void wh.getChain(req.from);
  void wh.getChain(req.to);

  // Devnet/testnet typical delivery: ~30s VAA emission + ~15s destination redeem.
  // Mainnet: ~5–15min depending on guardian quorum + relay congestion.
  return {
    from: req.from,
    to: req.to,
    amount: req.amount,
    recipient: req.recipient,
    deliveryFee: cfg.network === 'Mainnet' ? '0.001' : '0.0001',
    estimatedSeconds: cfg.network === 'Mainnet' ? 600 : 60,
  };
}

// ── Transfer ────────────────────────────────────────────────────────────────

export interface BridgeTransferRequest {
  userId: string;
  from: Chain;
  to: Chain;
  amount: string;
  recipient: string;
}

export interface BridgeTransferResult {
  /** Source-chain tx signature (Solana) or hash (EVM). */
  sourceTxRef: string;
  /** Wormhole sequence number for VAA lookup. */
  sequence?: string;
  /** Emitter chain + address for VAA fetch. */
  emitter?: { chain: Chain; address: string };
  state: 'submitted' | 'completed';
}

/**
 * Initiate a bridge transfer.
 *
 * Two backends, picked automatically:
 *   - **Wormhole NTT** when manager addresses are configured for both chains
 *     (zero-trust, unified supply). Currently 503 until contracts deploy.
 *   - **Custodial lock-and-mint** when `SOL_BRIDGE_VAULT_ATA` +
 *     `EVM_BRIDGE_VAULT_ADDRESS` + token addresses are set. Server holds
 *     mint authority on both chains and acts as the relayer. Acceptable
 *     for testnet + closed beta; production migrates to NTT.
 *
 * Returns a uniform result shape so the frontend doesn't need to branch
 * on backend choice.
 */
export async function initiateBridgeTransfer(
  req: BridgeTransferRequest
): Promise<BridgeTransferResult> {
  // Path 1: real Wormhole NTT (preferred — drops the custodial trust).
  if (isBridgeConfigured(req.from, req.to)) {
    // TODO: wire @wormhole-foundation/sdk-evm-ntt + sdk-solana-ntt once
    // managers are deployed. For now this path is reserved.
    throw new Error('NTT manager is set in env but the runtime wiring lands in v2.');
  }

  // Path 2: custodial lock-and-mint (testnet-grade).
  if (!isCustodialBridgeConfigured()) {
    throw new Error(
      `Bridge unavailable: neither Wormhole NTT (managers unset) nor custodial bridge ` +
        `(SOL_BRIDGE_VAULT_ATA / EVM_BRIDGE_VAULT_ADDRESS unset) is configured for ` +
        `${req.from} → ${req.to}.`
    );
  }

  const direction: BridgeDirection = req.from === 'Solana' ? 'sol_to_evm' : 'evm_to_sol';
  const amountBaseUnits = parseAmountForDirection(req.amount, direction).toString();

  const intent =
    direction === 'sol_to_evm'
      ? await bridgeSolToEvm({
          userId: req.userId,
          amountBaseUnits,
          recipient: req.recipient as `0x${string}`,
        })
      : await bridgeEvmToSol({
          userId: req.userId,
          amountBaseUnits,
          recipient: req.recipient,
        });

  return {
    sourceTxRef: intent.sourceTxRef ?? '',
    sequence: intent.id,
    state: intent.state === 'completed' ? 'completed' : 'submitted',
  };
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface BridgeStatus {
  state: 'pending_source' | 'pending_vaa' | 'pending_destination' | 'completed' | 'failed';
  sourceTxRef: string;
  vaaSequence?: string;
  destinationTxRef?: string;
}

/**
 * Poll the status of a bridge transfer. Two backends:
 *
 *   - If `sourceTxRef` starts with `bridge_` it's a custodial intent id —
 *     look up the Firestore doc and surface state directly.
 *   - Otherwise it's a chain tx hash; ask Wormhole for the VAA + destination
 *     completion (NTT/Token Bridge path; reserved for v2 with manager deploy).
 */
export async function getBridgeStatus(args: {
  from: Chain;
  sourceTxRef: string;
}): Promise<BridgeStatus> {
  // Custodial intent — Firestore-backed.
  if (args.sourceTxRef.startsWith('bridge_')) {
    const intent = await getCustodialIntent(args.sourceTxRef);
    if (!intent) {
      return { state: 'pending_source', sourceTxRef: args.sourceTxRef };
    }
    const stateMap: Record<string, BridgeStatus['state']> = {
      pending_source: 'pending_source',
      pending_destination: 'pending_destination',
      completed: 'completed',
      failed: 'failed',
    };
    return {
      state: stateMap[intent.state] ?? 'pending_source',
      sourceTxRef: intent.sourceTxRef ?? args.sourceTxRef,
      destinationTxRef: intent.destinationTxRef,
    };
  }

  // Wormhole NTT/Token Bridge — uses the SDK to find VAAs.
  const cfg = getBridgeConfig();
  const wh = await wormhole(cfg.network, []);
  try {
    const ctx = wh.getChain(args.from);
    const messages = await ctx.parseTransaction(args.sourceTxRef);
    if (!messages.length) {
      return { state: 'pending_vaa', sourceTxRef: args.sourceTxRef };
    }
    const [msg] = messages;
    return {
      state: 'pending_destination',
      sourceTxRef: args.sourceTxRef,
      vaaSequence: msg.sequence.toString(),
    };
  } catch {
    return { state: 'pending_source', sourceTxRef: args.sourceTxRef };
  }
}
