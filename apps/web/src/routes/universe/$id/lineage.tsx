/**
 * Universe Lineage Dashboard — PRD 10.
 *
 * Owner-only page that rolls up asset events for a universe:
 *   - Credit spend by tool + step
 *   - Edit-to-publish conversion rate
 *   - Most-remixed source assets
 *   - Style pack usage
 *   - Filtered feed by rights class / creator / step
 *
 * Mounts at /universe/:id/lineage. The owner check runs server-side in the
 * `creditSummary` / `performanceSummary` procedures.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  BarChart3,
  Coins,
  TrendingUp,
  GitBranch,
  Loader2,
  Sparkles,
  Shield,
  Palette,
} from 'lucide-react';

export const Route = createFileRoute('/universe/$id/lineage')({
  component: UniverseLineagePage,
});

type Range = 'day' | 'week' | 'month' | 'all';
type RightsClass = 'fan' | 'original' | 'licensed';
type Kind = 'generate' | 'edit' | 'variation' | 'animation' | 'publish';

type AssetEvent = {
  id: string;
  assetId: string;
  parentAssetId: string | null;
  rootAssetId: string;
  kind: Kind;
  tool: string;
  step: string;
  prompt: string | null;
  creditCost: number;
  latencyMs: number | null;
  creatorUid: string;
  rightsClass: RightsClass | null;
  outputUrl: string | null;
  outputKind: 'image' | 'video' | 'audio' | '3d' | 'other';
  status: 'completed' | 'failed';
  createdAt: string;
};

const RANGE_LABEL: Record<Range, string> = {
  day: '24h',
  week: '7d',
  month: '30d',
  all: 'All time',
};

const KINDS: Array<{ value: Kind | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'generate', label: 'Generate' },
  { value: 'edit', label: 'Edit' },
  { value: 'publish', label: 'Publish' },
];

const RIGHTS: Array<{ value: RightsClass | 'all'; label: string }> = [
  { value: 'all', label: 'All rights' },
  { value: 'fan', label: 'Fan' },
  { value: 'original', label: 'Original' },
  { value: 'licensed', label: 'Licensed' },
];

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function rangePicker(range: Range, setRange: (r: Range) => void) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden">
      {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`px-3 py-1.5 text-xs ${
            range === r ? 'bg-cyan-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Coins;
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="rounded-md bg-zinc-900 p-2 text-cyan-400">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-zinc-400">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </Card>
  );
}

function UniverseLineagePage() {
  const { id } = useParams({ from: '/universe/$id/lineage' });
  const [range, setRange] = useState<Range>('month');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [rightsClass, setRightsClass] = useState<RightsClass | 'all'>('all');
  const [creatorUid, setCreatorUid] = useState<string>('');

  const credits = useQuery({
    queryKey: ['lineage', 'credits', id, range],
    queryFn: () => trpcClient.lineage.creditSummary.query({ universeId: id, range }),
    staleTime: 30_000,
  });

  const perf = useQuery({
    queryKey: ['lineage', 'perf', id, range],
    queryFn: () => trpcClient.lineage.performanceSummary.query({ universeId: id, range }),
    staleTime: 30_000,
  });

  const feed = useQuery({
    queryKey: ['lineage', 'feed', id, range, kind, rightsClass, creatorUid],
    queryFn: () =>
      trpcClient.lineage.byUniverse.query({
        universeId: id,
        range,
        limit: 50,
        kind: kind === 'all' ? undefined : kind,
        rightsClass: rightsClass === 'all' ? undefined : rightsClass,
        creatorUid: creatorUid || undefined,
      }),
    staleTime: 15_000,
  });

  const events = (feed.data as AssetEvent[] | undefined) ?? [];

  // Non-owner callers get a 403 on the owner-only queries; show a friendly hint.
  const creditsForbidden = (credits.error as any)?.data?.code === 'FORBIDDEN';
  const perfForbidden = (perf.error as any)?.data?.code === 'FORBIDDEN';

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/universe/$id" params={{ id }}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <GitBranch className="h-5 w-5 text-cyan-500" />
        <div className="flex-1">
          <h1 className="text-xl font-bold">Lineage & Analytics</h1>
          <p className="text-xs text-zinc-400">
            Provenance, credits, rights, and edit performance for this universe.
          </p>
        </div>
        {rangePicker(range, setRange)}
      </div>

      {(creditsForbidden || perfForbidden) && (
        <Card className="p-4 mb-6 border-amber-700 bg-amber-950/30 text-amber-200 text-sm">
          Aggregate credit & performance stats are visible to the universe creator only. You can
          still browse public events below.
        </Card>
      )}

      {/* ── Credit spend ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-3">Credit spend</h2>

        {credits.isLoading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!credits.isLoading && !creditsForbidden && credits.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 mb-4">
              <Stat
                label={`Credits (${RANGE_LABEL[range]})`}
                value={credits.data.totalCredits.toLocaleString()}
                icon={Coins}
              />
              <Stat
                label="Events"
                value={credits.data.totalEvents.toLocaleString()}
                icon={Sparkles}
              />
              <Stat label="Tools active" value={credits.data.byTool.length} icon={BarChart3} />
            </div>

            {credits.data.byTool.length > 0 && (
              <Card className="p-4 space-y-2">
                <div className="grid grid-cols-[1fr_120px_80px_120px] text-xs text-zinc-500 mb-2 pb-2 border-b border-zinc-800">
                  <div>Tool</div>
                  <div>Step</div>
                  <div className="text-right">Runs</div>
                  <div className="text-right">Credits</div>
                </div>
                {credits.data.byTool.slice(0, 15).map((row: any) => (
                  <div
                    key={`${row.tool}:${row.step}`}
                    className="grid grid-cols-[1fr_120px_80px_120px] text-sm py-1.5 border-b border-zinc-900 last:border-b-0"
                  >
                    <div className="font-mono truncate">{row.tool}</div>
                    <div className="text-zinc-400">{row.step}</div>
                    <div className="text-right">{row.count}</div>
                    <div className="text-right font-semibold">{row.credits.toLocaleString()}</div>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
      </section>

      {/* ── Performance ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-3">Edit performance</h2>

        {perf.isLoading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!perf.isLoading && !perfForbidden && perf.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-4 mb-4">
              <Stat label="Generations" value={perf.data.generations} icon={Sparkles} />
              <Stat label="Edits" value={perf.data.edits} icon={TrendingUp} />
              <Stat label="Publishes" value={perf.data.publishes} icon={Shield} />
              <Stat
                label="Edit → Publish"
                value={`${(perf.data.editToPublishRate * 100).toFixed(0)}%`}
                icon={BarChart3}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
                  <TrendingUp className="h-3 w-3" /> Top remixed assets
                </div>
                {perf.data.topRemixed.length === 0 ? (
                  <div className="text-xs text-zinc-500 italic">
                    No remixes recorded in this range.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {perf.data.topRemixed.map((row: any) => (
                      <div
                        key={row.rootAssetId}
                        className="flex items-center justify-between text-sm py-1"
                      >
                        <Link
                          to="/lineage/$assetId"
                          params={{ assetId: row.rootAssetId }}
                          className="font-mono text-xs text-cyan-400 hover:underline truncate max-w-[65%]"
                        >
                          {row.rootAssetId}
                        </Link>
                        <Badge variant="outline">{row.descendants}× remixed</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
                  <Palette className="h-3 w-3" /> Style / moodboard / LoRA usage
                </div>
                {perf.data.topStylePacks.length === 0 ? (
                  <div className="text-xs text-zinc-500 italic">
                    No reference packs used in this range.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {perf.data.topStylePacks.map((row: any) => (
                      <div key={row.key} className="flex items-center justify-between text-sm py-1">
                        <span className="truncate max-w-[65%]" title={row.key}>
                          {row.label || row.key}
                        </span>
                        <Badge variant="outline">{row.count} uses</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </section>

      {/* ── Filtered feed ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-3">Event feed</h2>

        <div className="flex flex-wrap gap-2 mb-4">
          <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden">
            {KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKind(k.value)}
                className={`px-3 py-1.5 text-xs ${
                  kind === k.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden">
            {RIGHTS.map((r) => (
              <button
                key={r.value}
                onClick={() => setRightsClass(r.value)}
                className={`px-3 py-1.5 text-xs ${
                  rightsClass === r.value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <input
            placeholder="Filter by creator uid…"
            value={creatorUid}
            onChange={(e) => setCreatorUid(e.target.value.trim())}
            className="h-8 px-2 text-xs rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder:text-zinc-500 w-60"
          />
        </div>

        {feed.isLoading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!feed.isLoading && events.length === 0 && (
          <Card className="p-6 text-center text-zinc-400 text-sm">
            No events match those filters.
          </Card>
        )}

        <div className="space-y-2">
          {events.map((ev) => (
            <Link
              key={ev.id}
              to="/lineage/$assetId"
              params={{ assetId: ev.assetId }}
              className="block"
            >
              <Card className="p-3 hover:border-cyan-600 transition-colors">
                <div className="flex items-start gap-3">
                  {ev.outputUrl && ev.outputKind === 'image' ? (
                    <img
                      src={resolveIpfsUrl(ev.outputUrl)}
                      alt=""
                      className="h-16 w-16 rounded object-cover bg-zinc-900 flex-shrink-0"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : ev.outputUrl && ev.outputKind === 'video' ? (
                    <video
                      src={resolveIpfsUrl(ev.outputUrl)}
                      muted
                      className="h-16 w-16 rounded object-cover bg-zinc-900 flex-shrink-0"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded bg-zinc-900 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className="bg-cyan-600 text-white text-[10px]">{ev.kind}</Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {ev.step}
                      </Badge>
                      {ev.rightsClass && (
                        <Badge variant="outline" className="text-[10px]">
                          {ev.rightsClass}
                        </Badge>
                      )}
                      <span className="text-xs text-zinc-500">{formatDate(ev.createdAt)}</span>
                    </div>
                    {ev.prompt && <p className="text-sm text-zinc-300 line-clamp-1">{ev.prompt}</p>}
                    <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                      <span>{ev.tool}</span>
                      <span>{ev.creditCost} credits</span>
                      {ev.latencyMs != null && <span>{(ev.latencyMs / 1000).toFixed(1)}s</span>}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
