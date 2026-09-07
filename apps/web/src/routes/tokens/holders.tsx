/**
 * Cross-token holder leaderboard — ranks addresses by the total ETH value of
 * every universe-token position they hold, joined against live prices.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTokenListData, formatCompactEth, weiToNumber } from '@/hooks/useTokens';
import { useAllTokenHolders } from '@/hooks/useTokenAnalytics';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { QueryState } from '@/components/QueryState';
import { ArrowLeft, Crown, Trophy } from 'lucide-react';

export const Route = createFileRoute('/tokens/holders')({
  component: HolderLeaderboardPage,
});

const ZERO = '0x0000000000000000000000000000000000000000';

interface HolderAgg {
  address: string;
  valueEth: number;
  tokenCount: number;
  top: { symbol: string; valueEth: number } | null;
}

function HolderLeaderboardPage() {
  const { data: tokens, isLoading: tokensLoading, isError, refetch } = useTokenListData();
  const { data: holders = [], isLoading: holdersLoading } = useAllTokenHolders(1000);

  const rows = useMemo<HolderAgg[]>(() => {
    if (!tokens.length || !holders.length) return [];
    const byAddr = new Map(tokens.map((t) => [t.id.toLowerCase(), t]));
    // Addresses that aren't real holders: bonding curves + LP lockers.
    const excluded = new Set<string>([ZERO]);
    for (const t of tokens) {
      if (t.bondingCurve) excluded.add(t.bondingCurve.id.toLowerCase());
      if (t.locker) excluded.add(t.locker.toLowerCase());
      excluded.add(t.poolId.toLowerCase());
    }

    const agg = new Map<
      string,
      { valueEth: number; tokenCount: number; top: { symbol: string; valueEth: number } | null }
    >();
    for (const h of holders) {
      const holder = h.holderAddress.toLowerCase();
      if (excluded.has(holder)) continue;
      const token = byAddr.get(h.tokenAddress.toLowerCase());
      if (!token || token.price == null) continue;
      const bal = weiToNumber(h.balance, 18);
      if (bal <= 0) continue;
      const value = bal * token.price;
      const cur = agg.get(holder) ?? { valueEth: 0, tokenCount: 0, top: null };
      cur.valueEth += value;
      cur.tokenCount += 1;
      if (!cur.top || value > cur.top.valueEth) cur.top = { symbol: token.symbol, valueEth: value };
      agg.set(holder, cur);
    }

    return Array.from(agg.entries())
      .map(([address, v]) => ({ address, ...v }))
      .filter((r) => r.valueEth > 0)
      .sort((a, b) => b.valueEth - a.valueEth)
      .slice(0, 100);
  }, [tokens, holders]);

  const totalTracked = rows.reduce((s, r) => s + r.valueEth, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center gap-4">
          <Link to="/tokens">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Launchpad
            </Button>
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Trophy className="h-6 w-6 text-primary" />
              Top Holders
            </h1>
            <p className="text-sm text-muted-foreground">
              Biggest positions across every universe token, by live ETH value.
            </p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Ranked holders</p>
              <p className="text-xl font-bold">{rows.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Value ranked (ETH)</p>
              <p className="text-xl font-bold">{formatCompactEth(totalTracked)}</p>
            </CardContent>
          </Card>
        </div>

        <QueryState
          isLoading={tokensLoading || holdersLoading}
          isError={isError}
          isEmpty={rows.length === 0}
          onRetry={() => refetch()}
          errorMessage="Failed to load holder data."
          skeletonCount={10}
          emptyState={
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No holder positions indexed yet.
              </CardContent>
            </Card>
          }
        >
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {rows.map((r, i) => (
                <div key={r.address} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span
                    className={`w-6 text-right font-mono text-xs tabular-nums ${
                      i === 0 ? 'text-amber-500' : 'text-muted-foreground'
                    }`}
                  >
                    {i === 0 ? <Crown className="ml-auto h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <AddressDisplay
                    address={r.address}
                    showAvatar
                    className="flex-1 truncate text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {r.tokenCount} token{r.tokenCount === 1 ? '' : 's'}
                    {r.top && ` · top $${r.top.symbol}`}
                  </span>
                  <span className="w-24 text-right font-mono font-semibold tabular-nums">
                    {formatCompactEth(r.valueEth)} ETH
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </QueryState>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Ranked from the most recent {1000} indexed balances — a leaderboard of the largest
          positions, not a full holder census. Bonding-curve and LP-locker addresses are excluded.
        </p>
      </div>
    </div>
  );
}
