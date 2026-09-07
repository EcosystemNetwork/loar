/**
 * Creator Profile — Shows all tokens launched by a specific wallet address,
 * with aggregate stats (total volume, holders, tokens launched).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTokenListData, timeAgo } from '@/hooks/useTokens';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Copy,
  CheckCircle2,
  ExternalLink,
  Rocket,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useState } from 'react';
import { useChainId } from 'wagmi';
import { getExplorerAddressUrl } from '@/configs/chains';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';

export const Route = createFileRoute('/tokens/creator/$address')({
  component: CreatorProfilePage,
});

function CreatorProfilePage() {
  const { address: creatorAddress } = Route.useParams();
  const chainId = useChainId();
  const { data: allTokens, isLoading } = useTokenListData();
  const [copied, setCopied] = useState(false);

  const creatorTokens = useMemo(() => {
    return allTokens
      .filter(
        (t) =>
          t.deployer.toLowerCase() === creatorAddress.toLowerCase() ||
          t.tokenAdmin.toLowerCase() === creatorAddress.toLowerCase()
      )
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  }, [allTokens, creatorAddress]);

  const stats = useMemo(() => {
    const totalHolders = creatorTokens.reduce((sum, t) => sum + t.holderCount, 0);
    const totalSwaps = creatorTokens.reduce((sum, t) => sum + t.totalSwaps, 0);
    const totalVolume = creatorTokens.reduce((sum, t) => sum + t.volume24h, 0);
    const totalMarketCap = creatorTokens.reduce((sum, t) => sum + (t.marketCap ?? 0), 0);
    const totalLiquidity = creatorTokens.reduce((sum, t) => sum + t.liquidityEth, 0);
    // Graduation success rate — of the tokens that left the bonding curve.
    const withCurve = creatorTokens.filter((t) => t.bondingCurve);
    const graduated = creatorTokens.filter(
      (t) => t.stage === 'graduated' || t.bondingCurve?.graduated
    ).length;
    const successRate = creatorTokens.length ? (graduated / creatorTokens.length) * 100 : 0;
    const avgHolders = creatorTokens.length ? Math.round(totalHolders / creatorTokens.length) : 0;
    const best = creatorTokens[0] ?? null;
    return {
      totalHolders,
      totalSwaps,
      totalVolume,
      totalMarketCap,
      totalLiquidity,
      graduated,
      haltedCount: creatorTokens.filter((t) => t.stage === 'halted').length,
      onCurve: withCurve.length - graduated,
      successRate,
      avgHolders,
      best,
    };
  }, [creatorTokens]);

  const copyAddress = () => {
    navigator.clipboard.writeText(creatorAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        </div>

        {/* Creator Info */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/30 to-purple-500/30 flex items-center justify-center">
            <Rocket className="h-8 w-8 text-primary/60" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Token Creator</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AddressDisplay address={creatorAddress} showAvatar className="text-sm" />
              <button onClick={copyAddress} className="hover:text-foreground transition-colors">
                {copied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <a
                href={getExplorerAddressUrl(chainId, creatorAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Tokens Launched</p>
              <p className="text-xl font-bold">{creatorTokens.length}</p>
              <p className="text-[10px] text-muted-foreground">
                {stats.graduated} graduated
                {stats.haltedCount > 0 && ` · ${stats.haltedCount} halted`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Graduation Rate</p>
              <p
                className={`text-xl font-bold ${
                  stats.successRate >= 50
                    ? 'text-green-500'
                    : stats.successRate > 0
                      ? 'text-amber-500'
                      : ''
                }`}
              >
                {creatorTokens.length ? `${stats.successRate.toFixed(0)}%` : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">of launches</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total MCap</p>
              <p className="text-xl font-bold">
                {stats.totalMarketCap > 0
                  ? stats.totalMarketCap >= 1000
                    ? `${(stats.totalMarketCap / 1000).toFixed(1)}K`
                    : stats.totalMarketCap.toFixed(2)
                  : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Liquidity</p>
              <p className="text-xl font-bold">
                {stats.totalLiquidity >= 0.001 ? stats.totalLiquidity.toFixed(2) : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Holders</p>
              <p className="text-lg font-bold">{stats.totalHolders}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Avg Holders / Token</p>
              <p className="text-lg font-bold">{stats.avgHolders}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Swaps</p>
              <p className="text-lg font-bold">{stats.totalSwaps}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">24h Volume</p>
              <p className="text-lg font-bold">
                {stats.totalVolume >= 0.001 ? `${stats.totalVolume.toFixed(3)}` : '--'}
              </p>
              <p className="text-[10px] text-muted-foreground">ETH</p>
            </CardContent>
          </Card>
        </div>

        {/* Best performer */}
        {stats.best && (stats.best.marketCap ?? 0) > 0 && (
          <Link to="/tokens/$address" params={{ address: stats.best.id }} className="mb-8 block">
            <Card className="border-primary/30 bg-primary/5 transition-colors hover:border-primary/60">
              <CardContent className="flex items-center gap-3 p-4">
                <Badge className="bg-primary/80 text-[10px] text-white">Top token</Badge>
                {stats.best.imageURL && (
                  <img
                    src={stats.best.imageURL}
                    alt={stats.best.symbol}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {stats.best.name}{' '}
                    <span className="text-muted-foreground">${stats.best.symbol}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {stats.best.holderCount} holders · {stats.best.totalSwaps} swaps
                  </p>
                </div>
                <p className="font-mono text-sm font-bold tabular-nums">
                  {(stats.best.marketCap ?? 0) >= 1000
                    ? `${((stats.best.marketCap ?? 0) / 1000).toFixed(1)}K`
                    : (stats.best.marketCap ?? 0).toFixed(2)}{' '}
                  ETH
                </p>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Token List */}
        <h2 className="text-lg font-semibold mb-4">Launched Tokens</h2>
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : creatorTokens.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-muted-foreground">No tokens launched by this address</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {creatorTokens.map((token) => (
              <Link key={token.id} to="/tokens/$address" params={{ address: token.id }}>
                <Card className="hover:border-primary/50 transition-all cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {token.imageURL ? (
                        <img
                          src={token.imageURL}
                          alt={token.name}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                          <span className="text-lg font-bold text-primary/40">
                            ${token.symbol.charAt(0)}
                          </span>
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{token.name}</h3>
                          <Badge variant="outline" className="text-[10px]">
                            ${token.symbol}
                          </Badge>
                          <Badge
                            className={`text-[9px] px-1.5 py-0 border-0 ${
                              token.stage === 'graduated'
                                ? 'bg-green-500/80 text-white'
                                : token.stage === 'graduating'
                                  ? 'bg-amber-500/80 text-white'
                                  : token.stage === 'halted'
                                    ? 'bg-red-500/80 text-white'
                                    : 'bg-primary/80 text-white'
                            }`}
                          >
                            {token.stage}
                          </Badge>
                          {token.priceChange24h !== null && (
                            <Badge
                              variant={token.priceChange24h >= 0 ? 'default' : 'destructive'}
                              className="text-[10px]"
                            >
                              {token.priceChange24h >= 0 ? (
                                <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                              ) : (
                                <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />
                              )}
                              {Math.abs(token.priceChange24h).toFixed(1)}%
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Launched {timeAgo(token.createdAt)}
                        </p>
                      </div>

                      <div className="flex items-center gap-6 text-xs">
                        <div className="text-center">
                          <p className="font-mono font-bold tabular-nums">
                            {token.price != null
                              ? token.price < 0.001
                                ? token.price.toExponential(2)
                                : token.price.toFixed(6)
                              : '--'}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Price (ETH)</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold">{token.holderCount}</p>
                          <p className="text-[10px] text-muted-foreground">Holders</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold">{token.totalSwaps}</p>
                          <p className="text-[10px] text-muted-foreground">Swaps</p>
                        </div>
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
