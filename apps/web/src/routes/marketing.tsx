/**
 * /marketing — Marketing Studio.
 *
 * 20 named ad-format templates (TikTok / Reels / Shorts / Feed / Pre-roll /
 * Story). Each format wraps the user's product description in a structured
 * scaffold and applies the right camera + style + shot + VFX combo for the
 * channel — vertical 9:16 for TikTok, 16:9 for pre-roll, etc.
 *
 * Inline pre-gen virality prediction shows a score before the user spends
 * credits. Post-generation, surfaces the resulting clip with channel-tagged
 * metadata for distribution.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { awaitSessionValidation } from '@/lib/wallet-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Loader2, Wand2, TrendingUp, Sparkles, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

export const Route = createFileRoute('/marketing')({
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/marketing' } });
    }
    await awaitSessionValidation();
  },
  component: MarketingPage,
});

interface AdFormatListItem {
  id: string;
  label: string;
  tagline: string;
  channel: string;
  goal: string;
  aspectRatio: string;
  durationSec: number;
  cameraLabel: string;
  styleLabel: string;
  shotLabel: string;
}

interface ResolvedFormat {
  prompt: string;
  aspectRatio: string;
  durationSec: number;
}

interface ViralityPrediction {
  predictedIndex: number;
  signals: {
    hookStrength: number;
    specificity: number;
    cinematicCues: number;
    characterAnchor: number;
    conflictStakes: number;
    lengthFit: number;
  };
  verdict: string;
  suggestions: string[];
}

const CHANNEL_TINT: Record<string, string> = {
  tiktok: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  reels: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  shorts: 'bg-red-500/15 text-red-300 border-red-500/30',
  feed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  preroll: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  story: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const GOAL_TINT: Record<string, string> = {
  awareness: 'bg-zinc-500/15 text-zinc-300',
  conversion: 'bg-green-500/15 text-green-300',
  retargeting: 'bg-orange-500/15 text-orange-300',
  launch: 'bg-violet-500/15 text-violet-300',
  social_proof: 'bg-cyan-500/15 text-cyan-300',
  demo: 'bg-yellow-500/15 text-yellow-300',
};

function tintForIndex(idx: number): string {
  if (idx >= 80) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (idx >= 60) return 'bg-green-500/15 text-green-300 border-green-500/40';
  if (idx >= 40) return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (idx >= 20) return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  return 'bg-red-500/15 text-red-300 border-red-500/40';
}

function MarketingPage() {
  const [product, setProduct] = useState('');
  const [promptExtra, setPromptExtra] = useState('');
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [goalFilter, setGoalFilter] = useState<string>('all');
  const [result, setResult] = useState<{
    videoUrl: string | null;
    formatLabel: string;
    aspectRatio: string;
    channel: string;
  } | null>(null);

  const { data: formats } = useQuery<AdFormatListItem[]>({
    queryKey: ['marketing', 'formats'],
    queryFn: () => trpcClient.marketing.listFormats.query() as Promise<AdFormatListItem[]>,
    staleTime: 5 * 60 * 1000,
  });

  // Resolve the chosen format → preview the actual prompt the user is about to send
  const { data: resolved } = useQuery<ResolvedFormat | null>({
    queryKey: ['marketing', 'resolve', activeFormatId, product, promptExtra],
    queryFn: () =>
      trpcClient.marketing.resolveFormat.query({
        formatId: activeFormatId!,
        product,
        promptExtra: promptExtra || undefined,
      }) as Promise<ResolvedFormat>,
    enabled: !!activeFormatId && product.trim().length >= 3,
    staleTime: 0,
  });

  // Pre-gen virality prediction on the resolved prompt
  const { data: prediction } = useQuery<ViralityPrediction | null>({
    queryKey: ['virality', 'predictPrompt', resolved?.prompt],
    queryFn: () =>
      trpcClient.virality.predictPrompt.query({
        prompt: resolved!.prompt,
      }) as Promise<ViralityPrediction>,
    enabled: !!resolved?.prompt,
    staleTime: 10_000,
  });

  const generate = useMutation({
    mutationFn: () =>
      trpcClient.marketing.generate.mutate({
        formatId: activeFormatId!,
        product,
        promptExtra: promptExtra || undefined,
      }) as Promise<{
        videoUrl: string | null;
        formatLabel: string;
        aspectRatio: string;
        channel: string;
      }>,
    onSuccess: (r) => {
      if (!r.videoUrl) {
        toast.error('Generation completed but no video URL returned');
        return;
      }
      toast.success(`${r.formatLabel} ad generated`);
      setResult(r);
    },
    onError: (err: any) => toast.error(err?.message || 'Generation failed'),
  });

  const channels = useMemo(
    () => ['all', ...Array.from(new Set((formats || []).map((f) => f.channel)))],
    [formats]
  );
  const goals = useMemo(
    () => ['all', ...Array.from(new Set((formats || []).map((f) => f.goal)))],
    [formats]
  );

  const visible = (formats || []).filter(
    (f) =>
      (channelFilter === 'all' || f.channel === channelFilter) &&
      (goalFilter === 'all' || f.goal === goalFilter)
  );

  const canGenerate = !!activeFormatId && product.trim().length >= 3 && !generate.isPending;

  return (
    <div className="container max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Megaphone className="h-7 w-7 text-pink-400" />
        <div>
          <h1 className="text-2xl font-semibold">Marketing Studio</h1>
          <p className="text-sm text-muted-foreground">
            20 ad-format templates wired to the same generation pipeline that powers Series Mode and
            the Editor. Channel-correct aspect ratios, durations, and motion baked in.
          </p>
        </div>
      </div>

      {/* Top: product input + filters */}
      <Card className="p-5 space-y-4">
        <div>
          <Label htmlFor="product" className="text-xs">
            What are you advertising?
          </Label>
          <Input
            id="product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="A waterproof leather messenger bag, hand-stitched in Portugal"
            maxLength={500}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            One line describing your product, IP, or service. Gets spliced into the format's
            scaffold.
          </p>
        </div>

        <div>
          <Label htmlFor="extra" className="text-xs">
            Additional prompt detail (optional)
          </Label>
          <Input
            id="extra"
            value={promptExtra}
            onChange={(e) => setPromptExtra(e.target.value)}
            placeholder="Color palette, mood, specific setting…"
            maxLength={500}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Channel:</span>
            {channels.map((c) => (
              <Button
                key={c}
                variant={channelFilter === c ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2.5 capitalize text-[11px]"
                onClick={() => setChannelFilter(c)}
              >
                {c}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Goal:</span>
            {goals.map((g) => (
              <Button
                key={g}
                variant={goalFilter === g ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2.5 capitalize text-[11px]"
                onClick={() => setGoalFilter(g)}
              >
                {g.replace('_', ' ')}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Format grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((f) => {
          const active = activeFormatId === f.id;
          return (
            <Card
              key={f.id}
              className={`p-4 cursor-pointer transition-colors ${
                active ? 'border-pink-500/70 bg-pink-500/5' : 'hover:border-pink-500/40'
              }`}
              onClick={() => setActiveFormatId(f.id)}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold">{f.label}</p>
                <Badge
                  variant="outline"
                  className={`text-[9px] h-5 px-1.5 ${CHANNEL_TINT[f.channel] || ''}`}
                >
                  {f.channel}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">{f.tagline}</p>
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1.5 ${GOAL_TINT[f.goal] || ''}`}
                >
                  {f.goal.replace('_', ' ')}
                </Badge>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                  {f.aspectRatio}
                </Badge>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                  {f.durationSec}s
                </Badge>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 opacity-70">
                  {f.cameraLabel}
                </Badge>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Sticky bottom: resolved prompt preview + virality + generate CTA */}
      {activeFormatId && (
        <Card className="p-5 space-y-4 border-pink-500/30 sticky bottom-4 bg-card/95 backdrop-blur">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Resolved prompt</p>
              <p className="text-sm font-mono leading-snug">
                {resolved?.prompt || (
                  <span className="italic text-muted-foreground">
                    Enter a product description above…
                  </span>
                )}
              </p>
            </div>
            {prediction && (
              <div className="space-y-1 text-right shrink-0">
                <p className="text-[10px] text-muted-foreground">Predicted virality</p>
                <div className="flex items-center gap-2 justify-end">
                  <Badge
                    variant="outline"
                    className={`text-base font-bold px-3 py-1 h-auto ${tintForIndex(prediction.predictedIndex)}`}
                  >
                    {prediction.predictedIndex}
                  </Badge>
                  <TrendingUp className="h-4 w-4 text-pink-400" />
                </div>
                <p className="text-[10px] text-muted-foreground italic max-w-[200px]">
                  {prediction.verdict}
                </p>
              </div>
            )}
          </div>

          {prediction && prediction.suggestions.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
              <p className="text-[10px] font-medium text-amber-300 flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Improve the score before spending credits:
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 ml-4 list-disc">
                {prediction.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {result && result.videoUrl && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {result.formatLabel} · {result.channel} · {result.aspectRatio}
              </p>
              <video
                src={result.videoUrl}
                controls
                loop
                playsInline
                className="rounded-md border border-border/40 max-h-[400px] mx-auto"
              />
            </div>
          )}

          <div className="flex gap-2 justify-end">
            {result && (
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                }}
              >
                <RefreshCcw className="h-4 w-4 mr-2" />
                Try again
              </Button>
            )}
            <Button disabled={!canGenerate} onClick={() => generate.mutate()}>
              {generate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate ad
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
