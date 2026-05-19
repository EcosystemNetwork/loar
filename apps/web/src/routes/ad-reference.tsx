/**
 * /ad-reference — Ad Reference recreator.
 *
 * Paste a viral-ad URL → Gemini decomposes it into a shot recipe (hook,
 * beats, style cues, pacing, aspect ratio) → you swap in your product and
 * the generation pipeline recreates the structure with your IP.
 *
 * Higgsfield's version of this is "Ad Reference by Marketing Studio."
 * Ours uses the same underlying generation stack as Series Mode + Marketing
 * Studio, with transparent intermediate JSON the user can actually inspect.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { awaitSessionValidation } from '@/lib/wallet-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Wand2, Loader2, Film, Sparkles, Repeat, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

export const Route = createFileRoute('/ad-reference')({
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/ad-reference' } });
    }
    await awaitSessionValidation();
  },
  component: AdReferencePage,
});

interface AdBeat {
  description: string;
  durationEstimateSec: number;
  cameraMove: string;
  framing: string;
}

interface AdRecipe {
  hookDescription: string;
  beats: AdBeat[];
  styleCues: string[];
  palette: string[];
  aspectRatio: string;
  pacing: string;
  mood: string;
  totalDurationSec: number;
}

function AdReferencePage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [product, setProduct] = useState('');
  const [recipe, setRecipe] = useState<AdRecipe | null>(null);
  const [recreated, setRecreated] = useState<{
    videoUrl: string | null;
    sourcePrompt: string;
  } | null>(null);

  const decompose = useMutation({
    mutationFn: (url: string) =>
      trpcClient.marketing.decomposeAd.mutate({ videoUrl: url }) as Promise<AdRecipe>,
    onSuccess: (r) => {
      setRecipe(r);
      setRecreated(null);
      toast.success(`Decomposed: ${r.beats.length} beats`);
    },
    onError: (err: any) =>
      toast.error(err?.message || 'Decomposition failed — check the URL and try again'),
  });

  const recreate = useMutation({
    mutationFn: () =>
      trpcClient.marketing.recreateAd.mutate({
        recipe: recipe!,
        product,
      }) as Promise<{ videoUrl: string | null; sourcePrompt: string }>,
    onSuccess: (r) => {
      setRecreated({ videoUrl: r.videoUrl, sourcePrompt: r.sourcePrompt });
      if (!r.videoUrl) {
        toast.error('Generation completed but no video URL returned');
      } else {
        toast.success('Ad recreated with your product');
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Recreation failed'),
  });

  const canDecompose = videoUrl.trim().startsWith('http') && !decompose.isPending;
  const canRecreate = !!recipe && product.trim().length >= 3 && !recreate.isPending;

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Repeat className="h-7 w-7 text-cyan-400" />
        <div>
          <h1 className="text-2xl font-semibold">Ad Reference Recreator</h1>
          <p className="text-sm text-muted-foreground">
            Paste a viral ad URL. We'll reverse-engineer the structure with vision-model analysis,
            then recreate it with your product.
          </p>
        </div>
      </div>

      {/* Step 1 — paste URL */}
      <Card className="p-5 space-y-3 border-cyan-500/30">
        <div className="flex items-center gap-2 text-cyan-300">
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-cyan-500/20 text-[11px] font-bold">
            1
          </span>
          <p className="text-sm font-medium">Paste a reference ad URL</p>
        </div>
        <div className="flex gap-2">
          <Input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://… (mp4 / IPFS / public CDN URL)"
            className="flex-1"
          />
          <Button disabled={!canDecompose} onClick={() => decompose.mutate(videoUrl)}>
            {decompose.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing… (30–90s)
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Decompose
              </>
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Direct video URL only. Twitter/TikTok/Instagram links must be resolved to the raw file
          first. Max 50MB.
        </p>
      </Card>

      {/* Step 2 — recipe display */}
      {recipe && (
        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-purple-400" />
              <p className="text-sm font-medium">Reverse-engineered recipe</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {recipe.aspectRatio}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                {recipe.pacing} pacing
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                ~{recipe.totalDurationSec}s
              </Badge>
            </div>
          </div>

          <div className="rounded-md border border-border/40 p-3 bg-muted/20">
            <p className="text-[11px] text-muted-foreground mb-1">Hook (first 1–2s)</p>
            <p className="text-sm italic">"{recipe.hookDescription}"</p>
          </div>

          <div>
            <p className="text-[11px] text-muted-foreground mb-2">Beats ({recipe.beats.length})</p>
            <div className="space-y-2">
              {recipe.beats.map((b, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border/40 p-2.5 flex items-start gap-3"
                >
                  <span className="text-xs font-bold text-cyan-400 shrink-0 w-5">{i + 1}.</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs">{b.description}</p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                        {b.framing}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                        {b.cameraMove}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5 opacity-70">
                        ~{b.durationEstimateSec}s
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {recipe.styleCues.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Style cues</p>
              <div className="flex flex-wrap gap-1">
                {recipe.styleCues.map((c, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[10px] border-purple-500/30 text-purple-300"
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {recipe.palette.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Palette</p>
              <div className="flex flex-wrap gap-1">
                {recipe.palette.map((c, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[10px] border-pink-500/30 text-pink-300"
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {recipe.mood && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
              <p className="text-[11px] text-amber-300 italic">{recipe.mood}</p>
            </div>
          )}
        </Card>
      )}

      {/* Step 3 — swap product + recreate */}
      {recipe && (
        <Card className="p-5 space-y-3 border-pink-500/30">
          <div className="flex items-center gap-2 text-pink-300">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-pink-500/20 text-[11px] font-bold">
              2
            </span>
            <p className="text-sm font-medium">Swap in your product</p>
          </div>

          <div>
            <Label htmlFor="product" className="text-xs">
              Your product or IP description
            </Label>
            <Input
              id="product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="A linen jumpsuit, ethically made in Lisbon, terracotta dye"
              maxLength={500}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              We'll substitute "the product" mentions in the recipe and regenerate every beat with
              your IP front and center.
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button disabled={!canRecreate} onClick={() => recreate.mutate()}>
              {recreate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recreating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Recreate ad
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Recreated result */}
      {recreated && (
        <Card className="p-5 space-y-3">
          <p className="text-sm font-medium">Your recreation</p>
          {recreated.videoUrl ? (
            <video
              src={recreated.videoUrl}
              controls
              loop
              playsInline
              className="rounded-md border border-border/40 mx-auto max-h-[500px]"
            />
          ) : (
            <p className="text-xs text-amber-400">No video returned by the generator.</p>
          )}
          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Synthesized prompt (debug)
            </summary>
            <pre className="mt-2 p-2 bg-muted/30 rounded whitespace-pre-wrap break-words">
              {recreated.sourcePrompt}
            </pre>
          </details>
          <Button
            variant="outline"
            onClick={() => {
              setRecreated(null);
              setProduct('');
            }}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Try a different product
          </Button>
        </Card>
      )}
    </div>
  );
}
