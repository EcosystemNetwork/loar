/**
 * Holder bubble map — one bubble per top holder (area ∝ balance), coloured by role,
 * plus a sniper / bundle summary. Detection only: it shows who bought in the first
 * few blocks and which wallets look bundled, it cannot prevent either.
 */
import { useMemo } from 'react';
import { Radar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  classifyHolder,
  detectSnipersAndBundles,
  packBubbles,
  supplyShare,
  type HolderRole,
} from '@/lib/token-forensics';
import type { TokenTransferRow } from '@/hooks/useTokenAnalytics';

const W = 360;
const H = 260;

const ROLE_STYLE: Record<HolderRole, { fill: string; label: string }> = {
  creator: { fill: '#f59e0b', label: 'Creator' },
  contract: { fill: '#6b7280', label: 'Curve / contract' },
  bundle: { fill: '#f97316', label: 'Bundled buyers' },
  sniper: { fill: '#ef4444', label: 'Early sniper' },
  holder: { fill: '#8b5cf6', label: 'Holder' },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function HolderBubbleMap({
  holders,
  transfers,
  creators,
  contracts,
  circulatingSupplyWei,
}: {
  holders: { holderAddress: string; balance: string }[];
  transfers: TokenTransferRow[];
  creators: string[];
  contracts: string[];
  circulatingSupplyWei: bigint;
}) {
  const analysis = useMemo(() => {
    const rows = holders
      .map((h) => {
        try {
          return { address: h.holderAddress, balance: BigInt(h.balance) };
        } catch {
          return { address: h.holderAddress, balance: 0n };
        }
      })
      .filter((h) => h.balance > 0n)
      .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))
      .slice(0, 40);

    const { snipers, bundled } = detectSnipersAndBundles(transfers, {
      exclude: [...creators, ...contracts],
    });
    const ctx = { creators, contracts, snipers, bundled };
    const total = rows.reduce((s, r) => s + r.balance, 0n);
    const bubbles = packBubbles(
      rows.map((r) => ({ id: r.address, value: Number(r.balance / 10n ** 12n) / 1e6 })),
      W,
      H
    ).map((b) => {
      const row = rows.find((r) => r.address === b.id)!;
      return {
        ...b,
        role: classifyHolder(b.id, ctx),
        pct: total > 0n ? Number((row.balance * 10000n) / total) / 100 : 0,
      };
    });
    // Share of *circulating* supply, so a curve-bound token isn't diluted by escrowed supply.
    const sniperPct = supplyShare(snipers, rows, circulatingSupplyWei);
    const bundlePct = supplyShare(bundled, rows, circulatingSupplyWei);
    return { bubbles, sniperCount: snipers.size, bundleCount: bundled.size, sniperPct, bundlePct };
  }, [holders, transfers, creators, contracts, circulatingSupplyWei]);

  if (analysis.bubbles.length === 0) return null;
  const roles = Array.from(new Set(analysis.bubbles.map((b) => b.role)));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Holder Map</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            top {analysis.bubbles.length}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full rounded-md bg-muted/30"
          role="img"
          aria-label="Bubble map of the largest holders"
        >
          {analysis.bubbles.map((b) => (
            <circle
              key={b.id}
              cx={b.x}
              cy={b.y}
              r={b.r}
              fill={ROLE_STYLE[b.role].fill}
              fillOpacity={0.75}
              stroke={ROLE_STYLE[b.role].fill}
              strokeWidth={1}
            >
              <title>{`${short(b.id)} · ${ROLE_STYLE[b.role].label} · ${b.pct.toFixed(1)}% of top holders`}</title>
            </circle>
          ))}
        </svg>

        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {roles.map((r) => (
            <span key={r} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: ROLE_STYLE[r].fill }} />
              {ROLE_STYLE[r].label}
            </span>
          ))}
        </div>

        <div className="space-y-1 rounded-md border p-2 text-xs">
          {analysis.sniperCount === 0 ? (
            <p className="text-muted-foreground">No early snipers detected.</p>
          ) : (
            <p>
              <span className="font-semibold text-red-500">{analysis.sniperCount}</span> wallet
              {analysis.sniperCount === 1 ? '' : 's'} bought within the first few blocks
              {analysis.sniperPct > 0 && (
                <>
                  {' '}
                  and hold <span className="font-semibold">
                    {analysis.sniperPct.toFixed(1)}%
                  </span>{' '}
                  of circulating supply
                </>
              )}
              .
            </p>
          )}
          {analysis.bundleCount > 0 && (
            <p>
              <span className="font-semibold text-orange-500">{analysis.bundleCount}</span> wallets
              look bundled (funded in the same block)
              {analysis.bundlePct > 0 && <> holding {analysis.bundlePct.toFixed(1)}%</>}.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Detection only — based on indexed transfers, not a guarantee.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
