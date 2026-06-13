/**
 * Uniswap Trading API router — server-orchestrated EVM swaps.
 *
 * Powers three product surfaces, all executed via Circle DCW (server-signed):
 *   - `quote`        — price/route preview (read-only, no tx)
 *   - `swap`         — generic tokenIn → tokenOut, on-chain via Circle
 *   - `swapToLoar`   — convenience: any token → $LOAR (the credit currency),
 *                      i.e. the "swap-to-buy-credits" on-ramp
 *
 * The same procedures are reachable by AI agents through the MCP server
 * (loar_uniswap_quote / loar_uniswap_swap), satisfying the Uniswap prize's
 * "coordination between agents or systems" criterion.
 *
 * Chains: Ethereum Sepolia (11155111, default) and Ethereum mainnet (1).
 * Both are routable by the Trading API; Sepolia is the default for demos.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../../lib/trpc';
import {
  getQuote,
  executeSwap,
  isUniswapTradingConfigured,
  NATIVE_TOKEN,
  type SwapType,
} from '../../lib/uniswap-trading-api';
import { getOrCreateWalletForChain } from '../../lib/circle-wallets';
import { consumeRateLimit } from '../../middleware/rate-limit';
import { captureServerEvent } from '../../lib/analytics';
import { LoarToken } from '@loar/abis/addresses';

// ── Validation ────────────────────────────────────────────────────────────────

const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 40-hex address');
const AMOUNT = z.string().regex(/^\d+$/, 'amount must be a base-10 wei string');

/** Chains where the Trading API has routable liquidity AND we can custody. */
const SUPPORTED_CHAINS = [11155111, 1] as const;
const CHAIN = z.union([z.literal(11155111), z.literal(1)]).default(11155111);

const SWAP_TYPE = z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']).default('EXACT_INPUT');
const SLIPPAGE = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'slippageTolerance is a percent string, e.g. "0.5"')
  .refine((v) => Number(v) > 0 && Number(v) <= 50, 'slippageTolerance must be between 0 and 50%')
  .optional();

/** Default slippage when the caller doesn't specify one. */
const DEFAULT_SLIPPAGE = '0.5';

/**
 * Optional hard cap on input size (wei), e.g. UNISWAP_MAX_SWAP_WEI=1000000000000000000
 * for 1 ETH. Bounds blast radius of a compromised session on the custodial wallet.
 */
function maxSwapWei(): bigint | null {
  const raw = process.env.UNISWAP_MAX_SWAP_WEI;
  if (!raw) return null;
  try {
    const v = BigInt(raw);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

function assertConfigured() {
  if (!isUniswapTradingConfigured()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Uniswap Trading API is not configured on this server (UNISWAP_API_KEY missing).',
    });
  }
}

/**
 * Per-user guards shared by every executing route: rate limit (20/min, 100/day)
 * and an optional absolute size cap. Keyed on the session uid so a stolen
 * session can't drain the custodial wallet or burn Circle quota. Quote (read)
 * paths are not gated here.
 */
async function guardExecution(uid: string, amountWei: string) {
  const perMin = await consumeRateLimit(`uniswap:min:${uid}`, 60_000, 20);
  if (perMin.blocked) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many swaps — wait a minute.' });
  }
  const perDay = await consumeRateLimit(`uniswap:day:${uid}`, 24 * 60 * 60_000, 100);
  if (perDay.blocked) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Daily swap limit reached.' });
  }
  const cap = maxSwapWei();
  if (cap !== null && BigInt(amountWei) > cap) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Amount exceeds the per-swap cap (${cap.toString()} wei).`,
    });
  }
}

/** The EVM address tied to the current session, used as the quote `swapper`. */
function requireEvmAddress(address: string | undefined): string {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This account has no EVM address — connect an EVM wallet to swap.',
    });
  }
  return address;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const uniswapRouter = router({
  /** Whether swaps are available (env-gated). Cheap client capability check. */
  status: protectedProcedure.query(() => ({
    configured: isUniswapTradingConfigured(),
    supportedChains: SUPPORTED_CHAINS,
    nativeToken: NATIVE_TOKEN,
  })),

  /**
   * Price + route preview. Read-only — no transaction, no wallet provisioning.
   */
  quote: protectedProcedure
    .input(
      z.object({
        tokenIn: ADDR,
        tokenOut: ADDR,
        amount: AMOUNT,
        chainId: CHAIN,
        type: SWAP_TYPE,
        slippageTolerance: SLIPPAGE,
      })
    )
    .query(async ({ ctx, input }) => {
      assertConfigured();
      const swapper = requireEvmAddress(ctx.user.address);
      const res = await getQuote({
        swapper,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amount: input.amount,
        chainId: input.chainId,
        type: input.type as SwapType,
        slippageTolerance: input.slippageTolerance,
      });
      return {
        routing: res.routing,
        chainId: input.chainId,
        amountIn: String(res.quote.input?.amount ?? input.amount),
        amountOut: String(res.quote.output?.amount ?? '0'),
        gasFeeUSD: res.quote.gasFeeUSD ?? null,
        priceImpact: res.quote.priceImpact ?? null,
        needsApproval: !!res.permitData, // ERC20 inputs require a Permit2 step
      };
    }),

  /**
   * Execute a swap on-chain via Circle DCW. Resolves (provisioning if needed) a
   * Circle wallet on the target chain so the tx never lands on the wrong network.
   */
  swap: protectedProcedure
    .input(
      z.object({
        tokenIn: ADDR,
        tokenOut: ADDR,
        amount: AMOUNT,
        chainId: CHAIN,
        type: SWAP_TYPE,
        slippageTolerance: SLIPPAGE,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      await guardExecution(ctx.user.uid, input.amount);
      const wallet = await getOrCreateWalletForChain(ctx.user.uid, input.chainId);
      const result = await executeSwap({
        wallet: { walletId: wallet.walletId, address: wallet.address },
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amount: input.amount,
        chainId: input.chainId,
        type: input.type as SwapType,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
      });
      void captureServerEvent('uniswap:swap', {
        distinctId: ctx.user.uid,
        chainId: input.chainId,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        routing: result.routing,
        txHash: result.txHash,
        state: result.state,
      });
      return { ...result, swapperAddress: wallet.address };
    }),

  /**
   * Swap-to-buy-credits on-ramp: convert any token (default native ETH) into
   * $LOAR — the platform's credit/discount currency. The resulting $LOAR can
   * then fund `credits.purchaseWithLoar`.
   */
  swapToLoar: protectedProcedure
    .input(
      z.object({
        tokenIn: ADDR.default(NATIVE_TOKEN),
        amount: AMOUNT,
        chainId: CHAIN,
        slippageTolerance: SLIPPAGE,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const loar = (LoarToken as Record<string, string>)[String(input.chainId)];
      if (!loar) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `$LOAR is not deployed on chain ${input.chainId}.`,
        });
      }
      await guardExecution(ctx.user.uid, input.amount);
      const wallet = await getOrCreateWalletForChain(ctx.user.uid, input.chainId);
      const result = await executeSwap({
        wallet: { walletId: wallet.walletId, address: wallet.address },
        tokenIn: input.tokenIn,
        tokenOut: loar,
        amount: input.amount,
        chainId: input.chainId,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
      });
      void captureServerEvent('uniswap:swap_to_loar', {
        distinctId: ctx.user.uid,
        chainId: input.chainId,
        tokenIn: input.tokenIn,
        routing: result.routing,
        txHash: result.txHash,
        state: result.state,
      });
      return { ...result, tokenOut: loar, swapperAddress: wallet.address };
    }),
});
