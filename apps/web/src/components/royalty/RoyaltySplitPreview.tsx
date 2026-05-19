/**
 * RoyaltySplitPreview — drop-in preview card for any flow that mints,
 * lists, or licenses an asset with lineage.
 *
 * Pass an `assetId` and it fetches the full split from the server,
 * displays recipients with role badges (root / ancestor / parent / current)
 * and bps shares as gradient bars. If `assetId` is null, falls back to a
 * `previewSplit()` against a hypothetical chain length.
 */

import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Coins, Info } from 'lucide-react';

interface Recipient {
  creatorUid: string;
  creatorAddress: string | null;
  depth: number;
  bps: number;
  role: 'root' | 'ancestor' | 'parent' | 'current';
}

interface ResolvedSplit {
  assetId: string;
  rightsClass: 'fan' | 'original' | 'licensed';
  policyId: string;
  recipients: Recipient[];
  chainDepth: number;
  truncated: boolean;
}

const ROLE_TINT: Record<string, string> = {
  current: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  parent: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  ancestor: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  root: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

function bpsLabel(bps: number): string {
  const pct = bps / 100;
  return pct.toFixed(pct < 10 ? 1 : 0) + '%';
}

function abbreviateAddress(addr: string | null): string {
  if (!addr) return 'no wallet';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  assetId: string | null;
  /** When assetId is null, preview with this hypothetical chain length. */
  previewChainLength?: number;
  /** Rights class used for the preview path. */
  previewRightsClass?: 'fan' | 'original' | 'licensed';
  /** Optional universe to load policy from (preview path). */
  previewUniverseId?: string;
  /** Compact mode reduces padding + hides the explainer. */
  compact?: boolean;
}

export function RoyaltySplitPreview({
  assetId,
  previewChainLength = 1,
  previewRightsClass = 'original',
  previewUniverseId,
  compact = false,
}: Props) {
  const { data: resolved, isLoading } = useQuery<ResolvedSplit>({
    queryKey: ['royaltySplits', 'resolve', assetId],
    queryFn: () =>
      trpcClient.royaltySplits.resolve.query({ assetId: assetId! }) as Promise<ResolvedSplit>,
    enabled: !!assetId,
    staleTime: 30_000,
  });

  const { data: preview } = useQuery({
    queryKey: [
      'royaltySplits',
      'preview',
      previewChainLength,
      previewRightsClass,
      previewUniverseId,
    ],
    queryFn: () =>
      trpcClient.royaltySplits.preview.query({
        chainLength: previewChainLength,
        rightsClass: previewRightsClass,
        universeId: previewUniverseId,
      }) as Promise<{ policyId: string; shares: number[] }>,
    enabled: !assetId,
    staleTime: 60_000,
  });

  const pad = compact ? 'p-3' : 'p-4';

  if (assetId && isLoading) {
    return (
      <Card className={`${pad} flex items-center gap-2`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Resolving royalty split…</span>
      </Card>
    );
  }

  // Preview path — show the bps array as anonymous slots.
  if (!assetId && preview) {
    return (
      <Card className={`${pad} space-y-2`}>
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-pink-400" />
          <p className="text-xs font-medium">Royalty preview</p>
          <Badge variant="outline" className="text-[9px] capitalize">
            {preview.policyId.replace(/_/g, ' ')}
          </Badge>
        </div>
        <div className="space-y-1">
          {preview.shares.map((bps, i) => {
            const isCurrent = i === preview.shares.length - 1;
            const role = isCurrent ? 'current' : i === 0 ? 'root' : 'ancestor';
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${ROLE_TINT[role]}`}>
                  {isCurrent ? 'You' : `Lineage #${i + 1}`}
                </Badge>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
                    style={{ width: `${bps / 100}%` }}
                  />
                </div>
                <span className="font-mono font-medium w-12 text-right">{bpsLabel(bps)}</span>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  if (!resolved) return null;

  return (
    <Card className={`${pad} space-y-3`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-pink-400" />
          <p className="text-xs font-medium">Royalty split</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[9px] capitalize">
            {resolved.rightsClass}
          </Badge>
          <Badge variant="outline" className="text-[9px] capitalize">
            {resolved.policyId.replace(/_/g, ' ')}
          </Badge>
          <Badge variant="outline" className="text-[9px]">
            depth {resolved.chainDepth}
          </Badge>
        </div>
      </div>

      <div className="space-y-1.5">
        {resolved.recipients.map((r) => (
          <div key={`${r.creatorUid}-${r.depth}`} className="flex items-center gap-2 text-[11px]">
            <Badge
              variant="outline"
              className={`text-[9px] h-4 px-1.5 capitalize ${ROLE_TINT[r.role]}`}
            >
              {r.role}
            </Badge>
            <span
              className="font-mono text-muted-foreground truncate flex-1"
              title={r.creatorAddress ?? r.creatorUid}
            >
              {abbreviateAddress(r.creatorAddress)}
            </span>
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
                style={{ width: `${r.bps / 100}%` }}
              />
            </div>
            <span className="font-mono font-medium w-12 text-right">{bpsLabel(r.bps)}</span>
          </div>
        ))}
      </div>

      {resolved.truncated && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-400 italic">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Lineage chain truncated by policy maxDepth — earliest ancestors merged into root.
        </div>
      )}
      {!compact && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          Splits are computed from this asset's lineage graph and your universe's policy. Every
          monetized event downstream — sale, license, derivative resale — distributes by these
          shares.
        </p>
      )}
    </Card>
  );
}
