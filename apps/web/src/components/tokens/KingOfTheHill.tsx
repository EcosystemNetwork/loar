/** Featured banner for the launchpad's King of the Hill token (see pickKingOfTheHill). */
import { Link } from '@tanstack/react-router';
import { Crown } from 'lucide-react';
import { formatCompactEth, type EnrichedToken } from '@/hooks/useTokens';

export function KingOfTheHill({ token }: { token: EnrichedToken }) {
  const pct = Math.max(0, Math.min(100, token.graduationPct));
  return (
    <Link
      to="/tokens/$address"
      params={{ address: token.id }}
      aria-label={`King of the Hill: ${token.name}`}
      className="group mb-5 flex items-center gap-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-3 sm:p-4 hover:border-amber-500/70 transition-colors"
    >
      <div className="relative flex-shrink-0">
        {token.imageURL ? (
          <img
            src={token.imageURL}
            alt={token.symbol}
            className="h-14 w-14 rounded-xl object-cover ring-2 ring-amber-500/60"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/15 text-sm font-bold text-amber-500 ring-2 ring-amber-500/60">
            {token.symbol.slice(0, 3)}
          </span>
        )}
        <Crown className="absolute -top-3 -left-2 h-5 w-5 -rotate-12 fill-amber-400 text-amber-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
          King of the Hill
        </p>
        <p className="truncate font-semibold">
          {token.name} <span className="text-muted-foreground font-normal">${token.symbol}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
            {pct.toFixed(0)}% to Uniswap
          </span>
        </div>
      </div>
      <div className="hidden sm:block text-right flex-shrink-0">
        <p className="text-[10px] uppercase text-muted-foreground">Market cap</p>
        <p className="font-mono text-sm font-bold tabular-nums">
          {formatCompactEth(token.marketCap ?? 0)} ETH
        </p>
      </div>
    </Link>
  );
}
