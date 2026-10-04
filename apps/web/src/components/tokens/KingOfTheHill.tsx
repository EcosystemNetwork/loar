/**
 * Featured hero for the launchpad's King of the Hill token (see pickKingOfTheHill),
 * or the admin-pinned token when `featured` is set.
 */
import { Link } from '@tanstack/react-router';
import { ArrowRight, Crown } from 'lucide-react';
import { formatCompactEth, weiToNumber, type EnrichedToken } from '@/hooks/useTokens';
import { Change, GraduationBar, TokenAvatar } from './launchpad/primitives';
import { formatPrice } from './launchpad/format';

export function KingOfTheHill({ token, featured }: { token: EnrichedToken; featured?: boolean }) {
  const label = featured ? 'Featured' : 'King of the Hill';
  const pct = Math.max(0, Math.min(100, token.graduationPct));
  const curve = token.bondingCurve;
  const raised = curve ? weiToNumber(curve.ethRaised, 18) : 0;
  const target = curve ? weiToNumber(curve.graduationEth, 18) : 0;

  return (
    <Link
      to="/tokens/$address"
      params={{ address: token.id }}
      aria-label={`${label}: ${token.name}`}
      className="group relative block overflow-hidden rounded-2xl border border-primary/30 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* Blurred token art as ambient backdrop */}
      {token.imageURL && (
        <img
          src={token.imageURL}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-20 blur-3xl"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/15 via-card/60 to-card" />

      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="relative flex-shrink-0 self-start">
          <TokenAvatar
            imageURL={token.imageURL}
            symbol={token.symbol}
            size="xl"
            className="ring-2 ring-primary/60 ring-offset-2 ring-offset-card"
          />
          <Crown
            className="absolute -left-3 -top-3 h-7 w-7 -rotate-12 fill-primary text-primary drop-shadow"
            aria-hidden
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{label}</p>
          <h2 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">
            {token.name}{' '}
            <span className="font-mono text-base font-medium text-muted-foreground">
              ${token.symbol}
            </span>
          </h2>
          <div className="mt-3 max-w-md">
            <GraduationBar pct={pct} stage={token.stage} className="h-2" />
            <p className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">{pct.toFixed(0)}%</span> of the way
                to Uniswap
              </span>
              {curve && (
                <span className="font-mono tabular-nums">
                  {raised.toFixed(2)} / {target.toFixed(1)} ETH
                </span>
              )}
            </p>
          </div>
        </div>

        <dl className="grid flex-shrink-0 grid-cols-3 gap-6 sm:grid-cols-1 sm:gap-2 sm:text-right">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Market cap
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatCompactEth(token.marketCap ?? 0)} ETH
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Price</dt>
            <dd className="font-mono text-sm tabular-nums">{formatPrice(token.price)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">24h</dt>
            <dd className="text-sm">
              <Change value={token.priceChange24h} />
            </dd>
          </div>
        </dl>

        <ArrowRight
          className="hidden h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none lg:block"
          aria-hidden
        />
      </div>
    </Link>
  );
}
