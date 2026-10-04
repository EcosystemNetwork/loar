/**
 * Token Detail Page — Full analytics, native swap, comments, holders,
 * candlestick chart, watchlist, share, creator link, maturity progress.
 *
 * Layout: identity + price header, a divided stat strip, then the chart and a
 * tabbed activity area (trades / holders / traders / discussion) beside a
 * trade-first sidebar. On mobile the trade panel sits between the chart and
 * the tabs.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, useEffect, type ReactNode } from 'react';
import {
  useTokenDetail,
  useSwapHistory,
  usePoolData,
  useUniverseForToken,
  useBondingCurveForToken,
  ethPricePerToken,
  bondingSpotPrice,
  ethPriceFromTick,
  formatTokenAmount,
  formatCompactEth,
  timeAgo,
  computeAmountOut,
  weiToNumber,
  stageFromBondingCurve,
  type TokenStage,
} from '@/hooks/useTokens';
import { useSwapExecution, usePoolQuote } from '@/hooks/useSwapExecution';
import {
  useCurveState,
  useBondingCurveActions,
  usePreviewBuy,
  usePreviewSell,
} from '@/hooks/useBondingCurve';
import {
  usePriceSeries,
  useBondingCurveTradesForCurve,
  useTokenTransfers,
  computePriceStats,
  computeTraderLeaderboard,
} from '@/hooks/useTokenAnalytics';
import { CandlestickChart } from '@/components/tokens/CandlestickChart';
import {
  BuySellPressure,
  HolderInsights,
  TraderLeaderboardCard,
  TokenStatStrip,
} from '@/components/tokens/TokenAnalytics';
import { TokenTransactionsTable } from '@/components/tokens/TokenTransactionsTable';
import { TokenGovernanceCard } from '@/components/tokens/TokenGovernanceCard';
import { TokenAlertButton } from '@/components/tokens/TokenAlertButton';
import { TokenComments } from '@/components/tokens/TokenComments';
import { TokenSocialLinks } from '@/components/tokens/TokenSocialLinks';
import { HolderBubbleMap } from '@/components/tokens/HolderBubbleMap';
import { LiveStream } from '@/components/tokens/LiveStream';
import { LaunchpadNav } from '@/components/tokens/launchpad/LaunchpadNav';
import {
  Change,
  GraduationBar,
  Panel,
  StagePill,
  Stat,
  TokenAvatar,
} from '@/components/tokens/launchpad/primitives';
import { formatPrice } from '@/components/tokens/launchpad/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Copy,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Share2,
  Star,
  AlertTriangle,
  Clapperboard,
  User,
  Zap,
} from 'lucide-react';
import { useChainId, useBalance, useBytecode } from 'wagmi';
import { parseUnits, formatEther } from 'viem';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { getExplorerAddressUrl } from '@/configs/chains';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { UniverseStakePanel } from '@/components/UniverseStakePanel';
import { LPYieldManager } from '@/components/LPYieldManager';
import { pushRecentToken } from '@/hooks/useRecentTokens';
import { SERVER_URL } from '@/utils/query-client';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/tokens/$address')({
  validateSearch: (search: Record<string, unknown>): { buy?: string } => ({
    buy: typeof search.buy === 'string' && /^\d*\.?\d+$/.test(search.buy) ? search.buy : undefined,
  }),
  component: TokenDetailPage,
});

function TokenDetailPage() {
  const { address: tokenAddress } = Route.useParams();
  const { buy: initialBuyAmount } = Route.useSearch();
  const chainId = useChainId();
  const { address: userAddress } = useAccount();
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const queryClient = useQueryClient();

  // Record this visit for the launchpad's "recently viewed" rail.
  useEffect(() => {
    if (tokenAddress) pushRecentToken(tokenAddress);
  }, [tokenAddress]);

  const {
    data: tokenData,
    isLoading: tokenLoading,
    refetch: refetchToken,
  } = useTokenDetail(tokenAddress);
  const token = tokenData?.token;

  // Distinguish "indexer lag" from "doesn't exist" — if there's bytecode at
  // the address, the deploy landed and ponder just hasn't caught up yet.
  const isHexAddress = /^0x[0-9a-fA-F]{40}$/.test(tokenAddress);
  const { data: bytecode, isLoading: bytecodeLoading } = useBytecode({
    address: isHexAddress ? (tokenAddress as `0x${string}`) : undefined,
    query: { enabled: isHexAddress },
  });
  const hasContract = !!bytecode && bytecode !== '0x';

  // Auto-poll while we know a contract exists but ponder hasn't indexed it.
  useEffect(() => {
    if (token || tokenLoading || !hasContract) return;
    const id = setInterval(() => refetchToken(), 5000);
    return () => clearInterval(id);
  }, [token, tokenLoading, hasContract, refetchToken]);
  // Stable reference so dependent memos don't re-run on every render when the
  // server returns no holders (would otherwise produce a fresh [] each time).
  const holders = useMemo(() => tokenData?.holders ?? [], [tokenData?.holders]);

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
    // The server's /share page carries the Open Graph tags (the SPA has none)
    // and forwards people on to this page, so pasted links unfurl with a preview.
    const url =
      SERVER_URL && token ? `${SERVER_URL}/share/token/${token.id}` : window.location.href;
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
    if (!token) return null;
    // Pre-graduation the curve is the only price source (see bondingSpotPrice).
    if (bondingCurve && !bondingCurve.graduated) {
      return bondingSpotPrice(bondingCurve.ethRaised, bondingCurve.tokensSold);
    }
    if (!pool) return null;
    return ethPricePerToken(pool, token.id);
  }, [pool, token, bondingCurve]);

  // Chart data from swaps — quote each tick as ETH/token and pull the ETH
  // leg (amount1 when the token is currency0, else amount0).
  const chartData = useMemo(() => {
    if (!swaps?.length) return [];
    return swaps
      .slice()
      .reverse()
      .map((s) => {
        const ethAmountSigned = tokenIsCurrency0 ? BigInt(s.amount1) : BigInt(s.amount0);
        const ethAbs = ethAmountSigned < 0n ? -ethAmountSigned : ethAmountSigned;
        return {
          timestamp: s.timestamp,
          price: ethPriceFromTick(s.tick, tokenIsCurrency0),
          isBuy: ethAmountSigned > 0n,
          ethAmount: weiToNumber(ethAbs, 18),
        };
      });
  }, [swaps, tokenIsCurrency0]);

  // Unified price series — merges pre-graduation bonding-curve snapshots with
  // post-graduation swaps so bonding tokens get real chart history. Falls back
  // to swap-only `chartData` when the series is empty (older indexer schema).
  const { data: priceSeries } = usePriceSeries({
    bondingCurveId: bondingCurve?.id,
    swaps,
    tokenIsCurrency0,
  });
  const seriesForChart = priceSeries.length >= 2 ? priceSeries : chartData;

  // Per-token bonding-curve trade feed + ERC-20 transfers for the analytics
  // widgets (transactions table, trader leaderboard, holder insights).
  const curveTradesQuery = useBondingCurveTradesForCurve(bondingCurve?.id, 500);
  const curveTrades = useMemo(() => curveTradesQuery.data ?? [], [curveTradesQuery.data]);
  const transfersQuery = useTokenTransfers(token?.id, 1000);
  const transfers = useMemo(() => transfersQuery.data ?? [], [transfersQuery.data]);

  const priceStats = useMemo(() => computePriceStats(seriesForChart), [seriesForChart]);

  const traderRows = useMemo(
    () =>
      computeTraderLeaderboard({
        bondingTrades: curveTrades,
        swaps: swaps ?? [],
        tokenIsCurrency0,
      }),
    [curveTrades, swaps, tokenIsCurrency0]
  );

  const uniqueTraders = traderRows.length;

  // 24h buy/sell pressure across both trade sources.
  const pressure24h = useMemo(() => {
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    let buys = 0,
      sells = 0,
      buyVol = 0,
      sellVol = 0;
    for (const s of swaps ?? []) {
      if (s.timestamp < dayAgo) continue;
      const ethSigned = tokenIsCurrency0 ? BigInt(s.amount1) : BigInt(s.amount0);
      const ethAbs = weiToNumber(ethSigned < 0n ? -ethSigned : ethSigned, 18);
      if (ethSigned > 0n) {
        buys++;
        buyVol += ethAbs;
      } else if (ethSigned < 0n) {
        sells++;
        sellVol += ethAbs;
      }
    }
    for (const t of curveTrades) {
      if (t.timestamp < dayAgo) continue;
      const ethAbs = weiToNumber(t.ethAmount, 18);
      if (t.isBuy) {
        buys++;
        buyVol += ethAbs;
      } else {
        sells++;
        sellVol += ethAbs;
      }
    }
    return { buys, sells, buyVol, sellVol };
  }, [swaps, curveTrades, tokenIsCurrency0]);

  // 24h price change
  const priceChange = useMemo(() => {
    if (seriesForChart.length < 2) return null;
    const latest = seriesForChart[seriesForChart.length - 1].price;
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const oldPrice =
      seriesForChart.find((d) => d.timestamp >= oneDayAgo)?.price ?? seriesForChart[0].price;
    if (!oldPrice) return null;
    return ((latest - oldPrice) / oldPrice) * 100;
  }, [seriesForChart]);

  // Filter the bonding-curve contract out of the holder list. The curve isn't
  // a real holder — it's the smart contract holding the unsold portion of the
  // mint until graduation, and counting it as a top holder produces a
  // misleading >50% concentration warning for every fresh token.
  const visibleHolders = useMemo(() => {
    // Also drop zero-balance rows — the indexer keeps addresses that fully sold.
    const funded = holders.filter((h) => h.balance && h.balance !== '0');
    const curveAddr = bondingCurve?.id?.toLowerCase();
    if (!curveAddr) return funded;
    return funded.filter((h) => h.holderAddress.toLowerCase() !== curveAddr);
  }, [holders, bondingCurve]);

  // Circulating supply: tokens currently in user wallets / LP. During bonding
  // only `tokensSold` is in circulation; the unsold portion is escrowed in
  // the curve. After graduation the full mint is distributed.
  const circulatingSupplyWei = useMemo(() => {
    const TOTAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;
    if (!bondingCurve || bondingCurve.graduated) return TOTAL_SUPPLY_WEI;
    return BigInt(bondingCurve.tokensSold || '0');
  }, [bondingCurve]);

  // Holder stats — % is taken against circulating supply so a wallet holding
  // half of *what's been sold so far* shows correctly as 50%, not 5%.
  const holderStats = useMemo(() => {
    if (!visibleHolders.length || circulatingSupplyWei === 0n)
      return { total: visibleHolders.length, topHolderPct: 0 };
    const topBalance = BigInt(visibleHolders[0]?.balance ?? '0');
    return {
      total: visibleHolders.length,
      topHolderPct: Number((topBalance * 10000n) / circulatingSupplyWei) / 100,
    };
  }, [visibleHolders, circulatingSupplyWei]);

  // Whole-token circulating count for MCap math.
  const circulatingSupply = useMemo(
    () => Number(circulatingSupplyWei / 10n ** 12n) / 1e6,
    [circulatingSupplyWei]
  );

  // True market cap (price * circulating). For the fully-diluted figure use
  // `fdv` below.
  const marketCap = currentPrice != null ? currentPrice * circulatingSupply : null;
  const fdv = currentPrice != null ? currentPrice * 1_000_000_000 : null;
  // Pool swaps + bonding-curve trades — a token still on the curve has no swaps.
  const totalSwaps = (swaps?.length ?? 0) + curveTrades.length;

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

  // Same classification the launchpad list uses.
  const stage: TokenStage = stageFromBondingCurve(bondingCurve);

  if (tokenLoading || (!token && bytecodeLoading)) {
    return (
      <div className="min-h-screen bg-background">
        <LaunchpadNav />
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6" aria-busy="true">
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Skeleton className="h-[420px] rounded-xl" />
            <Skeleton className="h-[420px] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    const indexing = isHexAddress && hasContract;
    return (
      <div className="min-h-screen bg-background">
        <LaunchpadNav />
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
          {indexing ? (
            <>
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" aria-hidden />
              <h1 className="text-xl font-bold">Indexing in progress</h1>
              <p className="mt-2 text-muted-foreground">
                This token is deployed on-chain but the indexer hasn&apos;t caught up yet.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Refreshing every 5s. New deploys usually appear within ~30s.
              </p>
              <div className="mt-6 flex gap-2">
                <Button variant="outline" onClick={() => refetchToken()}>
                  Refresh now
                </Button>
                <Button variant="ghost" asChild>
                  <Link to="/tokens">
                    <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                    Back to launchpad
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold">Token not found</h1>
              <p className="mt-2 text-muted-foreground">
                No contract is deployed at this address on the connected chain.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check the address and that your wallet is on the right network.
              </p>
              <Button variant="outline" className="mt-6" asChild>
                <Link to="/tokens">
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                  Back to launchpad
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const isCreator =
    !!userAddress &&
    [token.deployer, token.tokenAdmin].some((a) => a.toLowerCase() === userAddress.toLowerCase());
  const isTokenAdmin =
    !!userAddress &&
    !!token.tokenAdmin &&
    token.tokenAdmin.toLowerCase() === userAddress.toLowerCase();

  return (
    <div className="min-h-screen bg-background pb-bottom-nav md:pb-12">
      <LaunchpadNav />

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {/* ── Identity + price ─────────────────────────────────────────── */}
        <header className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <TokenAvatar imageURL={token.imageURL} symbol={token.symbol} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
                  {token.name}
                </h1>
                <span className="font-mono text-lg text-muted-foreground">${token.symbol}</span>
                <StagePill stage={stage} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => copyAddress(token.id)}
                  className="inline-flex items-center gap-1.5 rounded font-mono transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Copy contract address"
                >
                  {token.id.slice(0, 6)}…{token.id.slice(-4)}
                  {copiedAddress === token.id ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                <a
                  href={getExplorerAddressUrl(chainId, token.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Explorer <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
                <span>
                  by{' '}
                  <Link
                    to="/tokens/creator/$address"
                    params={{ address: token.deployer }}
                    className="rounded text-foreground/80 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AddressDisplay address={token.deployer} />
                  </Link>
                </span>
                <span>launched {timeAgo(token.createdAt)}</span>
              </div>
              <div className="mt-3 [&>div]:mb-0">
                <TokenSocialLinks metadata={token.metadata} />
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 flex-col gap-3 lg:items-end">
            <div className="lg:text-right">
              <p className="text-3xl font-bold tabular-nums">
                {formatPrice(currentPrice, 8)}
                <span className="ml-1.5 text-sm font-medium text-muted-foreground">ETH</span>
              </p>
              <Change value={priceChange} suffix="24h" className="text-sm font-semibold" />
            </div>
            <div className="flex flex-wrap gap-2">
              {userAddress && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => watchMutation.mutate()}
                  disabled={watchMutation.isPending}
                  aria-pressed={!!isWatching}
                >
                  <Star
                    className={cn('h-3.5 w-3.5', isWatching && 'fill-primary text-primary')}
                    aria-hidden
                  />
                  {isWatching ? 'Watching' : 'Watch'}
                </Button>
              )}
              <TokenAlertButton
                tokenAddress={token.id}
                tokenSymbol={token.symbol}
                currentPrice={currentPrice}
              />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={shareToken}>
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                <span aria-live="polite">{shareToast ? 'Link copied' : 'Share'}</span>
              </Button>
              {universe && (
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <Link to="/universe/$id/watch" params={{ id: token.universeAddress }}>
                    <Clapperboard className="h-3.5 w-3.5" aria-hidden />
                    Watch universe
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* ── Safety ───────────────────────────────────────────────────── */}
        {safetyWarnings.length > 0 && (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <ul className="space-y-0.5 text-sm text-amber-800 dark:text-amber-200">
              {safetyWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Stat strip ───────────────────────────────────────────────── */}
        <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 lg:grid-cols-6 lg:divide-x [&>div]:border-border max-lg:[&>div]:border-b">
          <Stat
            label="Market cap"
            value={marketCap != null && marketCap > 0 ? `${formatCompactEth(marketCap)} ETH` : '--'}
            sub={
              fdv != null && fdv > 0 && bondingCurve && !bondingCurve.graduated
                ? `FDV ${formatCompactEth(fdv)} ETH`
                : 'circulating'
            }
          />
          <Stat label="Holders" value={holderStats.total} sub="addresses" />
          <Stat label="Trades" value={totalSwaps} sub={`${uniqueTraders} traders`} />
          <Stat
            label="24h volume"
            value={`${formatCompactEth(pressure24h.buyVol + pressure24h.sellVol)}`}
            sub={`${pressure24h.buys} buys · ${pressure24h.sells} sells`}
          />
          <Stat label="Supply" value="1B" sub="fixed" />
          <Stat
            label="Top holder"
            value={holderStats.total ? `${holderStats.topHolderPct.toFixed(1)}%` : '--'}
            sub="of circulating"
          />
        </dl>

        {/* ── Main grid ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr]">
          {/* Chart block — col 1, row 1 */}
          <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
            <LiveStream tokenAddress={token.id} isCreator={isCreator} />
            <Panel
              title="Price"
              icon={<BarChart3 className="h-4 w-4 text-primary" aria-hidden />}
              action={
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatPrice(currentPrice, 8)} ETH
                </span>
              }
              bodyClassName="p-2 sm:p-4"
            >
              <CandlestickChart data={seriesForChart} />
            </Panel>
            <TokenStatStrip stats={priceStats} uniqueTraders={uniqueTraders} />
          </div>

          {/* Sidebar — col 2, spans both rows; between chart and tabs on mobile */}
          <aside className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <section className="overflow-hidden rounded-xl border border-primary/30 bg-card shadow-sm">
              {bondingCurve && <CurveProgress curve={bondingCurve} stage={stage} />}
              <div className="p-4">
                <SwapInterface
                  tokenAddress={token.id}
                  tokenSymbol={token.symbol}
                  currentPrice={currentPrice}
                  poolData={pool}
                  tokenIsCurrency0={tokenIsCurrency0}
                  latestSqrtPriceX96={swaps?.[0]?.sqrtPriceX96 ?? pool?.sqrtPriceX96 ?? null}
                  latestLiquidity={swaps?.[0]?.liquidity ?? null}
                  bondingCurveAddress={bondingCurve?.id ?? null}
                  curveActive={stage === 'bonding' || stage === 'graduating'}
                  initialAmount={initialBuyAmount}
                />
              </div>
            </section>

            {universe?.universeId != null && (
              <UniverseStakePanel
                universeId={Number(universe.universeId)}
                universeName={universe.name || token.name}
              />
            )}

            {isTokenAdmin && (
              <LPYieldManager
                tokenAddress={token.id as `0x${string}`}
                universeName={universe?.name || token.name}
                onChainUniverseId={
                  universe?.universeId != null ? Number(universe.universeId) : undefined
                }
              />
            )}

            {token.universeAddress && (
              <TokenGovernanceCard universeId={token.universeAddress} tokenSymbol={token.symbol} />
            )}

            {/* About */}
            <Panel title="About" icon={<Zap className="h-4 w-4 text-primary" aria-hidden />}>
              <div className="space-y-4">
                {universe && (
                  <Link
                    to="/universe/$id/watch"
                    params={{ id: token.universeAddress }}
                    className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {universe.imageURL ? (
                      <img
                        src={universe.imageURL}
                        alt=""
                        className="h-11 w-11 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted">
                        <Clapperboard className="h-5 w-5 text-muted-foreground" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{universe.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Universe · {universe.nodeCount} events
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Link>
                )}

                <Link
                  to="/tokens/creator/$address"
                  params={{ address: token.deployer }}
                  className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10">
                    <User className="h-5 w-5 text-primary" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <AddressDisplay address={token.deployer} className="text-sm font-medium" />
                    <p className="text-xs text-muted-foreground">Creator · view all tokens</p>
                  </div>
                </Link>

                <dl className="space-y-2 text-xs">
                  <InfoRow
                    label="Contract"
                    value={token.id}
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Pool"
                    value={token.poolId}
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Deployer"
                    value={token.deployer}
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Admin"
                    value={token.tokenAdmin}
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                  <InfoRow
                    label="Locker"
                    value={token.locker}
                    onCopy={copyAddress}
                    copied={copiedAddress}
                  />
                </dl>

                {/* Maturity */}
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium">Maturity</span>
                    <span className="tabular-nums text-muted-foreground">
                      {milestonesCompleted}/{milestones.length}
                    </span>
                  </div>
                  <ol className="flex gap-1" aria-label="Maturity milestones">
                    {milestones.map((m) => (
                      <li
                        key={m.label}
                        title={m.label}
                        className={cn(
                          'h-1.5 flex-1 rounded-full',
                          m.met ? 'bg-emerald-500' : 'bg-muted'
                        )}
                      >
                        <span className="sr-only">
                          {m.label}: {m.met ? 'done' : 'not yet'}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {milestones.find((m) => !m.met) && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Next: {milestones.find((m) => !m.met)!.label}
                    </p>
                  )}
                </div>

                <details className="group rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
                  <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
                    <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />
                    Liquidity locked forever
                    <span className="ml-auto text-muted-foreground group-open:hidden">Why?</span>
                  </summary>
                  <p className="mt-2 leading-relaxed text-muted-foreground">
                    This token&apos;s liquidity pool is permanently locked on-chain by the
                    LoarLpLocker contract. No one can withdraw it — not the creator, not LOAR. There
                    is no admin key, timelock, or governance path that unlocks it. Creator tokens
                    are vested.
                  </p>
                </details>
              </div>
            </Panel>
          </aside>

          {/* Activity tabs — col 1, row 2 */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <Tabs defaultValue="trades">
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 [scrollbar-width:none]">
                <TabTrigger value="trades" label="Trades" count={totalSwaps} />
                <TabTrigger value="holders" label="Holders" count={holderStats.total} />
                <TabTrigger value="traders" label="Top traders" count={uniqueTraders} />
                <TabTrigger value="thread" label="Discussion" />
              </TabsList>

              <TabsContent value="trades" className="mt-4 space-y-4">
                <BuySellPressure
                  buys={pressure24h.buys}
                  sells={pressure24h.sells}
                  buyVol={pressure24h.buyVol}
                  sellVol={pressure24h.sellVol}
                />
                <Panel bodyClassName="p-0 sm:p-4">
                  {swapsLoading && curveTrades.length === 0 ? (
                    <div className="space-y-2 p-4" aria-busy="true">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : (
                    <TokenTransactionsTable
                      swaps={swaps ?? []}
                      bondingTrades={curveTrades}
                      tokenIsCurrency0={tokenIsCurrency0}
                      chainId={chainId}
                    />
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="holders" className="mt-4 space-y-4">
                <Panel
                  title="Top holders"
                  action={
                    <span className="text-xs tabular-nums text-muted-foreground">
                      % of circulating
                    </span>
                  }
                >
                  {visibleHolders.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No holders indexed yet
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {visibleHolders.slice(0, 20).map((holder, i) => {
                        const pct =
                          circulatingSupplyWei === 0n
                            ? 0
                            : Number((BigInt(holder.balance) * 10000n) / circulatingSupplyWei) /
                              100;
                        const heavy = pct > 30;
                        return (
                          <li key={holder.id} className="flex items-center gap-3 text-sm">
                            <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                              {i + 1}
                            </span>
                            <AddressDisplay
                              address={holder.holderAddress}
                              className="min-w-0 flex-1 text-xs"
                            />
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  heavy ? 'bg-amber-500' : 'bg-primary'
                                )}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span
                              className={cn(
                                'w-14 text-right font-mono text-xs font-medium tabular-nums',
                                heavy && 'text-amber-600 dark:text-amber-400'
                              )}
                            >
                              {pct.toFixed(1)}%
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </Panel>
                <HolderInsights
                  holders={visibleHolders}
                  transfers={transfers}
                  circulatingSupplyWei={circulatingSupplyWei}
                />
                <HolderBubbleMap
                  holders={holders}
                  transfers={transfers}
                  creators={[token.deployer, token.tokenAdmin]}
                  contracts={[bondingCurve?.id, token.locker].filter((a): a is string => !!a)}
                  circulatingSupplyWei={circulatingSupplyWei}
                />
              </TabsContent>

              <TabsContent value="traders" className="mt-4">
                <TraderLeaderboardCard rows={traderRows} />
              </TabsContent>

              <TabsContent value="thread" className="mt-4">
                <Panel>
                  <TokenComments tokenAddress={tokenAddress} />
                </Panel>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page pieces ──────────────────────────────────────────────────────

function TabTrigger({ value, label, count }: { value: string; label: string; count?: number }) {
  return (
    <TabsTrigger
      value={value}
      className="h-9 flex-shrink-0 gap-1.5 rounded-lg px-3.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
    >
      {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </TabsTrigger>
  );
}

function CurveProgress({
  curve,
  stage,
}: {
  curve: {
    ethRaised: string;
    graduationEth: string;
    tradeCount: number;
    graduated: boolean;
    tradingStatus: string;
  };
  stage: TokenStage;
}) {
  const raised = weiToNumber(curve.ethRaised, 18);
  const target = weiToNumber(curve.graduationEth, 18);
  const pct = curve.graduated ? 100 : target > 0 ? Math.min((raised / target) * 100, 100) : 0;
  const title =
    stage === 'halted'
      ? 'Trading halted'
      : stage === 'graduated'
        ? 'Graduated to Uniswap'
        : stage === 'graduating'
          ? 'Graduating soon'
          : 'Bonding curve';
  const note =
    stage === 'halted'
      ? 'Halted by governance. Trading resumes after the 48-hour timelock unless directed otherwise.'
      : stage === 'graduated'
        ? 'Now trading on Uniswap v4 with permanently locked liquidity.'
        : stage === 'graduating'
          ? 'Almost there. At the target, raised ETH and unsold tokens seed a permanent Uniswap v4 pool.'
          : 'Price rises as people buy. At the target the token graduates to Uniswap v4.';

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="font-mono text-sm font-semibold tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <GraduationBar pct={pct} stage={stage} className="h-2" />
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {raised.toFixed(4)} / {target.toFixed(2)} ETH
        </span>
        <span className="tabular-nums">{curve.tradeCount} trades</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

// ─── Swap Interface ───────────────────────────────────────────────────

function SwapInterface({
  tokenAddress,
  tokenSymbol,
  currentPrice,
  poolData,
  tokenIsCurrency0,
  latestSqrtPriceX96,
  latestLiquidity,
  bondingCurveAddress,
  curveActive,
  initialAmount,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  currentPrice: number | null;
  poolData?: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
    sqrtPriceX96: string | null;
  } | null;
  tokenIsCurrency0: boolean;
  latestSqrtPriceX96: string | null;
  latestLiquidity: string | null;
  bondingCurveAddress?: string | null;
  curveActive: boolean;
  initialAmount?: string;
}) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });
  const swapExec = useSwapExecution();
  const { isNativeSwapAvailable } = swapExec;

  // Pre-graduation tokens trade on their bonding curve — the v4 pool has no
  // liquidity until graduation, so quoting/swapping it would always fail.
  const curveAddr =
    curveActive && bondingCurveAddress ? (bondingCurveAddress as `0x${string}`) : undefined;
  const { state: curveState } = useCurveState(curveAddr);
  const inCurve = !!curveAddr && !curveState?.graduated;
  const curve = useBondingCurveActions(inCurve ? curveAddr : undefined);
  const { tokensOut: curveBuyOut } = usePreviewBuy(
    inCurve && mode === 'buy' ? curveAddr : undefined,
    amount
  );
  const { ethOut: curveSellOut } = usePreviewSell(
    inCurve && mode === 'sell' ? curveAddr : undefined,
    amount
  );

  const status = inCurve ? curve.status : swapExec.status;
  const error = inCurve ? curve.error : swapExec.error;
  const txHash = inCurve ? curve.txHash : swapExec.txHash;
  const reset = () => {
    swapExec.reset();
    curve.reset();
  };

  const amountInWei = useMemo(() => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return null;
    try {
      return parseUnits(Number(amount).toFixed(18), 18);
    } catch {
      return null;
    }
  }, [amount]);

  // zeroForOne:
  //  - buy:  input is WETH → zeroForOne iff WETH is currency0 (token is currency1)
  //  - sell: input is the token → zeroForOne iff the token is currency0
  const zeroForOne = mode === 'buy' ? !tokenIsCurrency0 : tokenIsCurrency0;

  const poolKey = useMemo(
    () =>
      poolData
        ? {
            currency0: poolData.currency0 as `0x${string}`,
            currency1: poolData.currency1 as `0x${string}`,
            fee: poolData.fee,
            tickSpacing: poolData.tickSpacing,
            hooks: poolData.hooks as `0x${string}`,
          }
        : null,
    [poolData]
  );

  // On-chain v4 quote — simulates the real swap (hook fee included), so it
  // works for a freshly graduated pool the indexer has no trades for yet.
  const poolQuote = usePoolQuote({
    poolKey: inCurve ? null : poolKey,
    zeroForOne,
    amountInWei,
  });

  // Fallback for chains without a quoter: single-tick simulation against the
  // latest indexed snapshot.
  const snapshotOutWei = useMemo(() => {
    if (poolQuote.isAvailable || !amountInWei) return null;
    if (!latestSqrtPriceX96 || !latestLiquidity) return null;
    return computeAmountOut({
      sqrtPriceX96: latestSqrtPriceX96,
      liquidity: latestLiquidity,
      amountInWei,
      zeroForOne,
    });
  }, [poolQuote.isAvailable, amountInWei, zeroForOne, latestSqrtPriceX96, latestLiquidity]);

  // Returns null when nothing can be quoted — the swap button refuses to
  // enable in that case so we never ship an unbounded slippage tx.
  const expectedOutWei: bigint | null = useMemo(() => {
    if (!amountInWei) return null;
    if (inCurve) {
      const out = mode === 'buy' ? curveBuyOut : curveSellOut;
      return out > 0n ? out : null;
    }
    const out = poolQuote.amountOut ?? snapshotOutWei;
    return out != null && out > 0n ? out : null;
  }, [amountInWei, inCurve, mode, curveBuyOut, curveSellOut, poolQuote.amountOut, snapshotOutWei]);

  const quoteLoading = !inCurve && poolQuote.isLoading;

  const estimatedOutput = useMemo(() => {
    if (expectedOutWei == null) return null;
    return Number(formatEther(expectedOutWei));
  }, [expectedOutWei]);

  const handleSwap = async () => {
    let hash: string | undefined;
    if (inCurve) {
      hash =
        mode === 'buy'
          ? await curve.buy(amount)
          : await curve.sell(parseUnits(Number(amount).toFixed(18), 18));
    } else {
      const result = await swapExec.executeSwap({
        tokenAddress,
        tokenSymbol,
        poolKey,
        mode,
        amount,
        slippageBps: 100, // 1% default for inline widget
        expectedOutWei: expectedOutWei ?? undefined,
      });
      if (result && !result.fallback && result.txHash) hash = result.txHash;
    }

    if (hash) {
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
            txHash: hash,
          });
        }
      } catch {
        // PnL tracking is best-effort
      }
    }
  };

  const busy =
    status === 'confirming' ||
    status === 'pending' ||
    status === 'approving' ||
    status === 'approval-pending';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ArrowUpDown className="h-4 w-4 text-primary" aria-hidden />
          Trade ${tokenSymbol}
        </h2>
        {(inCurve || isNativeSwapAvailable) && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3 text-primary" aria-hidden />
            {inCurve ? 'Bonding curve' : 'In-app swap'}
          </span>
        )}
      </div>

      {/* Buy / Sell */}
      <div
        role="tablist"
        aria-label="Trade side"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        {(['buy', 'sell'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              reset();
            }}
            className={cn(
              'h-9 rounded-md text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === m
                ? m === 'buy'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-red-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Amount */}
      <div className="rounded-lg border border-border bg-background p-3 focus-within:ring-2 focus-within:ring-ring">
        <div className="flex items-center justify-between text-xs">
          <Label htmlFor="swap-amount" className="text-xs font-medium text-muted-foreground">
            {mode === 'buy' ? 'You pay' : 'You sell'}
          </Label>
          {mode === 'buy' && ethBalance && (
            <button
              type="button"
              onClick={() => setAmount(ethBalance.formatted)}
              className="rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Balance {Number(ethBalance.formatted).toFixed(4)} · Max
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Input
            id="swap-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^0-9.]/g, ''));
              reset();
            }}
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <span className="flex-shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-semibold">
            {mode === 'buy' ? 'ETH' : `$${tokenSymbol}`}
          </span>
        </div>
      </div>

      {mode === 'buy' && (
        <div className="grid grid-cols-4 gap-1.5">
          {['0.01', '0.05', '0.1', '0.5'].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => {
                setAmount(val);
                reset();
              }}
              aria-pressed={amount === val}
              className={cn(
                'h-8 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                amount === val
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {val}
            </button>
          ))}
        </div>
      )}

      {/* Quote */}
      {expectedOutWei !== null && expectedOutWei > 0n && (
        <dl className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">You receive (est.)</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {mode === 'buy'
                ? `${formatTokenAmount(expectedOutWei.toString())} $${tokenSymbol}`
                : `${(estimatedOutput ?? 0).toFixed(6)} ETH`}
            </dd>
          </div>
          {currentPrice && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Price</dt>
              <dd className="font-mono tabular-nums">{formatPrice(currentPrice, 8)} ETH</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Max slippage</dt>
            <dd className="font-mono tabular-nums">1%</dd>
          </div>
        </dl>
      )}

      {amountInWei !== null && expectedOutWei === null && (inCurve || isNativeSwapAvailable) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
          {quoteLoading
            ? 'Fetching on-chain quote…'
            : inCurve
              ? mode === 'sell'
                ? 'Amount exceeds what the bonding curve can buy back.'
                : 'The bonding curve returned no tokens for this amount — it may be full or halted.'
              : 'This pool has no liquidity to quote against yet, so the trade can’t be priced.'}
        </p>
      )}

      {/* Tx status */}
      <div aria-live="polite">
        {(status === 'approving' || status === 'approval-pending') && (
          <p className="flex items-center gap-2 rounded-lg bg-muted p-2.5 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {status === 'approving'
              ? `Approve $${tokenSymbol} in your wallet…`
              : 'Waiting for approval…'}
          </p>
        )}
        {status === 'pending' && txHash && (
          <p className="flex items-center gap-2 rounded-lg bg-muted p-2.5 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Transaction pending…
          </p>
        )}
        {status === 'error' && error && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </div>

      <Button
        className={cn(
          'h-12 w-full text-base font-bold text-white transition-transform active:scale-[0.98] motion-reduce:active:scale-100',
          mode === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
        )}
        onClick={handleSwap}
        disabled={
          !amount ||
          !Number.isFinite(Number(amount)) ||
          Number(amount) <= 0 ||
          // No quote → can't enforce slippage; refuse to swap rather than
          // fall through to an unbounded execution.
          ((inCurve || isNativeSwapAvailable) && expectedOutWei === null) ||
          busy
        }
      >
        {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />}
        {mode === 'buy' ? `Buy $${tokenSymbol}` : `Sell $${tokenSymbol}`}
        {!inCurve && !isNativeSwapAvailable && (
          <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" aria-hidden />
        )}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        {inCurve
          ? 'Trades on the bonding curve until it graduates to Uniswap v4.'
          : isNativeSwapAvailable
            ? 'Executes on-chain via LoarSwapRouter.'
            : 'Opens Uniswap v4 to complete the swap.'}{' '}
        LP is locked forever.
      </p>
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: (addr: string) => void;
  copied?: string | null;
}): ReactNode {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <button
          type="button"
          onClick={() => onCopy(value)}
          aria-label={`Copy ${label.toLowerCase()} address`}
          className="inline-flex items-center gap-1.5 rounded font-mono text-[11px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value.slice(0, 6)}…{value.slice(-4)}
          {copied === value ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" aria-hidden />
          )}
        </button>
      </dd>
    </div>
  );
}
