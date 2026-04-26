/**
 * TokenSwapWidget — In-app token swap interface for universe tokens.
 *
 * Supports three modes:
 * - compact: small button for sidebars
 * - card: medium card with price + quick buy
 * - full: complete buy/sell interface with amount input and price estimate
 *
 * Automatically detects whether the token is in bonding curve phase or LP pool phase.
 */
import { useState, useMemo } from 'react';
import { useTokenPool, getSwapUrl } from '@/hooks/useTokenSwap';
import { usePoolData, ethPricePerToken, formatTokenAmount } from '@/hooks/useTokens';
import {
  useCurveState,
  useCurveProgress,
  useBondingCurveActions,
  usePreviewBuy,
} from '@/hooks/useBondingCurve';
import { useChainId, useBalance } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { formatEther, parseUnits, type Address } from 'viem';
import {
  ArrowUpDown,
  ExternalLink,
  Loader2,
  TrendingUp,
  Zap,
  Flame,
  Lock,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link } from '@tanstack/react-router';
import { openExternal } from '@/utils/open-external';
import { Price } from '@/components/Price';

interface TokenSwapWidgetProps {
  universeAddress: string;
  bondingCurveAddress?: string;
  compact?: boolean;
  mode?: 'compact' | 'card' | 'full';
}

export function TokenSwapWidget({
  universeAddress,
  bondingCurveAddress,
  compact = false,
  mode: modeProp,
}: TokenSwapWidgetProps) {
  const chainId = useChainId();
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });
  const { data: pool, isLoading, isError } = useTokenPool(universeAddress);
  const { data: poolData } = usePoolData(pool?.poolId);
  const [buyAmount, setBuyAmount] = useState('');
  const [showLpInfo, setShowLpInfo] = useState(false);

  // Bonding curve state
  const curveAddr = bondingCurveAddress as Address | undefined;
  const { state: curveState } = useCurveState(curveAddr);
  const { progress } = useCurveProgress(curveAddr);
  const { tokensOut: previewTokens } = usePreviewBuy(curveAddr, buyAmount);
  const {
    buy,
    status: curveStatus,
    error: curveError,
    reset: curveReset,
  } = useBondingCurveActions(curveAddr);

  const isInBondingPhase = !!curveAddr && curveState != null && !curveState.graduated;

  const mode = modeProp ?? (compact ? 'compact' : 'card');

  // Calculate current ETH-per-token price — bonding curve or LP pool. The
  // pool helper handles currency0/currency1 ordering so we always quote in
  // ETH per token and return null for untraded pools.
  const currentPrice = isInBondingPhase
    ? curveState && curveState.currentPrice > 0n
      ? Number(formatEther(curveState.currentPrice))
      : null
    : poolData && pool
      ? ethPricePerToken(poolData, pool.tokenAddress)
      : null;

  const estimatedTokens = useMemo(() => {
    if (isInBondingPhase) {
      return previewTokens > 0n ? Number(formatEther(previewTokens)) : null;
    }
    if (!buyAmount || !currentPrice || isNaN(Number(buyAmount))) return null;
    return currentPrice > 0 ? Number(buyAmount) / currentPrice : 0;
  }, [isInBondingPhase, previewTokens, buyAmount, currentPrice]);

  if (isLoading) {
    return mode === 'compact' ? null : (
      <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin mr-1" />
        Loading pool...
      </div>
    );
  }

  if (!pool || isError) return null;

  const swapUrl = getSwapUrl(pool.tokenAddress, chainId);
  const progressPct = progress ? Number(progress.percentBps) / 100 : 0;

  // ─── Compact mode ────────────────────────────────────────────────────
  if (mode === 'compact') {
    return (
      <div className="flex gap-1.5">
        <Link to="/tokens/$address" params={{ address: pool.tokenAddress }} className="flex-1">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs gap-1.5 border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300"
          >
            <TrendingUp className="h-3 w-3" />${pool.tokenSymbol}
            {isInBondingPhase && (
              <Badge
                variant="outline"
                className="text-[8px] h-4 px-1 border-orange-400 text-orange-500"
              >
                CURVE
              </Badge>
            )}
            {currentPrice && (
              <span className="font-mono text-[10px] opacity-70">
                {currentPrice < 0.001 ? currentPrice.toExponential(1) : currentPrice.toFixed(4)}
              </span>
            )}
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 border-green-200 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300"
          onClick={() => (isInBondingPhase ? undefined : openExternal(swapUrl))}
        >
          <ArrowUpDown className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // ─── Card mode ───────────────────────────────────────────────────────
  if (mode === 'card') {
    return (
      <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/20 dark:to-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isInBondingPhase ? (
              <Flame className="h-4 w-4 text-orange-500" />
            ) : (
              <ArrowUpDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            )}
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              ${pool.tokenSymbol}
            </span>
            {isInBondingPhase && (
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1.5 border-orange-400 text-orange-500"
              >
                Bonding Curve
              </Badge>
            )}
          </div>
          {currentPrice && (
            <span className="font-mono text-xs text-amber-800 dark:text-amber-200">
              {currentPrice < 0.001 ? currentPrice.toExponential(3) : currentPrice.toFixed(6)} ETH
            </span>
          )}
        </div>

        {/* Bonding curve progress bar */}
        {isInBondingPhase && progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                <Price wei={progress.raised} hideChain /> raised
              </span>
              <span>{progressPct.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(progressPct, 100)}%` }}
              />
            </div>
            <p className="text-[9px] text-center text-muted-foreground">
              Graduates to LP at <Price wei={progress.target} hideChain />
            </p>
          </div>
        )}

        {/* Quick buy amounts */}
        <div className="grid grid-cols-4 gap-1.5">
          {['0.01', '0.05', '0.1', '0.5'].map((val) => (
            <Button
              key={val}
              variant="outline"
              size="sm"
              className="text-[10px] h-7 border-amber-200 dark:border-amber-700"
              onClick={() => {
                if (isInBondingPhase) {
                  buy(val);
                } else {
                  const url = `${swapUrl}&exactAmount=${val}&exactField=input`;
                  openExternal(url);
                }
              }}
            >
              <Price eth={parseFloat(val)} hideChain />
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          <Link to="/tokens/$address" params={{ address: pool.tokenAddress }} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs">
              <TrendingUp className="h-3 w-3 mr-1" />
              Chart
            </Button>
          </Link>
          <Button
            className="flex-1 bg-amber-600 hover:bg-amber-500 text-white text-xs"
            size="sm"
            onClick={() => (isInBondingPhase ? buy('0.05') : openExternal(swapUrl))}
          >
            <ArrowUpDown className="h-3 w-3 mr-1" />
            {isInBondingPhase ? 'Buy' : 'Swap'}
          </Button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => !isInBondingPhase && setShowLpInfo(!showLpInfo)}
            className="inline-flex items-center justify-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            {isInBondingPhase ? (
              <>
                <Zap className="h-2.5 w-2.5" />
                Anti-whale: max 2% per tx
              </>
            ) : (
              <>
                <Lock className="h-2.5 w-2.5" />
                LP locked forever
                <Info className="h-2.5 w-2.5 opacity-60" />
              </>
            )}
          </button>
          {showLpInfo && !isInBondingPhase && (
            <div className="mt-2 p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-[10px] text-left text-amber-700 dark:text-amber-300 space-y-1">
              <p className="font-medium">What does "LP locked forever" mean?</p>
              <p>
                Liquidity pool tokens are permanently locked at the protocol level. The creator
                cannot withdraw liquidity or "rug pull" the pool. Only swap fee rewards can be
                claimed by the reward admin.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Full mode ───────────────────────────────────────────────────────
  return (
    <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/20 dark:to-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isInBondingPhase ? (
            <Flame className="h-5 w-5 text-orange-500" />
          ) : (
            <ArrowUpDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          )}
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            Buy ${pool.tokenSymbol}
          </span>
          {isInBondingPhase && (
            <Badge variant="outline" className="text-[9px] border-orange-400 text-orange-500">
              Bonding Curve
            </Badge>
          )}
        </div>
        <Link to="/tokens/$address" params={{ address: pool.tokenAddress }}>
          <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-amber-200/50">
            Full Chart
          </Badge>
        </Link>
      </div>

      {/* Bonding curve progress */}
      {isInBondingPhase && progress && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Progress to LP</span>
            <span className="font-mono font-medium">{progressPct.toFixed(1)}%</span>
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-400 via-orange-500 to-green-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>
              <Price wei={progress.raised} hideChain /> raised
            </span>
            <span>
              <Price wei={progress.target} hideChain /> target
            </span>
          </div>
        </div>
      )}

      {currentPrice && (
        <div className="text-center py-2">
          <p className="text-xs text-muted-foreground">Current Price</p>
          <p className="text-xl font-bold font-mono">
            {currentPrice < 0.001 ? currentPrice.toExponential(3) : currentPrice.toFixed(6)}
          </p>
          <p className="text-xs text-muted-foreground">ETH per ${pool.tokenSymbol}</p>
        </div>
      )}

      {/* Amount Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Amount (ETH)</span>
          {ethBalance && (
            <button
              onClick={() => setBuyAmount(ethBalance.formatted)}
              className="hover:text-foreground"
            >
              Balance: <Price wei={ethBalance.value} hideChain />
            </button>
          )}
        </div>
        <Input
          type="number"
          placeholder="0.0"
          value={buyAmount}
          onChange={(e) => setBuyAmount(e.target.value)}
          className="h-10 font-mono"
        />
      </div>

      {estimatedTokens && estimatedTokens > 0 && (
        <div className="p-2 bg-white/50 dark:bg-black/20 rounded text-center">
          <p className="text-xs text-muted-foreground">You receive (est.)</p>
          <p className="font-bold font-mono text-sm">
            {formatTokenAmount(String(parseUnits(estimatedTokens.toFixed(18), 18)))} $
            {pool.tokenSymbol}
          </p>
        </div>
      )}

      {/* Quick amounts */}
      <div className="grid grid-cols-4 gap-1.5">
        {['0.01', '0.05', '0.1', '0.5'].map((val) => (
          <Button
            key={val}
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => setBuyAmount(val)}
          >
            {val}
          </Button>
        ))}
      </div>

      {curveError && <p className="text-xs text-red-500 text-center">{curveError}</p>}

      <Button
        className="w-full h-11 bg-green-600 hover:bg-green-500 text-white font-bold"
        onClick={() => {
          if (isInBondingPhase) {
            buy(buyAmount);
          } else {
            const url = buyAmount
              ? `${swapUrl}&exactAmount=${buyAmount}&exactField=input`
              : swapUrl;
            openExternal(url);
          }
        }}
        disabled={!buyAmount || Number(buyAmount) <= 0 || curveStatus === 'confirming'}
      >
        {curveStatus === 'confirming' ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <ArrowUpDown className="h-4 w-4 mr-2" />
        )}
        {isInBondingPhase ? `Buy $${pool.tokenSymbol}` : `Buy $${pool.tokenSymbol} on Uniswap`}
        {!isInBondingPhase && <ExternalLink className="h-3 w-3 ml-2 opacity-50" />}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={() => !isInBondingPhase && setShowLpInfo(!showLpInfo)}
          className="inline-flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {isInBondingPhase ? (
            'Bonding curve — price rises with each buy — max 2% per tx — no rugs'
          ) : (
            <>
              <Lock className="h-2.5 w-2.5" />
              Swaps on Uniswap v4 — LP locked forever — No rugs
              <Info className="h-2.5 w-2.5 opacity-60" />
            </>
          )}
        </button>
        {showLpInfo && !isInBondingPhase && (
          <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-left text-amber-700 dark:text-amber-300 space-y-1.5">
            <p className="font-semibold flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              Permanent LP Lock
            </p>
            <p>
              Liquidity pool tokens are permanently locked at the protocol level. The creator cannot
              withdraw liquidity or perform a "rug pull."
            </p>
            <p>
              Only accumulated swap fee rewards can be claimed by the designated reward admin. The
              underlying liquidity is irreversibly locked.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
