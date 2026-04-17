/**
 * Token Portfolio — PnL tracker showing user's trade history,
 * positions, and realized gains/losses across universe tokens.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useTokenListData, timeAgo } from '@/hooks/useTokens';
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
} from 'lucide-react';
import { useMemo } from 'react';

export const Route = createFileRoute('/tokens/portfolio')({
  component: PortfolioPage,
});

function PortfolioPage() {
  const { address } = useAccount();
  const { data: allTokens } = useTokenListData();

  const { data: portfolio, isLoading } = useQuery({
    queryKey: ['token-portfolio'],
    queryFn: () => trpcClient.tokenSocial.getPortfolio.query(),
    enabled: !!address,
    staleTime: 30_000,
  });

  // Enrich positions with current prices
  const enrichedPositions = useMemo(() => {
    if (!portfolio?.positions || !allTokens.length) return [];
    return portfolio.positions.map((pos) => {
      const token = allTokens.find((t) => t.id.toLowerCase() === pos.tokenAddress.toLowerCase());
      const currentPrice = token?.price ?? null;
      const unrealizedPnl =
        currentPrice != null && pos.netTokens > 0
          ? pos.netTokens * currentPrice - pos.netTokens * pos.avgBuyPrice
          : 0;
      const currentValue = currentPrice != null ? pos.netTokens * currentPrice : 0;
      return {
        ...pos,
        token,
        currentPrice,
        unrealizedPnl,
        currentValue,
        totalPnl: pos.realizedPnl + unrealizedPnl,
      };
    });
  }, [portfolio, allTokens]);

  const totalUnrealizedPnl = enrichedPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalValue = enrichedPositions.reduce((sum, p) => sum + p.currentValue, 0);

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
                  (portfolio?.totalRealizedPnl ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {portfolio
                  ? `${(portfolio.totalRealizedPnl >= 0 ? '+' : '') + portfolio.totalRealizedPnl.toFixed(4)}`
                  : '--'}
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
              <p className="text-2xl font-bold">{portfolio?.totalTrades ?? 0}</p>
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
        ) : enrichedPositions.length === 0 ? (
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

            {enrichedPositions.map((pos) => (
              <Link
                key={pos.tokenAddress}
                to="/tokens/$address"
                params={{ address: pos.tokenAddress }}
              >
                <Card className="hover:border-primary/50 transition-all cursor-pointer">
                  <CardContent className="p-3">
                    <div className="grid grid-cols-7 gap-2 items-center text-xs">
                      <div className="col-span-2 flex items-center gap-2">
                        {pos.token?.imageURL && (
                          <img
                            src={pos.token.imageURL}
                            alt={pos.tokenSymbol}
                            className="w-8 h-8 rounded-lg object-cover"
                          />
                        )}
                        <div>
                          <p className="font-semibold">${pos.tokenSymbol}</p>
                          <p className="text-[10px] text-muted-foreground">{pos.trades} trades</p>
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
                            pos.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {pos.totalPnl >= 0 ? '+' : ''}
                          {pos.totalPnl.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
