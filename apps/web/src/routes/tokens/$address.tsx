/**
 * Token Detail Page — Full analytics, native swap, comments, holders,
 * candlestick chart, watchlist, share, creator link, maturity progress.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, useCallback } from 'react';
import {
  useTokenDetail,
  useSwapHistory,
  usePoolData,
  useUniverseForToken,
  useBondingCurveForToken,
  ethPricePerToken,
  ethPriceFromTick,
  formatTokenAmount,
  formatEth,
  timeAgo,
} from '@/hooks/useTokens';
import { getSwapUrl } from '@/hooks/useTokenSwap';
import { useSwapExecution } from '@/hooks/useSwapExecution';
import { CandlestickChart } from '@/components/tokens/CandlestickChart';
import { TokenComments } from '@/components/tokens/TokenComments';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Copy,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PieChart,
  TrendingUp,
  Users,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Share2,
  Star,
  StarOff,
  AlertTriangle,
  Clock,
  MessageCircle,
  Bookmark,
  User,
} from 'lucide-react';
import { useChainId, useBalance } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { getExplorerAddressUrl } from '@/configs/chains';
import { openExternal } from '@/utils/open-external';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { UniverseStakePanel } from '@/components/UniverseStakePanel';
import { LPYieldManager } from '@/components/LPYieldManager';
import { useUnstoppableDomain, formatDisplayName } from '@/hooks/useUnstoppableDomain';

export const Route = createFileRoute('/tokens/$address')({
  component: TokenDetailPage,
});

function TokenDetailPage() {
  const { address: tokenAddress } = Route.useParams();
  const chainId = useChainId();
  const { address: userAddress } = useAccount();
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const queryClient = useQueryClient();

  const { data: tokenData, isLoading: tokenLoading } = useTokenDetail(tokenAddress);
  const token = tokenData?.token;
  const holders = tokenData?.holders ?? [];

  const { data: pool } = usePoolData(token?.poolId);
  const { data: universe } = useUniverseForToken(token?.universeAddress);
  const { data: swaps, isLoading: swapsLoading } = useSwapHistory(token?.poolId, 200);
  const { data: bondingCurve } = useBondingCurveForToken(token?.id);

  // Watchlist state
  const { data: isWatching } = useQuery({
    queryKey: ['token-watching', tokenAddress],
    queryFn: () => trpcClient.tokenSocial.isWatching.query({ tokenAddress }),
    enabled: !!userAddress,
    staleTime: 30_000,
  });

  const watchMutation = useMutation({
    mutationFn: () =>
      isWatching
        ? trpcClient.tokenSocial.unwatch.mutate({ tokenAddress })
        : trpcClient.tokenSocial.watch.mutate({
            tokenAddress,
            tokenSymbol: token?.symbol,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['token-watching', tokenAddress] });
    },
  });

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const shareToken = () => {
    const url = window.location.href;
    const text = `Check out $${token?.symbol} on LOAR`;
    if (navigator.share) {
      navigator.share({ title: text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    }
  };

  // Which side of the pool holds our token — controls quote inversion and
  // which swap amount represents ETH. Defaults to currency0 until the pool
  // has been indexed so downstream memos stay stable.
  const tokenIsCurrency0 = useMemo(() => {
    if (!pool || !token) return true;
    return pool.currency0.toLowerCase() === token.id.toLowerCase();
  }, [pool, token]);

  // ETH-per-token quote; null for untraded pools so we render "--"
  // instead of a bogus 1.0.
  const currentPrice = useMemo(() => {
    if (!pool || !token) return null;
    return ethPricePerToken(pool, token.id);
  }, [pool, token]);

  // Chart data from swaps — quote each tick as ETH/token and pull the ETH
  // leg (amount1 when the token is currency0, else amount0).
  const chartData = useMemo(() => {
    if (!swaps?.length) return [];
    return swaps
      .slice()
      .reverse()
      .map((s) => {
        const ethAmountSigned = tokenIsCurrency0 ? BigInt(s.amount1) : BigInt(s.amount0);
        return {
          timestamp: s.timestamp,
          price: ethPriceFromTick(s.tick, tokenIsCurrency0),
          isBuy: ethAmountSigned > 0n,
          ethAmount: Math.abs(Number(ethAmountSigned)) / 1e18,
        };
      });
  }, [swaps, tokenIsCurrency0]);

  // 24h price change
  const priceChange = useMemo(() => {
    if (chartData.length < 2) return null;
    const latest = chartData[chartData.length - 1].price;
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const oldPrice = chartData.find((d) => d.timestamp >= oneDayAgo)?.price ?? chartData[0].price;
    if (oldPrice === 0) return null;
    return ((latest - oldPrice) / oldPrice) * 100;
  }, [chartData]);

  // Holder stats
  const holderStats = useMemo(() => {
    if (!holders.length) return { total: 0, topHolderPct: 0 };
    const totalSupply = 1_000_000_000n * 10n ** 18n;
    const topBalance = BigInt(holders[0]?.balance ?? '0');
    return {
      total: holders.length,
      topHolderPct: Number((topBalance * 10000n) / totalSupply) / 100,
    };
  }, [holders]);

  const marketCap = currentPrice != null ? currentPrice * 1_000_000_000 : null;
  const totalSwaps = swaps?.length ?? 0;

  // Maturity milestones
  const milestones = [
    { label: 'First trade', met: totalSwaps >= 1 },
    { label: '10 holders', met: holderStats.total >= 10 },
    { label: '50 swaps', met: totalSwaps >= 50 },
    { label: '100 holders', met: holderStats.total >= 100 },
    { label: '500 swaps', met: totalSwaps >= 500 },
  ];
  const milestonesCompleted = milestones.filter((m) => m.met).length;

  // Safety checks
  const safetyWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (holderStats.topHolderPct > 50) {
      warnings.push(`Top holder owns ${holderStats.topHolderPct.toFixed(1)}% of supply`);
    }
    if (token && totalSwaps < 5 && holderStats.total < 3) {
      warnings.push('Very early token — low liquidity and few holders');
    }
    return warnings;
  }, [holderStats, token, totalSwaps]);

  if (tokenLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="text-center py-12">
            <h2 className="text-xl font-bold mb-2">Token Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This token doesn't exist or hasn't been indexed yet.
            </p>
            <Link to="/tokens">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Launchpad
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const swapUrl = getSwapUrl(token.id, chainId);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <Link to="/tokens">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {token.imageURL && (
              <img
                src={token.imageURL}
                alt={token.name}
                className="w-10 h-10 rounded-full object-cover"
              />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{token.name}</h1>
                <Badge variant="outline">${token.symbol}</Badge>
                {priceChange !== null && (
                  <Badge variant={priceChange >= 0 ? 'default' : 'destructive'} className="text-xs">
                    {priceChange >= 0 ? (
                      <ArrowUpRight className="h-3 w-3 mr-0.5" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 mr-0.5" />
                    )}
                    {Math.abs(priceChange).toFixed(2)}%
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">
                  {token.id.slice(0, 10)}...{token.id.slice(-8)}
                </span>
                <button
                  onClick={() => copyAddress(token.id)}
                  className="hover:text-foreground transition-colors"
                >
                  {copiedAddress === token.id ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                <a
                  href={getExplorerAddressUrl(chainId, token.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Watchlist */}
            {userAddress && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => watchMutation.mutate()}
                disabled={watchMutation.isPending}
              >
                {isWatching ? (
                  <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                ) : (
                  <StarOff className="h-3.5 w-3.5" />
                )}
                {isWatching ? 'Watching' : 'Watch'}
              </Button>
            )}

            {/* Share */}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={shareToken}>
              <Share2 className="h-3.5 w-3.5" />
              {shareToast ? 'Copied!' : 'Share'}
            </Button>

            {/* Portfolio */}
            <Link to="/tokens/portfolio">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Bookmark className="h-3.5 w-3.5" />
                Portfolio
              </Button>
            </Link>

            {/* Universe */}
            {universe && (
              <Link to="/universe/$id/watch" params={{ id: token.universeAddress }}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  View Universe
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Safety Warnings */}
        {safetyWarnings.length > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                {safetyWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300">
                    {w}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Price</p>
              <p className="text-lg font-bold tabular-nums">
                {currentPrice
                  ? currentPrice < 0.001
                    ? currentPrice.toExponential(2)
                    : currentPrice.toFixed(6)
                  : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Market Cap</p>
              <p className="text-lg font-bold tabular-nums">
                {marketCap != null && marketCap > 0
                  ? marketCap >= 1000
                    ? `${(marketCap / 1000).toFixed(1)}K`
                    : marketCap.toFixed(2)
                  : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Holders</p>
              <p className="text-lg font-bold">{holderStats.total}</p>
              <p className="text-[10px] text-muted-foreground">addresses</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Swaps</p>
              <p className="text-lg font-bold">{totalSwaps}</p>
              <p className="text-[10px] text-muted-foreground">total trades</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Supply</p>
              <p className="text-lg font-bold">1B</p>
              <p className="text-[10px] text-muted-foreground">fixed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Launched</p>
              <p className="text-lg font-bold">{timeAgo(token.createdAt)}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(token.createdAt * 1000).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Chart + Trades + Comments */}
          <div className="lg:col-span-2 space-y-6">
            {/* Candlestick Chart */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Price History</h3>
                  </div>
                  {currentPrice && (
                    <span className="text-sm font-mono tabular-nums">
                      {currentPrice < 0.001
                        ? currentPrice.toExponential(3)
                        : currentPrice.toFixed(8)}{' '}
                      ETH
                    </span>
                  )}
                </div>
                <CandlestickChart data={chartData} />
              </CardContent>
            </Card>

            {/* Recent Trades */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Recent Trades</h3>
                  <div className="ml-auto h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                </div>

                {swapsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !swaps?.length ? (
                  <p className="text-center py-8 text-sm text-muted-foreground">No trades yet</p>
                ) : (
                  <div className="space-y-1 max-h-[400px] overflow-y-auto">
                    <div className="grid grid-cols-5 gap-2 text-[10px] text-muted-foreground font-semibold uppercase px-2 pb-1 border-b">
                      <span>Type</span>
                      <span>Amount</span>
                      <span>Price</span>
                      <span>Trader</span>
                      <span className="text-right">Time</span>
                    </div>
                    {swaps.slice(0, 50).map((swap) => {
                      // ETH side sign drives BUY/SELL — ETH flowing INTO the
                      // pool (positive) means the user is buying our token.
                      const ethAmountSigned = tokenIsCurrency0
                        ? BigInt(swap.amount1)
                        : BigInt(swap.amount0);
                      const isBuy = ethAmountSigned > 0n;
                      const ethAmountAbs =
                        ethAmountSigned < 0n ? -ethAmountSigned : ethAmountSigned;
                      return (
                        <div
                          key={swap.id}
                          className="grid grid-cols-5 gap-2 items-center text-xs px-2 py-1.5 rounded hover:bg-muted/50"
                        >
                          <Badge
                            variant={isBuy ? 'default' : 'destructive'}
                            className="text-[10px] w-fit px-1.5 py-0"
                          >
                            {isBuy ? 'BUY' : 'SELL'}
                          </Badge>
                          <span className="font-mono text-[10px] truncate">
                            {formatEth(ethAmountAbs.toString())}
                          </span>
                          <span className="font-mono text-[10px]">
                            {ethPriceFromTick(swap.tick, tokenIsCurrency0).toExponential(2)}
                          </span>
                          <AddressDisplay
                            address={swap.sender}
                            className="text-[10px] text-muted-foreground"
                          />
                          <span className="text-[10px] text-muted-foreground text-right">
                            {timeAgo(swap.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Comments */}
            <Card>
              <CardContent className="p-4">
                <TokenComments tokenAddress={tokenAddress} />
              </CardContent>
            </Card>
          </div>

          {/* Right: Swap + Info + Holders */}
          <div className="space-y-6">
            {/* Graduation Progress */}
            {bondingCurve && (
              <Card
                className={
                  bondingCurve.tradingStatus === 'halted'
                    ? 'border-red-500/40'
                    : bondingCurve.graduated
                      ? 'border-green-500/40'
                      : 'border-amber-500/30'
                }
              >
                <CardContent className="p-4 space-y-3">
                  {(() => {
                    const raised = Number(BigInt(bondingCurve.ethRaised)) / 1e18;
                    const target = Number(BigInt(bondingCurve.graduationEth)) / 1e18;
                    const pct = target > 0 ? Math.min((raised / target) * 100, 100) : 0;
                    const isHalted = bondingCurve.tradingStatus === 'halted';
                    const isGraduated = bondingCurve.graduated;
                    const isGraduating = !isGraduated && !isHalted && pct >= 75;

                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-primary" />
                          <h3 className="font-semibold text-sm">
                            {isHalted
                              ? 'Trading Halted'
                              : isGraduated
                                ? 'Graduated to Uniswap'
                                : isGraduating
                                  ? 'Graduating Soon'
                                  : 'Bonding Curve'}
                          </h3>
                          <Badge
                            variant={isHalted ? 'destructive' : isGraduated ? 'default' : 'outline'}
                            className="text-[10px] ml-auto"
                          >
                            {pct.toFixed(1)}%
                          </Badge>
                        </div>

                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isHalted
                                ? 'bg-red-500'
                                : isGraduated
                                  ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                                  : isGraduating
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                                    : 'bg-gradient-to-r from-primary to-purple-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Raised</span>
                          <span className="font-mono tabular-nums">
                            {raised.toFixed(4)} / {target.toFixed(2)} ETH
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Trades</span>
                          <span className="font-mono tabular-nums">{bondingCurve.tradeCount}</span>
                        </div>

                        {isHalted && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed">
                            Trading on this bonding curve is currently halted by governance. It will
                            resume after the 48-hour timelock unless otherwise directed.
                          </p>
                        )}
                        {isGraduating && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                            Approaching graduation. Once ETH raised hits the target, unsold tokens
                            and raised ETH seed a permanent Uniswap v4 pool.
                          </p>
                        )}
                        {isGraduated && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            This token graduated and now trades on Uniswap v4 with permanently
                            locked liquidity.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Swap Card */}
            <Card className="border-primary/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <ArrowUpDown className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Trade ${token.symbol}</h3>
                </div>
                <SwapInterface
                  tokenAddress={token.id}
                  tokenSymbol={token.symbol}
                  swapUrl={swapUrl}
                  currentPrice={currentPrice}
                  poolData={pool}
                />
              </CardContent>
            </Card>

            {/* Universe Staking — earn yield */}
            {universe?.universeId != null && (
              <UniverseStakePanel
                universeId={Number(universe.universeId)}
                universeName={universe.name || token.name}
              />
            )}

            {/* LP Yield & Fee Management — creator only */}
            {userAddress &&
              token.tokenAdmin &&
              token.tokenAdmin.toLowerCase() === userAddress.toLowerCase() && (
                <LPYieldManager
                  tokenAddress={token.id as `0x${string}`}
                  universeName={universe?.name || token.name}
                  onChainUniverseId={
                    universe?.universeId != null ? Number(universe.universeId) : undefined
                  }
                />
              )}

            {/* Token Maturity */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Token Maturity</h3>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {milestonesCompleted}/{milestones.length}
                  </Badge>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full rounded-full transition-all bg-gradient-to-r from-amber-500 via-green-500 to-emerald-500"
                    style={{ width: `${(milestonesCompleted / milestones.length) * 100}%` }}
                  />
                </div>
                <div className="space-y-2">
                  {milestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                          m.met ? 'bg-green-500 text-white' : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {m.met ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <span className="text-[9px]">{i + 1}</span>
                        )}
                      </div>
                      <span className={m.met ? 'text-foreground' : 'text-muted-foreground'}>
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Creator Info */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Creator
                </h3>
                <Link to="/tokens/creator/$address" params={{ address: token.deployer }}>
                  <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <AddressDisplay
                        address={token.deployer}
                        className="text-xs"
                        truncate={false}
                      />
                      <p className="text-[10px] text-muted-foreground">View all tokens</p>
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                </Link>
              </CardContent>
            </Card>

            {/* Token Info */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Token Info
                </h3>
                <div className="space-y-2 text-xs">
                  <InfoRow
                    label="Contract"
                    value={token.id}
                    copyable
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Pool"
                    value={token.poolId}
                    copyable
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Deployer"
                    value={token.deployer}
                    copyable
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Creator"
                    value={token.tokenAdmin}
                    copyable
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Locker"
                    value={token.locker}
                    copyable
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <Zap className="h-2.5 w-2.5" /> LP Locked Forever
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <Users className="h-2.5 w-2.5" /> Governance Token
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <Clock className="h-2.5 w-2.5" /> Creator Vested
                  </Badge>
                </div>

                {/* LP Lock Permanence Disclosure */}
                <div className="mt-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                        Permanent Liquidity Lock
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        This token's liquidity pool is{' '}
                        <span className="font-semibold">permanently locked on-chain</span> and
                        cannot be withdrawn by anyone — including the token creator and the LOAR
                        platform. This is enforced by the LoarLpLocker smart contract and is{' '}
                        <span className="font-semibold">irreversible</span>. There is no admin key,
                        timelock, or governance mechanism that can unlock it.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Holder Distribution */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <PieChart className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Top Holders</h3>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {holderStats.total}
                  </Badge>
                </div>
                {holders.length === 0 ? (
                  <p className="text-center py-4 text-xs text-muted-foreground">
                    No holders indexed yet
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    {holders.slice(0, 20).map((holder, i) => {
                      const totalSupply = 1_000_000_000n * 10n ** 18n;
                      const pct = Number((BigInt(holder.balance) * 10000n) / totalSupply) / 100;
                      const isHighConcentration = pct > 30;
                      return (
                        <div key={holder.id} className="flex items-center gap-2 text-xs">
                          <span className="w-5 text-muted-foreground text-right">#{i + 1}</span>
                          <AddressDisplay
                            address={holder.holderAddress}
                            className="flex-1 truncate text-[10px]"
                          />
                          <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isHighConcentration ? 'bg-amber-500' : 'bg-primary'
                              }`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span
                            className={`w-14 text-right tabular-nums font-medium ${
                              isHighConcentration ? 'text-amber-500' : ''
                            }`}
                          >
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Universe Card */}
            {universe && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-sm mb-3">Universe</h3>
                  <Link to="/universe/$id/watch" params={{ id: token.universeAddress }}>
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                      {universe.imageURL && (
                        <img
                          src={universe.imageURL}
                          alt={universe.name}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{universe.name}</p>
                        <p className="text-xs text-muted-foreground">{universe.nodeCount} events</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Swap Interface ───────────────────────────────────────────────────

function SwapInterface({
  tokenAddress,
  tokenSymbol,
  swapUrl,
  currentPrice,
  poolData,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  swapUrl: string;
  currentPrice: number | null;
  poolData?: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  } | null;
}) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });
  const { executeSwap, status, txHash, error, isNativeSwapAvailable, reset } = useSwapExecution();

  const estimatedOutput = useMemo(() => {
    if (!amount || !currentPrice || isNaN(Number(amount))) return null;
    const val = Number(amount);
    if (mode === 'buy') {
      return currentPrice > 0 ? val / currentPrice : 0;
    } else {
      return val * currentPrice;
    }
  }, [amount, currentPrice, mode]);

  const handleSwap = async () => {
    const poolKey = poolData
      ? {
          currency0: poolData.currency0 as `0x${string}`,
          currency1: poolData.currency1 as `0x${string}`,
          fee: poolData.fee,
          tickSpacing: poolData.tickSpacing,
          hooks: poolData.hooks as `0x${string}`,
        }
      : null;

    const expectedOutWei =
      estimatedOutput !== null && estimatedOutput > 0
        ? BigInt(Math.floor(estimatedOutput * 1e18))
        : undefined;

    const result = await executeSwap({
      tokenAddress,
      tokenSymbol,
      poolKey,
      mode,
      amount,
      slippageBps: 100, // 1% default for inline widget
      expectedOutWei,
    });

    if (result && !result.fallback && result.txHash) {
      // Record trade for PnL tracking
      try {
        const ethAmt = Number(amount);
        const tokenAmt = estimatedOutput ?? 0;
        const price = currentPrice ?? 0;
        if (ethAmt > 0 && price > 0) {
          await trpcClient.tokenSocial.recordTrade.mutate({
            tokenAddress,
            tokenSymbol,
            type: mode,
            ethAmount: ethAmt,
            tokenAmount: mode === 'buy' ? tokenAmt : ethAmt,
            pricePerToken: price,
            txHash: result.txHash,
          });
        }
      } catch {
        // PnL tracking is best-effort
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Native swap badge */}
      {isNativeSwapAvailable && (
        <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
          <Zap className="h-2.5 w-2.5" />
          Native swap — trades execute in-app
        </div>
      )}

      {/* Buy/Sell Toggle */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
        <button
          onClick={() => {
            setMode('buy');
            reset();
          }}
          className={`py-2 text-sm font-semibold rounded-md transition-all ${
            mode === 'buy'
              ? 'bg-green-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => {
            setMode('sell');
            reset();
          }}
          className={`py-2 text-sm font-semibold rounded-md transition-all ${
            mode === 'sell'
              ? 'bg-red-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <Label className="text-xs font-medium">{mode === 'buy' ? 'You pay' : 'You sell'}</Label>
          {mode === 'buy' && ethBalance && (
            <button
              onClick={() => setAmount(ethBalance.formatted)}
              className="text-muted-foreground hover:text-foreground text-[10px]"
            >
              Balance: {Number(ethBalance.formatted).toFixed(4)} ETH
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
            className="h-12 text-lg font-mono pr-16"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
            {mode === 'buy' ? 'ETH' : `$${tokenSymbol}`}
          </span>
        </div>
      </div>

      {/* Estimated Output */}
      {estimatedOutput !== null && estimatedOutput > 0 && (
        <div className="p-3 bg-muted/50 rounded-lg space-y-1">
          <p className="text-xs text-muted-foreground">
            Estimated {mode === 'buy' ? 'tokens' : 'ETH'} received
          </p>
          <p className="text-sm font-bold font-mono">
            {mode === 'buy'
              ? formatTokenAmount(String(BigInt(Math.floor(estimatedOutput * 1e18))))
              : `${estimatedOutput.toFixed(6)} ETH`}
          </p>
          {currentPrice && (
            <p className="text-[10px] text-muted-foreground">
              1 ${tokenSymbol} ={' '}
              {currentPrice < 0.001 ? currentPrice.toExponential(3) : currentPrice.toFixed(8)} ETH
            </p>
          )}
        </div>
      )}

      {/* Quick amounts */}
      {mode === 'buy' && (
        <div className="flex gap-2">
          {['0.01', '0.05', '0.1', '0.5'].map((val) => (
            <Button
              key={val}
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={() => setAmount(val)}
            >
              {val} ETH
            </Button>
          ))}
        </div>
      )}

      {/* Tx status */}
      {(status === 'approving' || status === 'approval-pending') && (
        <div className="p-2 bg-blue-500/10 rounded-lg text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          {status === 'approving' ? `Approve $${tokenSymbol} in wallet…` : 'Waiting for approval…'}
        </div>
      )}
      {status === 'pending' && txHash && (
        <div className="p-2 bg-blue-500/10 rounded-lg text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Transaction pending...
        </div>
      )}
      {status === 'error' && error && (
        <div className="p-2 bg-red-500/10 rounded-lg text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Swap Button */}
      <Button
        className={`w-full h-12 text-base font-bold ${
          mode === 'buy' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'
        }`}
        onClick={handleSwap}
        disabled={
          !amount ||
          Number(amount) <= 0 ||
          status === 'confirming' ||
          status === 'pending' ||
          status === 'approving' ||
          status === 'approval-pending'
        }
      >
        {status === 'confirming' || status === 'approving' || status === 'approval-pending' ? (
          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
        ) : (
          <ArrowUpDown className="h-5 w-5 mr-2" />
        )}
        {mode === 'buy' ? `Buy $${tokenSymbol}` : `Sell $${tokenSymbol}`}
        {!isNativeSwapAvailable && <ExternalLink className="h-3 w-3 ml-2 opacity-50" />}
      </Button>

      <p className="text-[10px] text-center text-muted-foreground">
        {isNativeSwapAvailable
          ? 'Swaps execute on-chain via LoarSwapRouter. LP is permanently locked.'
          : 'Swaps execute on Uniswap v4. LP is permanently locked.'}
      </p>
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  copyable,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  onCopy?: (addr: string) => void;
  copied?: string | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px]">
          {value.slice(0, 8)}...{value.slice(-6)}
        </span>
        {copyable && onCopy && (
          <button onClick={() => onCopy(value)} className="hover:text-foreground transition-colors">
            {copied === value ? (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
