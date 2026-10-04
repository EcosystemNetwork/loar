/**
 * LiveTradesFeed — cross-token trade stream for the launchpad sidebar.
 * Each row reads as a sentence: "0x12…ab bought 0.05 ETH of $SYM · 2m".
 */
import { Link } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { formatEth, timeAgo, type EnrichedToken } from '@/hooks/useTokens';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { cn } from '@/lib/utils';
import { DOWN, TokenAvatar, UP } from './primitives';

export interface LiveActivityItem {
  kind: 'swap' | 'bondingTrade';
  id: string;
  timestamp: number;
  sender: string;
  token: EnrichedToken;
  isBuy: boolean;
  ethAmountWei: string;
}

export function LiveTradesFeed({ items }: { items: LiveActivityItem[] }) {
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Live trades">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Live trades</h2>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </header>

      {items.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium">No trades yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Buys and sells across every token show up here.
          </p>
        </div>
      ) : (
        <ol className="max-h-[640px] divide-y divide-border overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/tokens/$address"
                params={{ address: item.token.id }}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
              >
                <TokenAvatar
                  imageURL={item.token.imageURL}
                  symbol={item.token.symbol}
                  size="sm"
                  className="h-8 w-8"
                />
                <div className="min-w-0 flex-1 text-xs leading-snug">
                  <p className="truncate">
                    <span className="font-semibold">${item.token.symbol}</span>{' '}
                    <span className={cn('font-medium', item.isBuy ? UP : DOWN)}>
                      {item.isBuy ? 'buy' : 'sell'}
                    </span>
                    {item.kind === 'bondingTrade' && (
                      <span className="text-muted-foreground"> · curve</span>
                    )}
                  </p>
                  <p className="truncate text-muted-foreground">
                    <AddressDisplay address={item.sender} /> · {timeAgo(item.timestamp)}
                  </p>
                </div>
                <span className="flex-shrink-0 font-mono text-xs font-semibold tabular-nums">
                  {formatEth(item.ethAmountWei)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
