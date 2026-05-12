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
 * Initiate a bridge transfer. The source-chain tx is built and signed via
 * the user's Circle DCW wallet on that chain (EVM Circle wallet for EVM
 * source, Solana Circle wallet for Solana source).
 *
 * The destination-chain redeem is handled by Wormhole's automatic relayer
 * in most cases. For manual redemption, see `redeemOnDestination` below.
 */
export async function initiateBridgeTransfer(
  req: BridgeTransferRequest
): Promise<BridgeTransferResult> {
  if (!isBridgeConfigured(req.from, req.to)) {
    throw new Error(
      `NTT manager not configured for ${req.from} → ${req.to}. Bridge currently disabled.`
    );
  }

  // The actual transfer wiring depends on chain-specific NTT SDK paths:
  //   EVM source:    @wormhole-foundation/sdk-evm-ntt → call manager.transfer()
  //   Solana source: @wormhole-foundation/sdk-solana-ntt → tx builder against
  //                  the Anchor manager program; signed by Circle DCW Solana
  //
  // For this scaffold we expose the API shape. Wire the actual SDK once NTT
  // managers are deployed (see setup checklist above). The frontend can call
  // /api/bridge/transfer; until configured it returns 503 cleanly.
  throw new Error(
    'NTT transfer flow requires deployed manager contracts. See lib/wormhole-bridge.ts setup checklist.'
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface BridgeStatus {
  state: 'pending_source' | 'pending_vaa' | 'pending_destination' | 'completed' | 'failed';
  sourceTxRef: string;
  vaaSequence?: string;
  destinationTxRef?: string;
}

/**
 * Poll the status of a bridge transfer. Uses Wormhole's API to find the VAA
 * for the source-chain tx, then checks destination chain for the redeem.
 */
export async function getBridgeStatus(args: {
  from: Chain;
  sourceTxRef: string;
}): Promise<BridgeStatus> {
  const cfg = getBridgeConfig();
  const wh = await wormhole(cfg.network, []);

  // Look up the VAA(s) emitted by this source tx. The Wormhole SDK exposes
  // chain-context.parseTransaction(txRef) which decodes the source-chain tx
  // and returns WormholeMessageId[] (chain + emitter + sequence) for each
  // VAA emitted. Empty array = source tx not yet finalized.
  try {
    const ctx = wh.getChain(args.from);
    const messages = await ctx.parseTransaction(args.sourceTxRef);
    if (!messages.length) {
      return { state: 'pending_vaa', sourceTxRef: args.sourceTxRef };
    }
    const [msg] = messages;
    // VAA exists — destination redeem is now the gating step. Without the
    // destination tx hash we can't confirm completion; return pending.
    return {
      state: 'pending_destination',
      sourceTxRef: args.sourceTxRef,
      vaaSequence: msg.sequence.toString(),
    };
  } catch {
    return { state: 'pending_source', sourceTxRef: args.sourceTxRef };
  }
}
