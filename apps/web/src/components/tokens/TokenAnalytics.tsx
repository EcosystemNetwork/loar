/**
 * TokenAnalytics — detail-page analytics widgets driven by indexer data:
 * buy/sell pressure, holder concentration donut + holder-count history, whale
 * net-flow, a trader leaderboard and an all-time price-stats strip.
 */
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { Sparkline } from '@/components/tokens/Sparkline';
import { formatCompactEth, timeAgo } from '@/hooks/useTokens';
import {
  computeHolderHistory,
  computeWhaleFlow,
  type TokenTransferRow,
  type TraderStatRow,
  type TokenPriceStats,
} from '@/hooks/useTokenAnalytics';
import { ArrowDownRight, ArrowUpRight, PieChart, TrendingUp, Waves, Trophy } from 'lucide-react';

// ─── Buy / sell pressure ───────────────────────────────────────────

export function BuySellPressure({
  buys,
  sells,
  buyVol,
  sellVol,
}: {
  buys: number;
  sells: number;
  buyVol: number;
  sellVol: number;
}) {
  const totalCount = buys + sells;
  const buyShare = totalCount > 0 ? buys / totalCount : 0.5;
  const totalVol = buyVol + sellVol;
  const buyVolShare = totalVol > 0 ? buyVol / totalVol : 0.5;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Buy / Sell Pressure</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">24h</span>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-medium text-green-500">{buys} buys</span>
            <span className="font-medium text-red-500">{sells} sells</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-red-500/30">
            <div className="h-full bg-green-500" style={{ width: `${buyShare * 100}%` }} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Buy vol {formatCompactEth(buyVol)} ETH</span>
            <span>Sell vol {formatCompactEth(sellVol)} ETH</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-red-500/30">
            <div className="h-full bg-green-500" style={{ width: `${buyVolShare * 100}%` }} />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {buyShare > 0.6
            ? 'Buyers in control over the last 24h.'
            : buyShare < 0.4
              ? 'Sellers in control over the last 24h.'
              : 'Balanced flow over the last 24h.'}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Holder concentration donut + history + whales ─────────────────

interface HolderLite {
  holderAddress: string;
  balance: string;
}

const DONUT_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#334155'];
const DONUT_LABELS = ['Top holder', 'Holders 2–10', 'Holders 11–50', 'Everyone else'];

export function HolderInsights({
  holders,
  transfers,
  circulatingSupplyWei,
}: {
  holders: HolderLite[];
  transfers: TokenTransferRow[];
  circulatingSupplyWei: bigint;
}) {
  const buckets = useMemo(() => {
    if (!holders.length || circulatingSupplyWei === 0n) return [0, 0, 0, 0];
    const bal = holders.map((h) => {
      try {
        return BigInt(h.balance);
      } catch {
        return 0n;
      }
    });
    const pctOf = (w: bigint) => Number((w * 10000n) / circulatingSupplyWei) / 100;
    const top1 = pctOf(bal[0] ?? 0n);
    let g2 = 0n;
    for (let i = 1; i < Math.min(bal.length, 10); i++) g2 += bal[i];
    let g3 = 0n;
    for (let i = 10; i < Math.min(bal.length, 50); i++) g3 += bal[i];
    const known = top1 + pctOf(g2) + pctOf(g3);
    return [top1, pctOf(g2), pctOf(g3), Math.max(0, 100 - known)];
  }, [holders, circulatingSupplyWei]);

  const holderHistory = useMemo(() => computeHolderHistory(transfers), [transfers]);
  const whales = useMemo(() => computeWhaleFlow(transfers, 86400, 6), [transfers]);

  // Donut geometry — a 36-radius ring, segments as stroke-dasharray offsets.
  const C = 2 * Math.PI * 36;
  let offset = 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Holder Analytics</h3>
        </div>

        {/* Donut + legend */}
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 100 100" className="h-24 w-24 flex-shrink-0 -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="36"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.08"
              strokeWidth="14"
            />
            {buckets.map((v, i) => {
              const len = (Math.max(v, 0) / 100) * C;
              const el = (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r="36"
                  fill="none"
                  stroke={DONUT_COLORS[i]}
                  strokeWidth="14"
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
          </svg>
          <div className="space-y-1 text-[11px]">
            {buckets.map((v, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: DONUT_COLORS[i] }}
                />
                <span className="text-muted-foreground">{DONUT_LABELS[i]}</span>
                <span className="ml-auto font-mono tabular-nums">{v.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Holder count over time */}
        {holderHistory.length >= 2 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Holders over time</span>
              <span className="font-mono tabular-nums text-foreground">
                {holderHistory[holderHistory.length - 1].holders}
              </span>
            </div>
            <Sparkline data={holderHistory.map((p) => p.holders)} width={260} height={40} />
          </div>
        )}

        {/* Whale net flow */}
        {whales.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium">
              <Waves className="h-3 w-3 text-primary" />
              Whale net flow · 24h
            </div>
            <div className="space-y-1">
              {whales.map((w) => {
                const up = w.netTokens >= 0;
                return (
                  <div key={w.address} className="flex items-center gap-2 text-[11px]">
                    <AddressDisplay address={w.address} className="flex-1 truncate text-[10px]" />
                    <span
                      className={`flex items-center gap-0.5 font-mono tabular-nums ${
                        up ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      {up ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {Math.abs(w.netTokens) >= 1e6
                        ? `${(Math.abs(w.netTokens) / 1e6).toFixed(1)}M`
                        : Math.abs(w.netTokens) >= 1e3
                          ? `${(Math.abs(w.netTokens) / 1e3).toFixed(1)}K`
                          : Math.abs(w.netTokens).toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Trader leaderboard ────────────────────────────────────────────

export function TraderLeaderboardCard({ rows }: { rows: TraderStatRow[] }) {
  const top = rows.slice(0, 10);
  if (!top.length) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Top Traders</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">by volume</span>
        </div>
        <div className="grid grid-cols-[1.5rem_1fr_auto_auto] gap-x-2 gap-y-1.5 text-[11px]">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">#</span>
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">Trader</span>
          <span className="text-right text-[9px] font-semibold uppercase text-muted-foreground">
            Volume
          </span>
          <span className="text-right text-[9px] font-semibold uppercase text-muted-foreground">
            Realized
          </span>
          {top.map((r, i) => (
            <div key={r.address} className="contents">
              <span className="text-right text-muted-foreground tabular-nums">{i + 1}</span>
              <AddressDisplay address={r.address} className="truncate text-[10px]" />
              <span className="text-right font-mono tabular-nums">
                {formatCompactEth(r.volumeEth)}
              </span>
              <span
                className={`text-right font-mono tabular-nums ${
                  r.realizedPnL > 0
                    ? 'text-green-500'
                    : r.realizedPnL < 0
                      ? 'text-red-500'
                      : 'text-muted-foreground'
                }`}
              >
                {r.realizedPnL > 0 ? '+' : ''}
                {r.realizedPnL.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── All-time price stats strip ────────────────────────────────────

export function TokenStatStrip({
  stats,
  uniqueTraders,
}: {
  stats: TokenPriceStats;
  uniqueTraders: number;
}) {
  const fmt = (p: number | null) =>
    p == null ? '--' : p < 0.001 ? p.toExponential(2) : p.toFixed(6);
  const cells: { label: string; value: string; sub?: string }[] = [
    { label: 'ATH', value: fmt(stats.ath), sub: stats.athAt ? timeAgo(stats.athAt) : undefined },
    { label: 'ATL', value: fmt(stats.atl), sub: stats.atlAt ? timeAgo(stats.atlAt) : undefined },
    { label: '24h High', value: fmt(stats.high24h) },
    { label: '24h Low', value: fmt(stats.low24h) },
    { label: 'Volume (all-time)', value: `${formatCompactEth(stats.volumeAllTime)} ETH` },
    { label: 'Avg trade', value: `${formatCompactEth(stats.avgTradeSize)} ETH` },
    { label: 'Unique traders', value: String(uniqueTraders) },
    { label: 'Trades', value: String(stats.tradeCount) },
  ];
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <p className="text-[10px] text-muted-foreground">{c.label}</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{c.value}</p>
            {c.sub && <p className="text-[9px] text-muted-foreground">{c.sub}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
