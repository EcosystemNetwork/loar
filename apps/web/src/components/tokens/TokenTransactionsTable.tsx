/**
 * TokenTransactionsTable — the full trade history for a token: post-graduation
 * Uniswap v4 swaps merged with pre-graduation bonding-curve trades, with
 * type / size / trader filters and incremental paging. Replaces the capped
 * "recent trades" list on the detail page.
 */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { ethPriceFromTick, formatEth, timeAgo, weiToNumber } from '@/hooks/useTokens';
import type { BondingCurveTrade } from '@/hooks/useTokens';
import type { Swap } from '@/utils/ponder-api';
import { getExplorerTxUrl } from '@/configs/chains';
import { ExternalLink, TrendingUp } from 'lucide-react';

interface Row {
  id: string;
  kind: 'swap' | 'curve';
  ts: number;
  trader: string;
  isBuy: boolean;
  ethAmount: number; // for filtering / sorting
  ethWei: string; // for display via formatEth
  priceEth: number | null;
  txHash?: string;
}

type TypeFilter = 'all' | 'buy' | 'sell';
const PAGE = 30;

export function TokenTransactionsTable({
  swaps,
  bondingTrades,
  tokenIsCurrency0,
  chainId,
}: {
  swaps: Swap[];
  bondingTrades: BondingCurveTrade[];
  tokenIsCurrency0: boolean;
  chainId: number;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [minEth, setMinEth] = useState('');
  const [traderQ, setTraderQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of swaps) {
      const ethSigned = tokenIsCurrency0 ? BigInt(s.amount1) : BigInt(s.amount0);
      const ethAbs = ethSigned < 0n ? -ethSigned : ethSigned;
      out.push({
        id: s.id,
        kind: 'swap',
        ts: s.timestamp,
        trader: s.sender,
        isBuy: ethSigned > 0n,
        ethAmount: weiToNumber(ethAbs, 18),
        ethWei: ethAbs.toString(),
        priceEth: ethPriceFromTick(s.tick, tokenIsCurrency0),
        txHash: s.id.split('-')[0],
      });
    }
    for (const t of bondingTrades) {
      out.push({
        id: t.id,
        kind: 'curve',
        ts: t.timestamp,
        trader: t.trader,
        isBuy: t.isBuy,
        ethAmount: weiToNumber(t.ethAmount, 18),
        ethWei: t.ethAmount,
        priceEth: weiToNumber(t.price, 18),
        txHash: t.id.split(':')[0]?.split('-')[0],
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [swaps, bondingTrades, tokenIsCurrency0]);

  const filtered = useMemo(() => {
    const min = minEth.trim() === '' ? 0 : Number(minEth) || 0;
    const q = traderQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter === 'buy' && !r.isBuy) return false;
      if (typeFilter === 'sell' && r.isBuy) return false;
      if (r.ethAmount < min) return false;
      if (q && !r.trader.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, typeFilter, minEth, traderQ]);

  const visible = filtered.slice(0, limit);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Transactions</h3>
        <span className="text-[11px] text-muted-foreground">{filtered.length}</span>
        <div className="ml-auto h-2 w-2 animate-pulse rounded-full bg-green-500" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border p-0.5">
          {(['all', 'buy', 'sell'] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize ${
                typeFilter === t ? 'bg-muted text-foreground' : 'text-muted-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Min ETH"
          value={minEth}
          onChange={(e) => setMinEth(e.target.value)}
          className="h-8 w-24 text-xs"
        />
        <Input
          placeholder="Filter by trader…"
          value={traderQ}
          onChange={(e) => setTraderQ(e.target.value)}
          className="h-8 flex-1 min-w-[140px] text-xs"
        />
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No matching trades</p>
      ) : (
        <div className="max-h-[460px] space-y-1 overflow-y-auto">
          <div className="grid grid-cols-[3.2rem_1fr_1fr_1fr_auto] gap-2 border-b px-2 pb-1 text-[10px] font-semibold uppercase text-muted-foreground">
            <span>Type</span>
            <span>Amount</span>
            <span>Price</span>
            <span>Trader</span>
            <span className="text-right">Time</span>
          </div>
          {visible.map((r) => {
            const explorer = r.txHash ? getExplorerTxUrl(chainId, r.txHash as `0x${string}`) : null;
            return (
              <div
                key={r.id}
                className="grid grid-cols-[3.2rem_1fr_1fr_1fr_auto] items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50"
              >
                <span className="flex items-center gap-1">
                  <Badge
                    variant={r.isBuy ? 'default' : 'destructive'}
                    className="w-fit px-1 py-0 text-[9px]"
                  >
                    {r.isBuy ? 'BUY' : 'SELL'}
                  </Badge>
                </span>
                <span className="truncate font-mono text-[10px]">{formatEth(r.ethWei)}</span>
                <span className="font-mono text-[10px]">
                  {r.priceEth != null ? r.priceEth.toExponential(2) : '--'}
                </span>
                <span className="flex items-center gap-1">
                  <AddressDisplay
                    address={r.trader}
                    className="text-[10px] text-muted-foreground"
                  />
                  {r.kind === 'curve' && (
                    <Badge
                      variant="outline"
                      className="h-3.5 border-amber-500/40 px-1 py-0 text-[8px] text-amber-500"
                    >
                      curve
                    </Badge>
                  )}
                </span>
                <span className="flex items-center justify-end gap-1 text-right text-[10px] text-muted-foreground">
                  {timeAgo(r.ts)}
                  {explorer && (
                    <a href={explorer} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-2.5 w-2.5 hover:text-foreground" />
                    </a>
                  )}
                </span>
              </div>
            );
          })}
          {limit < filtered.length && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full text-xs"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Load more ({filtered.length - limit})
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
