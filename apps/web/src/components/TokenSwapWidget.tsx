/**
 * TokenSwapWidget — In-app token swap interface for universe tokens.
 *
 * Supports three modes:
 * - compact: small button for sidebars
 * - card: medium card with price + quick buy
 * - full: complete buy/sell interface with amount input and price estimate
 */
import { useState, useMemo } from 'react';
import { useTokenPool, getSwapUrl } from '@/hooks/useTokenSwap';
import { usePoolData, priceFromSqrtX96, priceFromTick, formatTokenAmount } from '@/hooks/useTokens';
import { useChainId, useBalance } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { ArrowUpDown, ExternalLink, Loader2, TrendingUp, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link } from '@tanstack/react-router';
import { openExternal } from '@/utils/open-external';

interface TokenSwapWidgetProps {
  universeAddress: string;
  compact?: boolean;
  mode?: 'compact' | 'card' | 'full';
}

export function TokenSwapWidget({
  universeAddress,
  compact = false,
  mode: modeProp,
}: TokenSwapWidgetProps) {
  const chainId = useChainId();
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });
  const { data: pool, isLoading, isError } = useTokenPool(universeAddress);
  const { data: poolData } = usePoolData(pool?.poolId);
  const [buyAmount, setBuyAmount] = useState('');

  const mode = modeProp ?? (compact ? 'compact' : 'card');

  // Calculate current price
  const currentPrice = poolData?.sqrtPriceX96
    ? priceFromSqrtX96(poolData.sqrtPriceX96)
    : poolData?.tick != null
      ? priceFromTick(poolData.tick)
      : null;

  const estimatedTokens = useMemo(() => {
    if (!buyAmount || !currentPrice || isNaN(Number(buyAmount))) return null;
    return currentPrice > 0 ? Number(buyAmount) / currentPrice : 0;
  }, [buyAmount, currentPrice]);

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
          onClick={() => openExternal(swapUrl)}
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
            <ArrowUpDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              ${pool.tokenSymbol}
            </span>
          </div>
          {currentPrice && (
            <span className="font-mono text-xs text-amber-800 dark:text-amber-200">
              {currentPrice < 0.001 ? currentPrice.toExponential(3) : currentPrice.toFixed(6)} ETH
            </span>
          )}
        </div>

        {/* Quick buy amounts */}
        <div className="grid grid-cols-4 gap-1.5">
          {['0.01', '0.05', '0.1', '0.5'].map((val) => (
            <Button
              key={val}
              variant="outline"
              size="sm"
              className="text-[10px] h-7 border-amber-200 dark:border-amber-700"
              onClick={() => {
                const url = `${swapUrl}&exactAmount=${val}&exactField=input`;
                openExternal(url);
              }}
            >
              {val} ETH
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
            onClick={() => openExternal(swapUrl)}
          >
            <ArrowUpDown className="h-3 w-3 mr-1" />
            Swap
          </Button>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          <Zap className="h-2.5 w-2.5" />
          LP locked forever
        </div>
      </div>
    );
  }

  // ─── Full mode ───────────────────────────────────────────────────────
  return (
    <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/20 dark:to-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            Buy ${pool.tokenSymbol}
          </span>
        </div>
        <Link to="/tokens/$address" params={{ address: pool.tokenAddress }}>
          <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-amber-200/50">
            Full Chart
          </Badge>
        </Link>
      </div>

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
              Balance: {Number(ethBalance.formatted).toFixed(4)}
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
            {formatTokenAmount(String(BigInt(Math.floor(estimatedTokens * 1e18))))} $
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

      <Button
        className="w-full h-11 bg-green-600 hover:bg-green-500 text-white font-bold"
        onClick={() => {
          const url = buyAmount ? `${swapUrl}&exactAmount=${buyAmount}&exactField=input` : swapUrl;
          openExternal(url);
        }}
        disabled={!buyAmount || Number(buyAmount) <= 0}
      >
        <ArrowUpDown className="h-4 w-4 mr-2" />
        Buy ${pool.tokenSymbol} on Uniswap
        <ExternalLink className="h-3 w-3 ml-2 opacity-50" />
      </Button>

      <p className="text-[10px] text-center text-muted-foreground">
        Swaps on Uniswap v4 — LP locked forever — No rugs
      </p>
    </div>
  );
}
