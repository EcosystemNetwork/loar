/**
 * TokenCard — launchpad grid card. Identity + market cap lead, the curve
 * progress sits underneath, and secondary stats are one quiet row.
 */
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { MessageCircle, Star } from 'lucide-react';
import { formatCompactEth, weiToNumber, type EnrichedToken } from '@/hooks/useTokens';
import { Sparkline } from '@/components/tokens/Sparkline';
import { QuickBuyButton } from '@/components/tokens/QuickBuyButton';
import { cn } from '@/lib/utils';
import { Change, GraduationBar, StagePill, TokenAvatar } from './primitives';
import { compactAge } from './format';

export const TokenCard = memo(function TokenCard({
  token,
  isWatched,
  onToggleWatch,
  commentCount = 0,
}: {
  token: EnrichedToken;
  isWatched: boolean;
  onToggleWatch: () => void;
  commentCount?: number;
}) {
  const isBrandNew = Math.floor(Date.now() / 1000) - token.createdAt < 1800;
  const curve = token.bondingCurve;
  const raised = curve ? weiToNumber(curve.ethRaised, 18) : 0;
  const target = curve ? weiToNumber(curve.graduationEth, 18) : 0;

  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 motion-reduce:hover:translate-y-0">
      {/* Whole-card link sits under the interactive controls */}
      <Link
        to="/tokens/$address"
        params={{ address: token.id }}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${token.name} ($${token.symbol})`}
      />

      <div className="pointer-events-none relative z-10 flex gap-3 p-4 pb-3">
        <div className="relative">
          <TokenAvatar imageURL={token.imageURL} symbol={token.symbol} size="lg" />
          {isBrandNew && (
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-primary px-1.5 py-px text-[9px] font-bold uppercase text-primary-foreground shadow">
              New
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold leading-tight">{token.name}</h3>
            {token.priceChange24h != null && (
              <Change
                value={token.priceChange24h}
                className="flex-shrink-0 text-xs font-semibold"
              />
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground/80">${token.symbol}</span>
            <span aria-hidden>·</span>
            <span>{compactAge(token.createdAt)} ago</span>
            {commentCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <MessageCircle className="h-3 w-3" aria-hidden />
                  {commentCount}
                </span>
              </>
            )}
          </p>
          <div className="mt-1.5">
            <StagePill stage={token.stage} />
          </div>
        </div>
      </div>

      <div className="pointer-events-none relative z-10 flex items-end justify-between gap-3 px-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Market cap</p>
          <p className="text-xl font-semibold tabular-nums">
            {token.marketCap != null && token.marketCap > 0
              ? formatCompactEth(token.marketCap)
              : '--'}
            <span className="ml-1 text-xs font-normal text-muted-foreground">ETH</span>
          </p>
        </div>
        <Sparkline data={token.sparkline} width={88} height={32} />
      </div>

      <div className="pointer-events-none relative z-10 px-4 pt-3">
        {curve && token.stage !== 'graduated' ? (
          <>
            <GraduationBar pct={token.graduationPct} stage={token.stage} />
            <p className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{token.stage === 'halted' ? 'Trading halted' : 'To Uniswap'}</span>
              <span className="font-mono tabular-nums">
                {raised.toFixed(2)} / {target.toFixed(1)} ETH
              </span>
            </p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Trading on Uniswap v4 · LP locked forever
          </p>
        )}
      </div>

      <footer className="relative z-10 mt-3 flex items-center gap-3 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        <span className="pointer-events-none">
          <span className="font-mono font-medium text-foreground tabular-nums">
            {token.volume24h >= 0.001 ? formatCompactEth(token.volume24h) : '0'}
          </span>{' '}
          vol
        </span>
        <span className="pointer-events-none">
          <span className="font-mono font-medium text-foreground tabular-nums">
            {token.holderCount}
          </span>{' '}
          holders
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleWatch}
            aria-pressed={isWatched}
            aria-label={
              isWatched ? `Remove ${token.symbol} from watchlist` : `Watch ${token.symbol}`
            }
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star className={cn('h-4 w-4', isWatched && 'fill-primary text-primary')} aria-hidden />
          </button>
          <QuickBuyButton tokenId={token.id} />
        </div>
      </footer>
    </article>
  );
});
