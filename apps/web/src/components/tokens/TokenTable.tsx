/**
 * TokenTable — dense, sortable list view for the launchpad (DexScreener-style).
 * Complements the card grid; the launchpad toggles between the two.
 */
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { Sparkline } from './Sparkline';
import { QuickBuyButton } from './QuickBuyButton';
import { formatCompactEth, type EnrichedToken, type TokenStage } from '@/hooks/useTokens';
import { ArrowDown, Star } from 'lucide-react';
import type { SortMode } from '@/lib/token-screener';

function compactAge(createdAt: number): string {
  const s = Math.floor(Date.now() / 1000) - createdAt;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 2592000)}mo`;
}

function pct(v: number | null): { text: string; cls: string } {
  if (v == null) return { text: '--', cls: 'text-muted-foreground' };
  const cls = v >= 0 ? 'text-green-500' : 'text-red-500';
  return { text: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, cls };
}

function priceText(p: number | null): string {
  if (p == null) return '--';
  return p < 0.001 ? p.toExponential(2) : p.toFixed(6);
}

const STAGE_DOT: Record<TokenStage, string> = {
  bonding: 'bg-primary',
  graduating: 'bg-amber-500',
  graduated: 'bg-green-500',
  halted: 'bg-red-500',
};

interface HeaderCol {
  key: string;
  label: string;
  sort?: SortMode;
  className?: string;
}

const COLS: HeaderCol[] = [
  { key: 'token', label: 'Token', className: 'text-left' },
  { key: 'price', label: 'Price', className: 'text-right' },
  { key: 'h1', label: '1h', className: 'text-right' },
  { key: 'h24', label: '24h', sort: 'gainers', className: 'text-right' },
  { key: 'vol', label: 'Vol 24h', sort: 'volume', className: 'text-right' },
  { key: 'liq', label: 'Liquidity', sort: 'liquidity', className: 'text-right' },
  { key: 'mcap', label: 'MCap', sort: 'mcap', className: 'text-right' },
  { key: 'holders', label: 'Holders', sort: 'holders', className: 'text-right' },
  { key: 'age', label: 'Age', sort: 'newest', className: 'text-right' },
  { key: 'chart', label: '', className: 'text-right' },
  { key: 'actions', label: '', className: 'text-right' },
];

export const TokenTable = memo(function TokenTable({
  tokens,
  sortMode,
  onSort,
  isWatched,
  onToggleWatch,
}: {
  tokens: EnrichedToken[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  isWatched: (addr: string) => boolean;
  onToggleWatch: (addr: string, symbol: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40 text-[10px] uppercase text-muted-foreground">
            {COLS.map((c) => (
              <th
                key={c.key}
                className={`px-2.5 py-2 font-semibold whitespace-nowrap ${c.className ?? ''} ${
                  c.sort ? 'cursor-pointer select-none hover:text-foreground' : ''
                }`}
                onClick={c.sort ? () => onSort(c.sort!) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {c.sort && sortMode === c.sort && <ArrowDown className="h-2.5 w-2.5" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => {
            const h1 = pct(t.priceChange1h);
            const h24 = pct(t.priceChange24h);
            const buyShare =
              t.buyCount24h + t.sellCount24h > 0
                ? t.buyCount24h / (t.buyCount24h + t.sellCount24h)
                : null;
            return (
              <tr key={t.id} className="group border-b last:border-0 hover:bg-muted/40">
                {/* Token */}
                <td className="px-2.5 py-2">
                  <Link
                    to="/tokens/$address"
                    params={{ address: t.id }}
                    className="flex items-center gap-2 min-w-0"
                  >
                    <span className="w-4 text-right text-[10px] text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    {t.imageURL ? (
                      <img
                        src={t.imageURL}
                        alt={t.symbol}
                        className="h-6 w-6 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <span className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center text-[9px] font-bold text-primary flex-shrink-0">
                        {t.symbol.slice(0, 3)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${STAGE_DOT[t.stage]}`}
                          title={t.stage}
                        />
                        <span className="font-semibold truncate">${t.symbol}</span>
                      </span>
                      <span className="block text-[10px] text-muted-foreground truncate max-w-[140px]">
                        {t.name}
                      </span>
                    </span>
                  </Link>
                </td>
                {/* Price */}
                <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                  {priceText(t.price)}
                </td>
                {/* 1h */}
                <td className={`px-2.5 py-2 text-right font-mono tabular-nums ${h1.cls}`}>
                  {h1.text}
                </td>
                {/* 24h */}
                <td className={`px-2.5 py-2 text-right font-mono tabular-nums ${h24.cls}`}>
                  {h24.text}
                </td>
                {/* Vol 24h */}
                <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                  {t.volume24h >= 0.001 ? formatCompactEth(t.volume24h) : '--'}
                </td>
                {/* Liquidity */}
                <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                  {t.liquidityEth >= 0.001 ? formatCompactEth(t.liquidityEth) : '--'}
                </td>
                {/* MCap */}
                <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                  {t.marketCap != null && t.marketCap > 0 ? formatCompactEth(t.marketCap) : '--'}
                </td>
                {/* Holders + buy pressure bar */}
                <td className="px-2.5 py-2 text-right">
                  <span className="font-mono tabular-nums">{t.holderCount}</span>
                  {buyShare != null && (
                    <span className="mt-0.5 flex h-1 w-14 ml-auto overflow-hidden rounded-full bg-red-500/40">
                      <span
                        className="h-full bg-green-500"
                        style={{ width: `${Math.round(buyShare * 100)}%` }}
                      />
                    </span>
                  )}
                </td>
                {/* Age */}
                <td className="px-2.5 py-2 text-right text-muted-foreground tabular-nums">
                  {compactAge(t.createdAt)}
                </td>
                {/* Sparkline */}
                <td className="px-2.5 py-2 text-right">
                  <span className="inline-block align-middle">
                    <Sparkline data={t.sparkline} width={64} height={22} />
                  </span>
                </td>
                {/* Actions */}
                <td className="px-2.5 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <QuickBuyButton tokenId={t.id} compact />
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleWatch(t.id, t.symbol);
                      }}
                      className="p-1 text-muted-foreground hover:text-yellow-500"
                      title={isWatched(t.id) ? 'Unwatch' : 'Watch'}
                    >
                      <Star
                        className={`h-3.5 w-3.5 ${
                          isWatched(t.id) ? 'fill-yellow-500 text-yellow-500' : ''
                        }`}
                      />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tokens.length === 0 && (
        <p className="py-10 text-center text-xs text-muted-foreground">
          No tokens match your filters
        </p>
      )}
    </div>
  );
});
