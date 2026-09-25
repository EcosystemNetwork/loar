/**
 * DevBuyStep — the creator's optional first buy, shown right after a token launch.
 *
 * The deploy transaction can't buy atomically (the launcher contract has no
 * buy-on-create), so the flow is: wait for the indexer to see the new token and
 * its bonding curve, then let the creator confirm a normal curve buy. It is a
 * separate, explicit signature — never fired automatically.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, Loader2, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ponderGql } from '@/utils/ponder-api';
import { useBondingCurveActions } from '@/hooks/useBondingCurve';

interface FoundToken {
  tokenAddress: string;
  curveAddress: string | null;
}

/** Poll the indexer for the token this wallet just deployed, then its curve. */
export function useLaunchedToken(deployer: string, symbol: string, sinceSec: number) {
  return useQuery({
    queryKey: ['launched-token', deployer.toLowerCase(), symbol, sinceSec],
    refetchInterval: (q) => (q.state.data?.curveAddress ? false : 4000),
    retry: false,
    queryFn: async (): Promise<FoundToken | null> => {
      const t = await ponderGql<{
        tokens: { items: { id: string; symbol: string; createdAt: number }[] };
      }>(
        `query ($deployer: String!) {
          tokens(where: { deployer: $deployer }, orderBy: "createdAt", orderDirection: "desc", limit: 5) {
            items { id symbol createdAt }
          }
        }`,
        { deployer: deployer.toLowerCase() }
      );
      const token = (t.tokens?.items ?? []).find(
        (x) => x.symbol?.toUpperCase() === symbol.toUpperCase() && x.createdAt >= sinceSec - 120
      );
      if (!token) return null;
      const c = await ponderGql<{ bondingCurves: { items: { id: string }[] } }>(
        `query ($tokenAddress: String!) {
          bondingCurves(where: { tokenAddress: $tokenAddress }, limit: 1) { items { id } }
        }`,
        { tokenAddress: token.id.toLowerCase() }
      );
      return { tokenAddress: token.id, curveAddress: c.bondingCurves?.items?.[0]?.id ?? null };
    },
  });
}

export function DevBuyStep({
  deployer,
  symbol,
  ethAmount,
  sinceSec,
}: {
  deployer: string;
  symbol: string;
  ethAmount: string;
  sinceSec: number;
}) {
  const found = useLaunchedToken(deployer, symbol, sinceSec);
  const curve = (found.data?.curveAddress ?? undefined) as `0x${string}` | undefined;
  const { buy, status, error, retry, canRetry } = useBondingCurveActions(curve);
  const tokenPath = found.data?.tokenAddress;

  // Give up waiting after ~2 minutes and point at the token page instead.
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaitedTooLong(true), 120_000);
    return () => clearTimeout(id);
  }, []);

  const bought = status === 'success';

  return (
    <div className="p-4 rounded-md border border-primary/30 bg-primary/5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {bought ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <ShoppingCart className="h-4 w-4 text-primary" />
        )}
        {bought ? `Bought ${ethAmount} ETH of $${symbol}` : `Your first buy — ${ethAmount} ETH`}
      </div>

      {!curve && !waitedTooLong && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Token deployed — waiting for the indexer to pick up your bonding curve (usually under a
          minute)…
        </p>
      )}
      {!curve && waitedTooLong && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          The indexer is taking longer than usual. Your token is live — open its page and buy from
          there.
        </p>
      )}

      {curve && !bought && (
        <>
          <p className="text-xs text-muted-foreground">
            Buys from the bonding curve at the current price with slippage protection. This is a
            separate wallet confirmation.
          </p>
          <Button
            className="w-full"
            onClick={() => buy(ethAmount)}
            disabled={status === 'confirming' || status === 'pending'}
          >
            {status === 'confirming' || status === 'pending' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {status === 'confirming' ? 'Confirm in your wallet…' : 'Waiting for confirmation…'}
              </>
            ) : (
              `Buy ${ethAmount} ETH of $${symbol}`
            )}
          </Button>
          {status === 'error' && error && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {error}{' '}
              {canRetry && (
                <button className="underline" onClick={() => retry()}>
                  Retry
                </button>
              )}
            </p>
          )}
        </>
      )}

      <div className="flex items-center justify-between text-xs">
        {tokenPath ? (
          <Link to="/tokens/$address" params={{ address: tokenPath }} className="underline">
            {bought ? 'View your token' : 'Skip — view token'}
          </Link>
        ) : (
          <Link to="/tokens" className="underline">
            Back to launchpad
          </Link>
        )}
      </div>
    </div>
  );
}
