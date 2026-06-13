/**
 * Uniswap Trading API adapter — EVM swaps via the hosted Uniswap Developer
 * Platform, executed through Circle DCW (server-signed, KMS-custodied).
 *
 * This is the EVM analog of `native-jupiter.ts` (which does the same for
 * Solana). The Trading API is fully off-chain orchestration:
 *   1. POST /check_approval  → does tokenIn need a Permit2 ERC20 approval?
 *   2. POST /quote           → best route + (for ERC20 in) Permit2 typed data
 *   3. (ERC20 only) sign the Permit2 EIP-712 typed data via Circle DCW
 *   4. POST /swap            → fully-formed calldata for the Universal Router
 *   5. forward {to,data,value} through Circle DCW → on-chain tx
 *
 * No LOAR contract is involved — we just custody the swap on behalf of the
 * user's Circle wallet. Powers swap-to-buy-credits and agent-to-agent swaps.
 *
 * Required env:
 *   UNISWAP_API_KEY            — Uniswap Developer Platform key (x-api-key header)
 *   UNISWAP_TRADING_API_BASE   — optional, defaults to the public gateway
 *
 * Docs: https://developers.uniswap.org/docs/trading/swapping-api/getting-started
 */
import { executeTransaction, signTypedData, type TxResult } from './circle-wallets';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Public Trading API gateway. Override via env for self-hosted/proxy setups. */
const DEFAULT_BASE = 'https://trade-api.gateway.uniswap.org/v1';

function apiBase(): string {
  return (process.env.UNISWAP_TRADING_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

export function isUniswapTradingConfigured(): boolean {
  return !!process.env.UNISWAP_API_KEY;
}

/**
 * Sentinel the Trading API uses for native ETH as tokenIn/tokenOut. The API
 * accepts the zero address for the chain's native asset. Exported so callers
 * (and the router/MCP layers) share one definition.
 */
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000' as const;

export function isNativeToken(addr: string): boolean {
  return addr.toLowerCase() === NATIVE_TOKEN;
}

// ── Router allowlist (signing-oracle safety) ────────────────────────────────────
//
// The server signs whatever calldata the Trading API returns, so as defense in
// depth we verify the swap target is a known Uniswap Universal Router before
// handing it to Circle KMS. Addresses captured live from the Trading API
// (/swap response `to`) per chain. Extend via UNISWAP_EXTRA_ROUTERS for new
// chains/router versions: "chainId:0xrouter,chainId:0xrouter".
const KNOWN_ROUTERS: Record<number, Set<string>> = {
  1: new Set(['0x66a9893cc07d91d95644aedd05d03f95e1dba8af']),
  11155111: new Set(['0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b']),
};

(() => {
  const extra = process.env.UNISWAP_EXTRA_ROUTERS;
  if (!extra) return;
  for (const entry of extra.split(',')) {
    const [chainStr, addr] = entry.trim().split(':');
    const chainId = Number(chainStr);
    if (Number.isFinite(chainId) && addr?.startsWith('0x')) {
      (KNOWN_ROUTERS[chainId] ??= new Set()).add(addr.toLowerCase());
    }
  }
})();

export function isKnownRouter(chainId: number, to: string): boolean {
  return KNOWN_ROUTERS[chainId]?.has(to.toLowerCase()) ?? false;
}

/**
 * Pre-signing safety gate for a built swap transaction. Throws on any violation
 * so a malformed/compromised Trading API response can never be signed:
 *   - target must be a known Universal Router on this chain
 *   - native-ETH input must send exactly the authorized amount (no over-spend)
 *   - ERC20 input must carry zero native value
 * Returns the normalized native value (decimal wei) to forward to Circle.
 * EXACT_OUTPUT native swaps skip the exact-amount check (input floats to hit
 * the output target) but still enforce the router + a present value.
 */
export function assertSwapTxSafe(args: {
  chainId: number;
  nativeIn: boolean;
  type: SwapType;
  to: string;
  value: string | undefined;
  amount: string;
}): string | undefined {
  if (!isKnownRouter(args.chainId, args.to)) {
    throw new Error(
      `Refusing to sign: swap target ${args.to} is not a known Uniswap router on chain ${args.chainId}. ` +
        `If this is a legitimate new router, add it via UNISWAP_EXTRA_ROUTERS.`
    );
  }
  const value = toWeiDecimal(args.value);
  if (args.nativeIn) {
    if (args.type === 'EXACT_INPUT' && (!value || BigInt(value) !== BigInt(args.amount))) {
      throw new Error(
        `Refusing to sign: native value ${value ?? '0'} != authorized amount ${args.amount}`
      );
    }
  } else if (value && BigInt(value) !== 0n) {
    throw new Error(`Refusing to sign: ERC20 swap carries non-zero native value ${value}`);
  }
  return value;
}

// ── Low-level HTTP ─────────────────────────────────────────────────────────────

/** Outbound request timeout (ms). The Trading API is normally sub-second. */
const REQUEST_TIMEOUT_MS = 15_000;

async function tradingApiPost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) {
    throw new Error('UNISWAP_API_KEY is not set — get one at https://developers.uniswap.org');
  }
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        // Cloudflare in front of the gateway 1010-bans default bot UAs (e.g.
        // Python-urllib, and potentially undici's default). Send an explicit
        // product UA so server-side calls aren't blocked.
        'User-Agent': 'LOAR/1.0 (+https://loar.fun)',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Uniswap Trading API ${path} request failed: ${reason}`);
  }
  if (!resp.ok) {
    // Surface the API's error text but never echo the key.
    const text = await resp.text().catch(() => '');
    throw new Error(`Uniswap Trading API ${path} failed: ${resp.status} ${text}`.trim());
  }
  return (await resp.json()) as T;
}

// ── /check_approval ────────────────────────────────────────────────────────────

interface ApprovalTx {
  to: string;
  from: string;
  data: `0x${string}`;
  value?: string;
  chainId: number;
}

interface CheckApprovalResponse {
  requestId: string;
  /** Null when the token is native ETH or already has sufficient Permit2 allowance. */
  approval: ApprovalTx | null;
  /** Some responses also include a cancel tx for stale approvals; unused here. */
  cancel?: ApprovalTx | null;
}

/**
 * Ask the Trading API whether `token` needs an ERC20 approval to Permit2 before
 * a swap of `amount`. Returns the approval tx to broadcast, or null if none.
 */
export async function checkApproval(args: {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
}): Promise<ApprovalTx | null> {
  if (isNativeToken(args.token)) return null; // native ETH never needs approval
  const res = await tradingApiPost<CheckApprovalResponse>('/check_approval', {
    walletAddress: args.walletAddress,
    token: args.token,
    amount: args.amount,
    chainId: args.chainId,
  });
  return res.approval ?? null;
}

// ── /quote ─────────────────────────────────────────────────────────────────────

export type SwapType = 'EXACT_INPUT' | 'EXACT_OUTPUT';

export interface QuoteArgs {
  /** Wallet that will swap (its Circle DCW address). */
  swapper: string;
  tokenIn: string;
  tokenOut: string;
  /** Raw amount (wei) of the exact side. */
  amount: string;
  chainId: number;
  type?: SwapType;
  /** Slippage as a percent string, e.g. "0.5". Omit for the API's auto value. */
  slippageTolerance?: string;
  /** Routing preference. CLASSIC = standard AMM (works on all chains incl. testnets). */
  routing?: 'CLASSIC' | 'BEST_PRICE' | 'FASTEST' | 'UNISWAPX_V2';
}

/**
 * Opaque quote object. We pass it back to `/swap` verbatim — the swap endpoint
 * expects the exact shape it returned, so we deliberately keep it loosely typed
 * and only read the few display fields we surface to the UI.
 */
export interface QuoteResponse {
  requestId: string;
  routing: string;
  quote: {
    chainId: number;
    swapper: string;
    input: { amount: string; token: string };
    output: { amount: string; token: string };
    gasFee?: string;
    gasFeeUSD?: string;
    priceImpact?: number;
    [k: string]: unknown;
  };
  /** EIP-712 Permit2 typed data — present for ERC20 inputs, absent for native ETH. */
  permitData?: PermitData | null;
}

export interface PermitData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  values: Record<string, unknown>;
}

export async function getQuote(args: QuoteArgs): Promise<QuoteResponse> {
  return tradingApiPost<QuoteResponse>('/quote', {
    type: args.type ?? 'EXACT_INPUT',
    amount: args.amount,
    tokenInChainId: args.chainId,
    tokenOutChainId: args.chainId,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    swapper: args.swapper,
    ...(args.slippageTolerance ? { slippageTolerance: args.slippageTolerance } : {}),
    routing: args.routing ?? 'CLASSIC',
  });
}

// ── /swap ──────────────────────────────────────────────────────────────────────

interface SwapTx {
  to: string;
  from: string;
  data: `0x${string}`;
  /** Hex wei (e.g. "0x16345785d8a0000"). Native value sent with the tx. */
  value?: string;
  chainId: number;
  gasLimit?: string;
}

interface SwapResponse {
  requestId: string;
  swap: SwapTx;
}

/**
 * Build the Universal Router calldata for a quote. For ERC20 inputs that use
 * Permit2, pass the Permit2 EIP-712 `signature` (produced via Circle DCW).
 */
async function createSwapTx(args: {
  quote: QuoteResponse['quote'];
  permitData?: PermitData | null;
  signature?: string;
}): Promise<SwapTx> {
  const res = await tradingApiPost<SwapResponse>('/swap', {
    quote: args.quote,
    ...(args.permitData ? { permitData: args.permitData } : {}),
    ...(args.signature ? { signature: args.signature } : {}),
  });
  return res.swap;
}

// ── Permit2 signing via Circle DCW ──────────────────────────────────────────────

/**
 * Sign the Permit2 EIP-712 typed data with the user's Circle wallet. Circle's
 * high-level client handles the entity-secret ciphertext per request.
 */
async function signPermit(walletId: string, permitData: PermitData): Promise<string> {
  return signTypedData(walletId, JSON.stringify(permitData), 'Uniswap Permit2 — authorize swap');
}

// ── High-level orchestration ─────────────────────────────────────────────────

export interface ExecuteSwapArgs {
  /** The swapper's Circle DCW wallet, already resolved for the target chain. */
  wallet: { walletId: string; address: string };
  tokenIn: string;
  tokenOut: string;
  /** Raw amount (wei) of tokenIn for EXACT_INPUT (default), or tokenOut for EXACT_OUTPUT. */
  amount: string;
  chainId: number;
  type?: SwapType;
  slippageTolerance?: string;
  routing?: QuoteArgs['routing'];
}

export interface ExecuteSwapResult {
  /** Circle tx id for the swap itself. */
  txId: string;
  txHash?: string;
  state: string;
  /** Circle tx id for the preceding ERC20 approval, if one was needed. */
  approvalTxId?: string;
  /** Expected output amount (raw) from the quote. Actual fill may vary within slippage. */
  estimatedOut: string;
  routing: string;
}

/** Convert a hex-or-decimal wei string to a decimal wei string for Circle. */
function toWeiDecimal(value: string | undefined): string | undefined {
  if (!value || value === '0' || value === '0x0') return undefined;
  try {
    return BigInt(value).toString();
  } catch {
    throw new Error(`Invalid value from swap response: ${value}`);
  }
}

/**
 * Full swap flow: approval (if ERC20) → quote → Permit2 sign (if ERC20) →
 * swap calldata → Circle DCW execution. Returns the on-chain tx hash.
 *
 * Native-ETH inputs (tokenIn = NATIVE_TOKEN) skip steps 1 and 3 entirely —
 * that's the simplest, gas-only path (e.g. ETH → $LOAR, ETH → universe token).
 */
export async function executeSwap(args: ExecuteSwapArgs): Promise<ExecuteSwapResult> {
  if (!isUniswapTradingConfigured()) {
    throw new Error('Uniswap Trading API not configured (UNISWAP_API_KEY missing)');
  }
  const { wallet } = args;
  const nativeIn = isNativeToken(args.tokenIn);

  // 1. Approval (ERC20 inputs only). Approve tokenIn → Permit2.
  let approvalTxId: string | undefined;
  if (!nativeIn) {
    const approval = await checkApproval({
      walletAddress: wallet.address,
      token: args.tokenIn,
      amount: args.amount,
      chainId: args.chainId,
    });
    if (approval) {
      // An approval must only ever target the input token contract (the user
      // is granting Permit2 an allowance ON tokenIn). Reject anything else —
      // a response directing an approve() at an unrelated contract is a red flag.
      if (approval.to.toLowerCase() !== args.tokenIn.toLowerCase()) {
        throw new Error(
          `Refusing to sign approval: target ${approval.to} != input token ${args.tokenIn}`
        );
      }
      const approvalRes = await executeTransaction({
        walletId: wallet.walletId,
        contractAddress: approval.to,
        calldata: approval.data,
        chainId: args.chainId,
        value: toWeiDecimal(approval.value),
      });
      approvalTxId = approvalRes.txId;
    }
  }

  // 2. Quote.
  const quote = await getQuote({
    swapper: wallet.address,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amount: args.amount,
    chainId: args.chainId,
    type: args.type,
    slippageTolerance: args.slippageTolerance,
    routing: args.routing,
  });

  // 3. Permit2 signature (ERC20 inputs that returned permitData).
  let signature: string | undefined;
  if (!nativeIn && quote.permitData) {
    signature = await signPermit(wallet.walletId, quote.permitData);
  }

  // 4. Swap calldata.
  const swap = await createSwapTx({
    quote: quote.quote,
    permitData: nativeIn ? undefined : quote.permitData,
    signature,
  });

  // 4a. Safety gates before signing (server is a signing oracle).
  const swapValue = assertSwapTxSafe({
    chainId: args.chainId,
    nativeIn,
    type: args.type ?? 'EXACT_INPUT',
    to: swap.to,
    value: swap.value,
    amount: args.amount,
  });

  // 5. Execute via Circle DCW. `swap.to` is the (verified) Universal Router.
  const result: TxResult = await executeTransaction({
    walletId: wallet.walletId,
    contractAddress: swap.to,
    calldata: swap.data,
    chainId: args.chainId,
    value: swapValue,
  });

  return {
    txId: result.txId,
    txHash: result.txHash,
    state: result.state,
    approvalTxId,
    estimatedOut: String(quote.quote.output?.amount ?? '0'),
    routing: quote.routing,
  };
}
