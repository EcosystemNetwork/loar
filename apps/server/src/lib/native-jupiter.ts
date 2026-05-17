/**
 * Jupiter swap adapter — server-side wrapper around the v6 quote+swap API.
 *
 * Jupiter is fully off-chain orchestration: we hit the quote API, then the
 * swap API returns a fully-built versioned tx, then we forward it through
 * Circle DCW. No on-chain program of ours is involved.
 *
 * Required env:
 *   JUPITER_API_BASE — optional, defaults to https://quote-api.jup.ag/v6
 *   (No program ID — Jupiter doesn't expose a single one we depend on.)
 */
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { extractInstructions, resolveUserSolanaWallet } from './native-base';
import { getJupiterApiBase } from './native-registry';
import { activeCluster, executeSolanaTransaction, isCircleSolanaConfigured } from './circle-solana';

export function isJupiterConfigured(): boolean {
  return isCircleSolanaConfigured();
}

// ── Quote ───────────────────────────────────────────────────────────────────

export interface JupiterQuoteArgs {
  inputMint: PublicKey;
  outputMint: PublicKey;
  /** Amount of `inputMint` (raw lamports). */
  amount: bigint;
  /** Slippage tolerance in basis points. Default 50 (0.5%). */
  slippageBps?: number;
  /** 'ExactIn' (default) or 'ExactOut'. */
  swapMode?: 'ExactIn' | 'ExactOut';
}

/**
 * Jupiter's v6 quote response — partial typing of the fields we use. Pass
 * the full `quoteResponse` object back to `swap()` verbatim — Jupiter's
 * swap endpoint expects the exact shape it returned.
 */
export interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
}

export async function getQuote(args: JupiterQuoteArgs): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint: args.inputMint.toBase58(),
    outputMint: args.outputMint.toBase58(),
    amount: args.amount.toString(),
    slippageBps: String(args.slippageBps ?? 50),
    swapMode: args.swapMode ?? 'ExactIn',
  });
  const resp = await fetch(`${getJupiterApiBase()}/quote?${params.toString()}`);
  if (!resp.ok) {
    throw new Error(`Jupiter quote failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as JupiterQuoteResponse;
}

// ── Swap ────────────────────────────────────────────────────────────────────

export interface JupiterSwapArgs {
  /** User whose Circle DCW wallet signs + funds. */
  swapperUserId: string;
  /** The exact quote object returned from `getQuote`. */
  quoteResponse: JupiterQuoteResponse;
  /** When true, wraps/unwraps WSOL automatically. Default true. */
  wrapAndUnwrapSol?: boolean;
}

export interface JupiterSwapResult {
  txId: string;
  signature?: string;
  state: string;
  /** Amount of output mint the user receives (raw). Pulled from the quote
   *  for caller convenience; actual fill may differ within slippage. */
  estimatedOutAmount: bigint;
}

/**
 * Execute a Jupiter swap. Flow:
 *   1. Resolve the user's Circle DCW Solana wallet.
 *   2. POST the quote + user pubkey to /swap; Jupiter returns a base64
 *      VersionedTransaction.
 *   3. Decode the tx, extract its instructions, re-submit via Circle DCW
 *      (Circle rebuilds with its own fee payer + signs).
 *
 * Why we re-build instead of forwarding the v0 tx: Circle DCW requires
 * instruction-level input. Jupiter txs use Address Lookup Tables; we
 * resolve those alongside the instruction extraction so Circle can
 * rebuild a v0 tx that compresses correctly.
 */
export async function executeSwap(args: JupiterSwapArgs): Promise<JupiterSwapResult> {
  if (!isJupiterConfigured()) throw new Error('jupiter not configured');
  const wallet = await resolveUserSolanaWallet(args.swapperUserId);

  const swapResp = await fetch(`${getJupiterApiBase()}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: args.quoteResponse,
      userPublicKey: wallet.pubkey.toBase58(),
      wrapAndUnwrapSol: args.wrapAndUnwrapSol ?? true,
      asLegacyTransaction: false,
    }),
  });
  if (!swapResp.ok) {
    throw new Error(`Jupiter swap build failed: ${swapResp.status} ${await swapResp.text()}`);
  }
  const swapJson = (await swapResp.json()) as {
    swapTransaction: string;
    lastValidBlockHeight?: number;
  };

  const txBuf = Buffer.from(swapJson.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);

  // Resolve ALTs so Circle DCW can rebuild the tx with proper compression.
  const { getSolanaConnection } = await import('./circle-solana');
  const conn = getSolanaConnection();
  const lookupTableKeys = tx.message.addressTableLookups.map((l) => l.accountKey);
  const lookupTables = await Promise.all(
    lookupTableKeys.map(async (key) => {
      const result = await conn.getAddressLookupTable(key);
      if (!result.value) throw new Error(`Failed to load ALT ${key.toBase58()}`);
      return result.value;
    })
  );

  // H-5: for v0 messages, ALT-sourced accounts must be resolved with the SDK's
  // decompile path so signer/writable flags survive. The legacy `extractInstructions`
  // helper only inspects the static header (`numRequiredSignatures`,
  // `numReadonly*`), which silently downgrades any account that came in via an
  // Address Lookup Table to `isSigner=false, isWritable=false`. Jupiter swaps
  // routinely use ALTs, so without this fix the Circle-rebuilt tx fails on-chain
  // because the user's wSOL/token ATAs aren't marked writable.
  //
  // `TransactionMessage.decompile` reads the resolved address table accounts
  // and re-emits TransactionInstructions with correct AccountMeta flags. For
  // legacy (`!== 0`) messages — which have no ALTs by definition — we keep the
  // existing `extractInstructions` path because it's a cheaper no-op there.
  const isV0 = tx.message.version === 0;
  const instructions = isV0
    ? TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: lookupTables,
      }).instructions
    : extractInstructions(tx);

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions,
    lookupTables,
    computeUnitLimit: 600_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    state: result.state,
    estimatedOutAmount: BigInt(args.quoteResponse.outAmount),
  };
}

// ── Convenience: SOL → $LOAR ────────────────────────────────────────────────

export async function quoteSolToLoar(
  amountLamports: bigint,
  slippageBps = 50
): Promise<JupiterQuoteResponse> {
  const loarMint =
    activeCluster() === 'mainnet-beta'
      ? process.env.LOAR_MINT_MAINNET
      : process.env.LOAR_MINT_DEVNET;
  if (!loarMint)
    throw new Error(
      `LOAR_MINT_${activeCluster() === 'mainnet-beta' ? 'MAINNET' : 'DEVNET'} is not set`
    );
  return getQuote({
    inputMint: new PublicKey('So11111111111111111111111111111111111111112'), // wSOL
    outputMint: new PublicKey(loarMint),
    amount: amountLamports,
    slippageBps,
  });
}
