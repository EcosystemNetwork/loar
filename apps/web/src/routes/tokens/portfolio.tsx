/**
 * Token Portfolio — PnL tracker showing user's trade history,
 * positions, and realized gains/losses across universe tokens.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useIndexerPortfolio, useMySwapHistory, formatEth, timeAgo } from '@/hooks/useTokens';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Wallet,
  BarChart3,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Repeat,
} from 'lucide-react';
import { getExplorerTxUrl } from '@/configs/chains';
import { useChainId } from 'wagmi';

export const Route = createFileRoute('/tokens/portfolio')({
  component: PortfolioPage,
});

function PortfolioPage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: mySwaps, isLoading: swapsLoading } = useMySwapHistory(address, 50);
  const { data: portfolio, isLoading } = useIndexerPortfolio(address);

  const positions = portfolio.positions;
  const totalValue = portfolio.totalValue;
  const totalUnrealizedPnl = portfolio.totalUnrealizedPnL;
  const totalRealizedPnl = portfolio.totalRealizedPnL;
  const totalTrades = portfolio.totalTrades;

  if (!address) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="text-center py-12">
            <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">Connect Wallet</h2>
            <p className="text-muted-foreground mb-4">
              Connect your wallet to view your token portfolio and PnL.
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to="/tokens">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Launchpad
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Portfolio</h1>
            <p className="text-sm text-muted-foreground">Track your token trades and PnL</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Portfolio Value</p>
              <p className="text-2xl font-bold tabular-nums">
                {totalValue > 0 ? `${totalValue.toFixed(4)}` : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Realized PnL</p>
              <p
                className={`text-2xl font-bold tabular-nums ${
                  totalRealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {`${totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(4)}`}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Unrealized PnL</p>
              <p
                className={`text-2xl font-bold tabular-nums ${
                  totalUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {`${(totalUnrealizedPnl >= 0 ? '+' : '') + totalUnrealizedPnl.toFixed(4)}`}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Total Trades</p>
              <p className="text-2xl font-bold">{totalTrades}</p>
            </CardContent>
          </Card>
        </div>

        {/* Positions */}
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Positions
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : positions.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No trades yet</h3>
              <p className="text-muted-foreground mb-4">
                Start trading universe tokens to track your portfolio here.
              </p>
              <Link to="/tokens">
                <Button>Browse Tokens</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Header — hidden on mobile, visible on md+ */}
            <div className="hidden md:grid grid-cols-7 gap-2 text-[10px] text-muted-foreground font-semibold uppercase px-4 pb-1">
              <span className="col-span-2">Token</span>
              <span className="text-right">Holding</span>
              <span className="text-right">Avg Buy</span>
              <span className="text-right">Current</span>
              <span className="text-right">Value</span>
              <span className="text-right">PnL</span>
            </div>

            {positions.map((pos) => (
              <Link
                key={pos.tokenAddress}
                to="/tokens/$address"
                params={{ address: pos.tokenAddress }}
              >
                <Card className="hover:border-primary/50 transition-all cursor-pointer">
                  <CardContent className="p-3">
                    {/* Desktop: table row */}
                    <div className="hidden md:grid grid-cols-7 gap-2 items-center text-xs">
                      <div className="col-span-2 flex items-center gap-2">
                        {pos.imageURL && (
                          <img
                            src={pos.imageURL}
                            alt={pos.tokenSymbol}
                            className="w-8 h-8 rounded-lg object-cover"
                          />
                        )}
                        <div>
                          <p className="font-semibold">${pos.tokenSymbol}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {pos.tradeCount} trades
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-mono tabular-nums">
                          {pos.netTokens >= 1e9
                            ? `${(pos.netTokens / 1e9).toFixed(2)}B`
                            : pos.netTokens >= 1e6
                              ? `${(pos.netTokens / 1e6).toFixed(2)}M`
                              : pos.netTokens >= 1e3
                                ? `${(pos.netTokens / 1e3).toFixed(1)}K`
                                : pos.netTokens.toFixed(0)}
                        </p>
                      </div>

                      <div className="text-right font-mono tabular-nums text-[10px]">
                        {pos.avgBuyPrice < 0.001
                          ? pos.avgBuyPrice.toExponential(2)
                          : pos.avgBuyPrice.toFixed(8)}
                      </div>

                      <div className="text-right font-mono tabular-nums text-[10px]">
                        {pos.currentPrice != null
                          ? pos.currentPrice < 0.001
                            ? pos.currentPrice.toExponential(2)
                            : pos.currentPrice.toFixed(8)
                          : '--'}
                      </div>

                      <div className="text-right font-mono tabular-nums">
                        {pos.currentValue > 0 ? `${pos.currentValue.toFixed(4)}` : '--'}
                      </div>

                      <div className="text-right">
                        <span
                          className={`font-mono tabular-nums font-semibold ${
                            pos.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {pos.totalPnL >= 0 ? '+' : ''}
                          {pos.totalPnL.toFixed(4)}
                        </span>
                      </div>
                    </div>

                    {/* Mobile: compact card */}
                    <div className="md:hidden space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {pos.imageURL && (
                            <img
                              src={pos.imageURL}
                              alt={pos.tokenSymbol}
                              className="w-8 h-8 rounded-lg object-cover"
                            />
                          )}
                          <div>
                            <p className="font-semibold text-sm">${pos.tokenSymbol}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {pos.tradeCount} trades
                            </p>
                          </div>
                        </div>
                        <span
                          className={`font-mono tabular-nums font-semibold text-sm ${
                            pos.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {pos.totalPnL >= 0 ? '+' : ''}
                          {pos.totalPnL.toFixed(4)} ETH
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                        <div className="bg-muted/50 rounded px-1 py-1">
                          <p className="text-muted-foreground">Holding</p>
                          <p className="font-mono font-medium">
                            {pos.netTokens >= 1e9
                              ? `${(pos.netTokens / 1e9).toFixed(2)}B`
                              : pos.netTokens >= 1e6
                                ? `${(pos.netTokens / 1e6).toFixed(2)}M`
                                : pos.netTokens >= 1e3
                                  ? `${(pos.netTokens / 1e3).toFixed(1)}K`
                                  : pos.netTokens.toFixed(0)}
                          </p>
                        </div>
                        <div className="bg-muted/50 rounded px-1 py-1">
                          <p className="text-muted-foreground">Value</p>
                          <p className="font-mono font-medium">
                            {pos.currentValue > 0 ? `${pos.currentValue.toFixed(4)}` : '--'}
                          </p>
                        </div>
                        <div className="bg-muted/50 rounded px-1 py-1">
                          <p className="text-muted-foreground">Price</p>
                          <p className="font-mono font-medium">
                            {pos.currentPrice != null
                              ? pos.currentPrice < 0.001
                                ? pos.currentPrice.toExponential(1)
                                : pos.currentPrice.toFixed(6)
                              : '--'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* ── Swap History ──────────────────────────────────────────── */}
        <h2 className="text-lg font-semibold mb-4 mt-10 flex items-center gap-2">
          <Repeat className="h-5 w-5" />
          Swap history
        </h2>
        {swapsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !mySwaps?.length ? (
          <Card>
            <CardContent className="text-center py-10 text-sm text-muted-foreground">
              No on-chain swaps yet from this wallet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="grid grid-cols-6 gap-2 text-[10px] text-muted-foreground font-semibold uppercase px-4 py-2 border-b">
                <span>Type</span>
                <span>Amount0</span>
                <span>Amount1</span>
                <span>Pool</span>
                <span>Time</span>
                <span className="text-right">Tx</span>
              </div>
              <div className="divide-y divide-border">
                {mySwaps.map((swap) => {
                  const isBuy = BigInt(swap.amount0) > 0n;
                  const txHash = swap.id.split('-')[0] as `0x${string}` | undefined;
                  const explorerUrl = txHash ? getExplorerTxUrl(chainId, txHash) : null;
                  return (
                    <div
                      key={swap.id}
                      className="grid grid-cols-6 gap-2 items-center text-xs px-4 py-2 hover:bg-muted/30"
                    >
                      <Badge
                        variant={isBuy ? 'default' : 'destructive'}
                        className="text-[10px] w-fit px-1.5 py-0"
                      >
                        {isBuy ? 'BUY' : 'SELL'}
                      </Badge>
                      <span
                        className={`font-mono text-[10px] ${
                          BigInt(swap.amount0) > 0n ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {formatEth(swap.amount0)}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          BigInt(swap.amount1) > 0n ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {formatEth(swap.amount1)}
                      </span>
                      <span className="font-mono text-[10px] truncate">
                        {swap.poolId.slice(0, 10)}…
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(swap.timestamp)}
                      </span>
                      <div className="text-right">
                        {explorerUrl ? (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-0.5 text-[10px]"
                          >
                            View
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
