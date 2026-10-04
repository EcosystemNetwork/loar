/**
 * TokenTable — dense, sortable list view for the launchpad (DexScreener-style).
 * Complements the card grid; the launchpad toggles between the two.
 */
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { Sparkline } from './Sparkline';
import { QuickBuyButton } from './QuickBuyButton';
import { formatCompactEth, type EnrichedToken } from '@/hooks/useTokens';
import { ArrowDown, MessageCircle, Star } from 'lucide-react';
import type { SortMode } from '@/lib/token-screener';
import { cn } from '@/lib/utils';
import { Change, StagePill, TokenAvatar } from './launchpad/primitives';
import { compactAge, formatPrice } from './launchpad/format';

interface HeaderCol {
  key: string;
  label: string;
  sort?: SortMode;
  className?: string;
}

const COLS: HeaderCol[] = [
  { key: 'token', label: 'Token', className: 'text-left sticky left-0 z-10 bg-muted' },
  { key: 'price', label: 'Price', className: 'text-right' },
  { key: 'h1', label: '1h', className: 'text-right' },
  { key: 'h24', label: '24h', sort: 'gainers', className: 'text-right' },
  { key: 'vol', label: 'Vol 24h', sort: 'volume', className: 'text-right' },
  { key: 'liq', label: 'Liquidity', sort: 'liquidity', className: 'text-right' },
  { key: 'mcap', label: 'MCap', sort: 'mcap', className: 'text-right' },
  { key: 'holders', label: 'Holders', sort: 'holders', className: 'text-right' },
  { key: 'age', label: 'Age', sort: 'newest', className: 'text-right' },
  { key: 'chart', label: 'Trend', className: 'text-right' },
  { key: 'actions', label: '', className: 'text-right' },
];

const num = (v: number) => (v >= 0.001 ? formatCompactEth(v) : '--');

export const TokenTable = memo(function TokenTable({
  tokens,
  sortMode,
  onSort,
  isWatched,
  onToggleWatch,
  commentCountFor,
}: {
  tokens: EnrichedToken[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  isWatched: (addr: string) => boolean;
  onToggleWatch: (addr: string, symbol: string) => void;
  commentCountFor?: (addr: string) => number;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full whitespace-nowrap text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
            {COLS.map((c) => {
              const active = c.sort && sortMode === c.sort;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? 'descending' : undefined}
                  className={cn('whitespace-nowrap px-3 py-2.5 font-medium', c.className)}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sort!)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active && 'text-foreground'
                      )}
                    >
                      {c.label}
                      <ArrowDown
                        className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-0')}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => {
            const total = t.buyCount24h + t.sellCount24h;
            const buyShare = total > 0 ? t.buyCount24h / total : null;
            const watched = isWatched(t.id);
            const comments = commentCountFor?.(t.id) ?? 0;
            return (
              <tr
                key={t.id}
                className="group border-b border-border transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="sticky left-0 z-10 bg-card px-3 py-2.5 transition-colors group-hover:bg-muted">
                  <Link
                    to="/tokens/$address"
                    params={{ address: t.id }}
                    className="flex min-w-0 items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-5 text-right text-[11px] text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <TokenAvatar
                      imageURL={t.imageURL}
                      symbol={t.symbol}
                      size="sm"
                      className="h-8 w-8"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">${t.symbol}</span>
                        {t.stage !== 'bonding' && <StagePill stage={t.stage} className="py-0" />}
                      </span>
                      <span className="block max-w-[160px] truncate text-xs text-muted-foreground">
                        {t.name}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {formatPrice(t.price)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Change value={t.priceChange1h} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Change value={t.priceChange24h} />
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {num(t.volume24h)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {num(t.liquidityEth)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-medium tabular-nums">
                  {t.marketCap != null && t.marketCap > 0 ? formatCompactEth(t.marketCap) : '--'}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono tabular-nums">{t.holderCount}</span>
                  {buyShare != null && (
                    <span
                      className="ml-auto mt-1 flex h-1 w-14 overflow-hidden rounded-full bg-red-500/40"
                      title={`${t.buyCount24h} buys / ${t.sellCount24h} sells (24h)`}
                    >
                      <span
                        className="h-full bg-emerald-500"
                        style={{ width: `${Math.round(buyShare * 100)}%` }}
                      />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">
                  {compactAge(t.createdAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-block align-middle">
                    <Sparkline data={t.sparkline} width={72} height={24} />
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {comments > 0 && (
                      <span className="mr-1 flex items-center gap-0.5 text-xs text-muted-foreground">
                        <MessageCircle className="h-3 w-3" aria-hidden />
                        {comments}
                      </span>
                    )}
                    <QuickBuyButton tokenId={t.id} compact />
                    <button
                      type="button"
                      onClick={() => onToggleWatch(t.id, t.symbol)}
                      aria-pressed={watched}
                      aria-label={
                        watched ? `Remove ${t.symbol} from watchlist` : `Watch ${t.symbol}`
                      }
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Star
                        className={cn('h-4 w-4', watched && 'fill-primary text-primary')}
                        aria-hidden
                      />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
