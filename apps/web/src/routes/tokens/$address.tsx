/**
 * Token Detail Page — Analytics, swap interface, holders, and activity feed.
 *
 * /tokens/:address — Deep dive into a universe token with price chart,
 * holder distribution, and integrated swap widget.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import {
  useTokenDetail,
  useSwapHistory,
  usePoolData,
  useUniverseForToken,
  priceFromSqrtX96,
  priceFromTick,
  formatTokenAmount,
  formatEth,
  timeAgo,
} from '@/hooks/useTokens';
import { getSwapUrl } from '@/hooks/useTokenSwap';
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
  Flame,
  Loader2,
  PieChart,
  TrendingUp,
  Users,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useChainId, useAccount, useBalance } from 'wagmi';
import { getExplorerAddressUrl } from '@/configs/chains';

export const Route = createFileRoute('/tokens/$address')({
  component: TokenDetailPage,
});

function TokenDetailPage() {
  const { address: tokenAddress } = Route.useParams();
  const chainId = useChainId();
  const { address: userAddress } = useAccount();
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const { data: tokenData, isLoading: tokenLoading } = useTokenDetail(tokenAddress);
  const token = tokenData?.token;
  const holders = tokenData?.holders ?? [];

  const { data: pool } = usePoolData(token?.poolId);
  const { data: universe } = useUniverseForToken(token?.universeAddress);
  const { data: swaps, isLoading: swapsLoading } = useSwapHistory(token?.poolId, 100);

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  // Calculate current price from pool data
  const currentPrice = useMemo(() => {
    if (pool?.sqrtPriceX96) return priceFromSqrtX96(pool.sqrtPriceX96);
    if (pool?.tick != null) return priceFromTick(pool.tick);
    return null;
  }, [pool]);

  // Price chart data from swaps
  const chartData = useMemo(() => {
    if (!swaps?.length) return [];
    return swaps
      .slice()
      .reverse()
      .map((s) => ({
        timestamp: s.timestamp,
        price: priceFromTick(s.tick),
        isBuy: BigInt(s.amount0) > 0n,
      }));
  }, [swaps]);

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
    const totalSupply = 100_000_000_000n * 10n ** 18n;
    const topBalance = BigInt(holders[0]?.balance ?? '0');
    return {
      total: holders.length,
      topHolderPct: Number((topBalance * 10000n) / totalSupply) / 100,
    };
  }, [holders]);

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
        <div className="flex items-center gap-4 mb-6">
          <Link to="/tokens">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-3 flex-1">
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
          {universe && (
            <Link to="/universe/$id" params={{ id: token.universeAddress }}>
              <Button variant="outline" size="sm" className="gap-2">
                View Universe
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Price</p>
              <p className="text-lg font-bold tabular-nums">
                {currentPrice
                  ? `${currentPrice < 0.001 ? currentPrice.toExponential(2) : currentPrice.toFixed(6)}`
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
              <p className="text-lg font-bold">{swaps?.length ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">total trades</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Supply</p>
              <p className="text-lg font-bold">100B</p>
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
          {/* Left: Chart + Activity */}
          <div className="lg:col-span-2 space-y-6">
            {/* Price Chart */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
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

                {/* Simple bar chart from swap data */}
                {chartData.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                    No trading activity yet
                  </div>
                ) : (
                  <div className="h-48 flex items-end gap-px">
                    {chartData.slice(-60).map((d, i) => {
                      const maxPrice = Math.max(...chartData.slice(-60).map((c) => c.price));
                      const minPrice = Math.min(...chartData.slice(-60).map((c) => c.price));
                      const range = maxPrice - minPrice || 1;
                      const height = ((d.price - minPrice) / range) * 100;

                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-t-sm transition-all ${d.isBuy ? 'bg-green-500/80' : 'bg-red-500/80'} hover:opacity-70`}
                          style={{ height: `${Math.max(height, 4)}%` }}
                          title={`${new Date(d.timestamp * 1000).toLocaleString()}\nPrice: ${d.price.toExponential(3)} ETH\n${d.isBuy ? 'Buy' : 'Sell'}`}
                        />
                      );
                    })}
                  </div>
                )}
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
                    {/* Header */}
                    <div className="grid grid-cols-5 gap-2 text-[10px] text-muted-foreground font-semibold uppercase px-2 pb-1 border-b">
                      <span>Type</span>
                      <span>Amount</span>
                      <span>Price</span>
                      <span>Trader</span>
                      <span className="text-right">Time</span>
                    </div>
                    {swaps.slice(0, 50).map((swap) => {
                      const isBuy = BigInt(swap.amount0) > 0n;
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
                            {formatEth(isBuy ? swap.amount1 : swap.amount0)}
                          </span>
                          <span className="font-mono text-[10px]">
                            {priceFromTick(swap.tick).toExponential(2)}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {swap.sender.slice(0, 6)}...{swap.sender.slice(-4)}
                          </span>
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
          </div>

          {/* Right: Swap + Holders */}
          <div className="space-y-6">
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
                />
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
                      const totalSupply = 100_000_000_000n * 10n ** 18n;
                      const pct = Number((BigInt(holder.balance) * 10000n) / totalSupply) / 100;
                      return (
                        <div key={holder.id} className="flex items-center gap-2 text-xs">
                          <span className="w-5 text-muted-foreground text-right">#{i + 1}</span>
                          <span className="font-mono flex-1 truncate text-[10px]">
                            {holder.holderAddress.slice(0, 8)}...{holder.holderAddress.slice(-6)}
                          </span>
                          <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="w-14 text-right tabular-nums font-medium">
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
                  <Link to="/universe/$id" params={{ id: token.universeAddress }}>
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

// ─── Swap Interface ────────────────────────────────────────────────────

function SwapInterface({
  tokenAddress,
  tokenSymbol,
  swapUrl,
  currentPrice,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  swapUrl: string;
  currentPrice: number | null;
}) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });

  const estimatedOutput = useMemo(() => {
    if (!amount || !currentPrice || isNaN(Number(amount))) return null;
    const val = Number(amount);
    if (mode === 'buy') {
      // ETH in -> tokens out
      return currentPrice > 0 ? val / currentPrice : 0;
    } else {
      // tokens in -> ETH out
      return val * currentPrice;
    }
  }, [amount, currentPrice, mode]);

  return (
    <div className="space-y-4">
      {/* Buy/Sell Toggle */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
        <button
          onClick={() => setMode('buy')}
          className={`py-2 text-sm font-semibold rounded-md transition-all ${
            mode === 'buy'
              ? 'bg-green-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setMode('sell')}
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
            onChange={(e) => setAmount(e.target.value)}
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

      {/* Swap Button — links to Uniswap with pre-filled amounts */}
      <Button
        className={`w-full h-12 text-base font-bold ${mode === 'buy' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'}`}
        onClick={() => {
          const url =
            mode === 'buy'
              ? `${swapUrl}${amount ? `&exactAmount=${amount}&exactField=input` : ''}`
              : `${swapUrl.replace('inputCurrency=ETH&outputCurrency=', `inputCurrency=${tokenAddress}&outputCurrency=`).replace(`outputCurrency=${tokenAddress}`, 'outputCurrency=ETH')}${amount ? `&exactAmount=${amount}&exactField=input` : ''}`;
          window.open(url, '_blank');
        }}
        disabled={!amount || Number(amount) <= 0}
      >
        <ArrowUpDown className="h-5 w-5 mr-2" />
        {mode === 'buy' ? `Buy $${tokenSymbol}` : `Sell $${tokenSymbol}`}
        <ExternalLink className="h-3 w-3 ml-2 opacity-50" />
      </Button>

      <p className="text-[10px] text-center text-muted-foreground">
        Swaps execute on Uniswap v4. LP is permanently locked.
      </p>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────

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
