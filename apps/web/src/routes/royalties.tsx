/**
 * /royalties — Royalty splits dashboard.
 *
 * Surfaces:
 *   1. Per-asset split lookup — paste any assetId, see the full chain
 *      with bps per recipient.
 *   2. Hypothetical preview — pick a chain length + rights class and see
 *      what the split would be (useful when designing a remix campaign).
 *   3. Policy summary — what the active universe policy is set to.
 *
 * The /royalties page complements the existing /lineage/$assetId surface:
 * lineage shows the family tree, this shows the money flow.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { awaitSessionValidation } from '@/lib/wallet-auth';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Coins, Info } from 'lucide-react';
import { RoyaltySplitPreview } from '@/components/royalty/RoyaltySplitPreview';

export const Route = createFileRoute('/royalties')({
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      // Cast through any — TanStack's generated routeTree hasn't picked up
      // this file yet; the next dev/build run regenerates it.
      throw redirect({ to: '/login', search: { redirect: '/royalties' as any } });
    }
    await awaitSessionValidation();
  },
  component: RoyaltiesPage,
});

function RoyaltiesPage() {
  const [assetId, setAssetId] = useState('');
  const [chainLen, setChainLen] = useState(3);
  const [rightsClass, setRightsClass] = useState<'fan' | 'original' | 'licensed'>('original');
  const [universeId, setUniverseId] = useState('');

  const { data: policy } = useQuery({
    queryKey: ['royaltySplits', 'getPolicy', universeId],
    queryFn: () =>
      trpcClient.royaltySplits.getPolicy.query(universeId ? { universeId } : undefined) as Promise<{
        universeId: string | null;
        config: {
          byRightsClass: Record<string, string>;
          maxDepth: number;
          minShareBps: number;
        };
      }>,
    staleTime: 30_000,
  });

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Coins className="h-7 w-7 text-pink-400" />
        <div>
          <h1 className="text-2xl font-semibold">Royalty Splits</h1>
          <p className="text-sm text-muted-foreground">
            Lineage-aware revenue distribution. Every remix pays the chain it came from.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Asset lookup */}
        <Card className="p-5 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Look up an asset</p>
            <p className="text-[11px] text-muted-foreground">
              Paste a generationId / contentId — we'll walk its lineage and compute the split.
            </p>
          </div>
          <Input
            value={assetId}
            onChange={(e) => setAssetId(e.target.value.trim())}
            placeholder="generationId or contentId"
          />
          {assetId.length >= 8 && <RoyaltySplitPreview assetId={assetId} />}
        </Card>

        {/* Hypothetical preview */}
        <Card className="p-5 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Hypothetical preview</p>
            <p className="text-[11px] text-muted-foreground">
              What would the split be for an N-deep chain with this rights class?
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="chain" className="text-xs">
                Chain length
              </Label>
              <Select value={String(chainLen)} onValueChange={(v) => setChainLen(Number(v))}>
                <SelectTrigger id="chain">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="rights" className="text-xs">
                Rights class
              </Label>
              <Select value={rightsClass} onValueChange={(v) => setRightsClass(v as any)}>
                <SelectTrigger id="rights">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fan">Fan</SelectItem>
                  <SelectItem value="original">Original</SelectItem>
                  <SelectItem value="licensed">Licensed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="universe" className="text-xs">
              Universe ID (optional)
            </Label>
            <Input
              id="universe"
              value={universeId}
              onChange={(e) => setUniverseId(e.target.value.trim())}
              placeholder="Leave blank for platform default"
            />
          </div>
          <RoyaltySplitPreview
            assetId={null}
            previewChainLength={chainLen}
            previewRightsClass={rightsClass}
            previewUniverseId={universeId || undefined}
          />
        </Card>
      </div>

      {/* Active policy */}
      {policy && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-purple-400" />
            <p className="text-sm font-medium">
              Active policy{' '}
              {policy.universeId
                ? `for universe ${policy.universeId.slice(0, 8)}…`
                : '(platform default)'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(['fan', 'original', 'licensed'] as const).map((rc) => (
              <div key={rc} className="rounded-md border border-border/40 p-3 space-y-1">
                <p className="text-[11px] text-muted-foreground capitalize">{rc}</p>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {policy.config.byRightsClass[rc].replace(/_/g, ' ')}
                </Badge>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span>
              Max depth: <span className="font-mono text-foreground">{policy.config.maxDepth}</span>
            </span>
            <span>
              Min share:{' '}
              <span className="font-mono text-foreground">
                {(policy.config.minShareBps / 100).toFixed(2)}%
              </span>
            </span>
          </div>
        </Card>
      )}

      <Card className="p-4 border-border/40 bg-muted/20">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">How splits flow:</span> Each asset has a
          lineage chain (root → parent → … → current). At settlement time, the universe's policy
          picks one of four strategies — <span className="font-mono">current_only</span>,{' '}
          <span className="font-mono">decay_7030</span>,{' '}
          <span className="font-mono">split_50_30_20</span>, or{' '}
          <span className="font-mono">equal_share</span> — and computes basis-point shares for every
          recipient. Settlement itself happens on-chain via{' '}
          <span className="font-mono">contentLicensing</span> /{' '}
          <span className="font-mono">likenessMarketplace</span>; this layer just tells those
          contracts <em>what</em> to pay.
        </p>
      </Card>
    </div>
  );
}
