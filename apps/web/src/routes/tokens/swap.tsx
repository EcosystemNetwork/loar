/**
 * Token Swap Page — Dedicated in-app swap interface for universe governance tokens.
 *
 * Features:
 * - Token pair selector (ETH <-> governance token)
 * - Amount input with Max button
 * - Estimated output with slippage tolerance
 * - Price impact warnings (yellow >2%, red >5%)
 * - On-chain swap execution via LoarSwapRouter
 * - Transaction status feedback (pending, confirmed, failed)
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, useCallback } from 'react';
import {
  useTokenListData,
  usePoolData,
  priceFromSqrtX96,
  priceFromTick,
  formatTokenAmount,
  type EnrichedToken,
} from '@/hooks/useTokens';
import { useSwapExecution, type SwapConfig } from '@/hooks/useSwapExecution';
import { getSwapUrl } from '@/hooks/useTokenSwap';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowUpDown,
  ArrowLeft,
  ChevronDown,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Search,
  Settings2,
  Zap,
  Info,
  X,
} from 'lucide-react';
import { useChainId, useBalance } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { getExplorerTxUrl } from '@/configs/chains';
import { formatEther, type Address } from 'viem';
import { trpcClient } from '@/utils/trpc';

export const Route = createFileRoute('/tokens/swap')({
  component: SwapPage,
});

// ─── Slippage presets ──────────────────────────────────────────────────

const SLIPPAGE_PRESETS = [0.5, 1.0, 2.0];
const DEFAULT_SLIPPAGE = 0.5;

function SwapPage() {
  const chainId = useChainId();
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });

  // Token selection
  const { data: tokens, isLoading: tokensLoading } = useTokenListData();
  const [selectedTokenAddress, setSelectedTokenAddress] = useState<string | null>(null);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');

  // Swap state
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [showSettings, setShowSettings] = useState(false);
  const [customSlippage, setCustomSlippage] = useState('');

  // Swap execution
  const { executeSwap, status, txHash, error, isNativeSwapAvailable, reset } = useSwapExecution();

  // Selected token data
  const selectedToken = useMemo(() => {
    if (!selectedTokenAddress || !tokens?.length) return null;
    return tokens.find((t) => t.id.toLowerCase() === selectedTokenAddress.toLowerCase()) ?? null;
  }, [selectedTokenAddress, tokens]);

  // Pool data for the selected token
  const { data: poolData } = usePoolData(selectedToken?.poolId);

  // Current price from pool
  const currentPrice = useMemo(() => {
    if (poolData?.sqrtPriceX96) return priceFromSqrtX96(poolData.sqrtPriceX96);
    if (poolData?.tick != null) return priceFromTick(poolData.tick);
    if (selectedToken?.price) return selectedToken.price;
    return null;
  }, [poolData, selectedToken]);

  // Estimated output
  const estimatedOutput = useMemo(() => {
    if (!amount || !currentPrice || isNaN(Number(amount)) || Number(amount) <= 0) return null;
    const val = Number(amount);
    if (mode === 'buy') {
      return currentPrice > 0 ? val / currentPrice : 0;
    } else {
      return val * currentPrice;
    }
  }, [amount, currentPrice, mode]);

  // Minimum output after slippage
  const minimumOutput = useMemo(() => {
    if (!estimatedOutput) return null;
    return estimatedOutput * (1 - slippage / 100);
  }, [estimatedOutput, slippage]);

  // Price impact estimate (simplified — based on pool liquidity)
  const priceImpact = useMemo(() => {
    if (!amount || !currentPrice || !selectedToken) return null;
    const val = Number(amount);
    if (val <= 0 || !selectedToken.volume24h) return null;
    // Rough estimate: impact = trade_size / (daily_volume * 2)
    // This is a simplified heuristic; real impact requires on-chain simulation
    const tradeEth = mode === 'buy' ? val : val * currentPrice;
    const dailyVol = selectedToken.volume24h > 0 ? selectedToken.volume24h : 0.1;
    const impact = (tradeEth / (dailyVol * 2)) * 100;
    return Math.min(impact, 99);
  }, [amount, currentPrice, selectedToken, mode]);

  // Price impact severity
  const impactSeverity = useMemo(() => {
    if (priceImpact === null) return 'none';
    if (priceImpact > 5) return 'high';
    if (priceImpact > 2) return 'medium';
    return 'low';
  }, [priceImpact]);

  // Filtered tokens for selector
  const filteredTokens = useMemo(() => {
    if (!tokens?.length) return [];
    if (!tokenSearch) return tokens;
    const q = tokenSearch.toLowerCase();
    return tokens.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
    );
  }, [tokens, tokenSearch]);

  // Handle swap execution
  const handleSwap = useCallback(async () => {
    if (!selectedToken || !amount || Number(amount) <= 0) return;

    // Build pool key from pool data if available
    const poolKey: SwapConfig['poolKey'] = poolData
      ? {
          currency0: poolData.currency0 as Address,
          currency1: poolData.currency1 as Address,
          fee: poolData.fee,
          tickSpacing: poolData.tickSpacing,
          hooks: poolData.hooks as Address,
        }
      : null;

    // Expected output in wei: tokens (18 decimals) for buy, ETH (18 decimals) for sell.
    const expectedOutWei =
      estimatedOutput !== null && estimatedOutput > 0
        ? BigInt(Math.floor(estimatedOutput * 1e18))
        : undefined;

    const result = await executeSwap({
      tokenAddress: selectedToken.id,
      tokenSymbol: selectedToken.symbol,
      poolKey,
      mode,
      amount,
      slippageBps: Math.round(slippage * 100),
      expectedOutWei,
    });

    // Record trade for PnL tracking if native swap succeeded
    if (result && !result.fallback && result.txHash) {
      try {
        const ethAmt = Number(amount);
        const tokenAmt = estimatedOutput ?? 0;
        const price = currentPrice ?? 0;
        if (ethAmt > 0 && price > 0) {
          await trpcClient.tokenSocial.recordTrade.mutate({
            tokenAddress: selectedToken.id,
            tokenSymbol: selectedToken.symbol,
            type: mode,
            ethAmount: mode === 'buy' ? ethAmt : tokenAmt,
            tokenAmount: mode === 'buy' ? tokenAmt : ethAmt,
            pricePerToken: price,
            txHash: result.txHash,
          });
        }
      } catch {
        // PnL tracking is best-effort
      }
    }
  }, [selectedToken, amount, mode, slippage, poolData, executeSwap, estimatedOutput, currentPrice]);

  // Flip buy/sell
  const flipMode = useCallback(() => {
    setMode((prev) => (prev === 'buy' ? 'sell' : 'buy'));
    setAmount('');
    reset();
  }, [reset]);

  // Set slippage from presets or custom
  const handleSlippage = (val: number) => {
    setSlippage(val);
    setCustomSlippage('');
  };

  const handleCustomSlippage = (val: string) => {
    setCustomSlippage(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      setSlippage(parsed);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/tokens">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Swap</h1>
              <p className="text-sm text-muted-foreground">Trade universe governance tokens</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(!showSettings)}
            className="relative"
          >
            <Settings2 className="h-5 w-5" />
            {slippage !== DEFAULT_SLIPPAGE && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
            )}
          </Button>
        </div>

        {/* Slippage Settings Panel */}
        {showSettings && (
          <Card className="mb-4">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Slippage Tolerance</Label>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                {SLIPPAGE_PRESETS.map((val) => (
                  <Button
                    key={val}
                    variant={slippage === val && !customSlippage ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => handleSlippage(val)}
                  >
                    {val}%
                  </Button>
                ))}
                <div className="relative flex-1">
                  <Input
                    type="number"
                    placeholder="Custom"
                    value={customSlippage}
                    onChange={(e) => handleCustomSlippage(e.target.value)}
                    className="h-8 text-xs pr-6"
                    step="0.1"
                    min="0.1"
                    max="50"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
              {slippage > 5 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  High slippage may result in unfavorable trades
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main Swap Card */}
        <Card className="border-2">
          <CardContent className="p-5 space-y-4">
            {/* Native swap indicator */}
            {isNativeSwapAvailable && (
              <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
                <Zap className="h-2.5 w-2.5" />
                Native in-app swap via LoarSwapRouter
              </div>
            )}

            {/* ── You Pay Section ───────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="text-sm font-medium">
                  {mode === 'buy' ? 'You pay' : 'You sell'}
                </Label>
                {mode === 'buy' && ethBalance && (
                  <button
                    onClick={() => {
                      // Leave a little gas buffer
                      const bal = Number(ethBalance.formatted);
                      const maxSend = Math.max(bal - 0.005, 0);
                      setAmount(maxSend > 0 ? maxSend.toFixed(6) : '0');
                    }}
                    className="text-primary hover:underline text-xs font-medium"
                  >
                    Max: {Number(ethBalance.formatted).toFixed(4)} ETH
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    reset();
                  }}
                  className="h-14 text-xl font-mono pr-28"
                  step="any"
                  min="0"
                />
                {mode === 'buy' ? (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-blue-500">ETH</span>
                    </div>
                    <span className="text-sm font-semibold">ETH</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowTokenSelector(true)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-muted hover:bg-muted/80 rounded-full px-3 py-1.5 transition-colors"
                  >
                    {selectedToken ? (
                      <>
                        {selectedToken.imageURL && (
                          <img
                            src={selectedToken.imageURL}
                            alt={selectedToken.symbol}
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="text-sm font-semibold">${selectedToken.symbol}</span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">Select</span>
                    )}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* ── Flip Button ───────────────────────────────────────── */}
            <div className="flex justify-center -my-1">
              <button
                onClick={flipMode}
                className="p-2 rounded-xl border-2 bg-background hover:bg-muted transition-colors group"
              >
                <ArrowUpDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            </div>

            {/* ── You Receive Section ───────────────────────────────── */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {mode === 'buy' ? 'You receive' : 'You receive'}
              </Label>
              <div className="relative">
                <div className="h-14 rounded-md border bg-muted/30 flex items-center px-4">
                  <span className="text-xl font-mono text-foreground/80">
                    {estimatedOutput !== null && estimatedOutput > 0
                      ? mode === 'buy'
                        ? formatTokenAmount(String(BigInt(Math.floor(estimatedOutput * 1e18))))
                        : estimatedOutput.toFixed(6)
                      : '0.0'}
                  </span>
                </div>
                {mode === 'buy' ? (
                  <button
                    onClick={() => setShowTokenSelector(true)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-muted hover:bg-muted/80 rounded-full px-3 py-1.5 transition-colors"
                  >
                    {selectedToken ? (
                      <>
                        {selectedToken.imageURL && (
                          <img
                            src={selectedToken.imageURL}
                            alt={selectedToken.symbol}
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="text-sm font-semibold">${selectedToken.symbol}</span>
                      </>
                    ) : (
                      <span className="text-sm font-semibold text-primary">Select token</span>
                    )}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                ) : (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-blue-500">ETH</span>
                    </div>
                    <span className="text-sm font-semibold">ETH</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Trade Details ──────────────────────────────────────── */}
            {selectedToken && currentPrice && amount && Number(amount) > 0 && (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2 text-xs">
                {/* Rate */}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Rate</span>
                  <span className="font-mono">
                    1 ${selectedToken.symbol} ={' '}
                    {currentPrice < 0.001 ? currentPrice.toExponential(3) : currentPrice.toFixed(8)}{' '}
                    ETH
                  </span>
                </div>

                {/* Price Impact */}
                {priceImpact !== null && priceImpact > 0.01 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      Price Impact
                      {impactSeverity !== 'low' && (
                        <AlertTriangle
                          className={`h-3 w-3 ${
                            impactSeverity === 'high' ? 'text-red-500' : 'text-amber-500'
                          }`}
                        />
                      )}
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        impactSeverity === 'high'
                          ? 'text-red-500'
                          : impactSeverity === 'medium'
                            ? 'text-amber-500'
                            : 'text-green-500'
                      }`}
                    >
                      ~{priceImpact.toFixed(2)}%
                    </span>
                  </div>
                )}

                {/* Slippage */}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Slippage Tolerance</span>
                  <span className="font-mono">{slippage}%</span>
                </div>

                {/* Minimum received */}
                {minimumOutput !== null && minimumOutput > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Minimum received</span>
                    <span className="font-mono">
                      {mode === 'buy'
                        ? formatTokenAmount(String(BigInt(Math.floor(minimumOutput * 1e18))))
                        : minimumOutput.toFixed(6)}{' '}
                      {mode === 'buy' ? `$${selectedToken.symbol}` : 'ETH'}
                    </span>
                  </div>
                )}

                {/* Network */}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Network</span>
                  <span>
                    {chainId === 8453
                      ? 'Base'
                      : chainId === 84532
                        ? 'Base Sepolia'
                        : chainId === 11155111
                          ? 'Sepolia'
                          : `Chain ${chainId}`}
                  </span>
                </div>
              </div>
            )}

            {/* ── Price Impact Warning ──────────────────────────────── */}
            {impactSeverity === 'high' && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-600 dark:text-red-400">
                  <p className="font-semibold">High Price Impact</p>
                  <p>
                    This trade has an estimated price impact of ~{priceImpact?.toFixed(2)}%.
                    Consider reducing your trade size.
                  </p>
                </div>
              </div>
            )}
            {impactSeverity === 'medium' && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Moderate price impact (~{priceImpact?.toFixed(2)}%). You may receive fewer tokens
                  than expected.
                </p>
              </div>
            )}

            {/* ── Tx Status Feedback ────────────────────────────────── */}
            {status === 'pending' && txHash && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">Transaction pending...</p>
                  <a
                    href={getExplorerTxUrl(chainId, txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline flex items-center gap-1 mt-0.5"
                  >
                    View on explorer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
            {status === 'success' && txHash && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-600 dark:text-green-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">Swap confirmed!</p>
                  <a
                    href={getExplorerTxUrl(chainId, txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline flex items-center gap-1 mt-0.5"
                  >
                    View transaction
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
            {status === 'error' && error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {/* ── Swap Button ───────────────────────────────────────── */}
            {!address ? (
              <Button className="w-full h-12 text-base font-bold" disabled>
                Connect Wallet
              </Button>
            ) : !selectedToken ? (
              <Button
                className="w-full h-12 text-base font-bold"
                onClick={() => setShowTokenSelector(true)}
              >
                Select a token
              </Button>
            ) : (
              <Button
                className={`w-full h-12 text-base font-bold ${
                  mode === 'buy' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'
                }`}
                onClick={handleSwap}
                disabled={
                  !amount || Number(amount) <= 0 || status === 'confirming' || status === 'pending'
                }
              >
                {status === 'confirming' ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Confirm in wallet...
                  </>
                ) : status === 'pending' ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Pending...
                  </>
                ) : (
                  <>
                    <ArrowUpDown className="h-5 w-5 mr-2" />
                    {mode === 'buy'
                      ? `Buy $${selectedToken.symbol}`
                      : `Sell $${selectedToken.symbol}`}
                    {!isNativeSwapAvailable && <ExternalLink className="h-3 w-3 ml-2 opacity-50" />}
                  </>
                )}
              </Button>
            )}

            {/* ── Footer info ───────────────────────────────────────── */}
            <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
              <Info className="h-2.5 w-2.5" />
              {isNativeSwapAvailable
                ? 'Trades execute on-chain via LoarSwapRouter. LP is permanently locked.'
                : 'Swaps route through Uniswap v4. LP is permanently locked.'}
            </p>
          </CardContent>
        </Card>

        {/* Quick amounts */}
        {selectedToken && mode === 'buy' && (
          <div className="flex gap-2 mt-4">
            {['0.01', '0.05', '0.1', '0.5'].map((val) => (
              <Button
                key={val}
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-9"
                onClick={() => {
                  setAmount(val);
                  reset();
                }}
              >
                {val} ETH
              </Button>
            ))}
          </div>
        )}

        {/* Selected token info card */}
        {selectedToken && currentPrice && (
          <Card className="mt-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {selectedToken.imageURL && (
                    <img
                      src={selectedToken.imageURL}
                      alt={selectedToken.name}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  )}
                  <div>
                    <p className="font-semibold text-sm">{selectedToken.name}</p>
                    <p className="text-xs text-muted-foreground">${selectedToken.symbol}</p>
                  </div>
                </div>
                <Link to="/tokens/$address" params={{ address: selectedToken.id }}>
                  <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-muted">
                    Full Chart
                  </Badge>
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/50 rounded-md py-2">
                  <p className="text-xs font-bold font-mono tabular-nums">
                    {currentPrice < 0.001 ? currentPrice.toExponential(2) : currentPrice.toFixed(6)}
                  </p>
                  <p className="text-[9px] text-muted-foreground">Price (ETH)</p>
                </div>
                <div className="bg-muted/50 rounded-md py-2">
                  <p className="text-xs font-bold tabular-nums">{selectedToken.holderCount}</p>
                  <p className="text-[9px] text-muted-foreground">Holders</p>
                </div>
                <div className="bg-muted/50 rounded-md py-2">
                  <p className="text-xs font-bold tabular-nums">
                    {selectedToken.volume24h >= 0.001 ? selectedToken.volume24h.toFixed(3) : '--'}
                  </p>
                  <p className="text-[9px] text-muted-foreground">Vol 24h</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Token Selector Modal ──────────────────────────────────── */}
      {showTokenSelector && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowTokenSelector(false);
              setTokenSearch('');
            }}
          />
          <Card className="relative w-full max-w-md mx-4 max-h-[70vh] flex flex-col shadow-2xl">
            <CardContent className="p-0 flex flex-col">
              {/* Search header */}
              <div className="p-4 border-b">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Select a token</h3>
                  <button
                    onClick={() => {
                      setShowTokenSelector(false);
                      setTokenSearch('');
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, symbol, or address..."
                    value={tokenSearch}
                    onChange={(e) => setTokenSearch(e.target.value)}
                    className="pl-9"
                    autoFocus
                  />
                </div>
              </div>

              {/* Token list */}
              <div className="overflow-y-auto flex-1 max-h-[50vh]">
                {tokensLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredTokens.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    {tokenSearch ? 'No tokens match your search' : 'No tokens available'}
                  </div>
                ) : (
                  <div className="py-2">
                    {filteredTokens.map((token) => (
                      <button
                        key={token.id}
                        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left ${
                          selectedTokenAddress?.toLowerCase() === token.id.toLowerCase()
                            ? 'bg-primary/5'
                            : ''
                        }`}
                        onClick={() => {
                          setSelectedTokenAddress(token.id);
                          setShowTokenSelector(false);
                          setTokenSearch('');
                          setAmount('');
                          reset();
                        }}
                      >
                        {token.imageURL ? (
                          <img
                            src={token.imageURL}
                            alt={token.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-[10px] font-bold">
                              ${token.symbol.slice(0, 3)}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{token.name}</p>
                          <p className="text-xs text-muted-foreground">${token.symbol}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {token.price != null && (
                            <p className="text-xs font-mono tabular-nums">
                              {token.price < 0.001
                                ? token.price.toExponential(2)
                                : token.price.toFixed(6)}
                            </p>
                          )}
                          {token.priceChange24h !== null && (
                            <p
                              className={`text-[10px] font-mono ${
                                token.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
                              }`}
                            >
                              {token.priceChange24h >= 0 ? '+' : ''}
                              {token.priceChange24h.toFixed(1)}%
                            </p>
                          )}
                        </div>
                        {selectedTokenAddress?.toLowerCase() === token.id.toLowerCase() && (
                          <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
