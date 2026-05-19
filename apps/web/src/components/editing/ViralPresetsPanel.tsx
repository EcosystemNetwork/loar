/**
 * Viral Presets Panel — one-click branded camera/style/shot combos.
 *
 * Loads the preset catalog from `sceneControls.listViralPresets` and renders
 * it as a card grid. Clicking a card fires `generation.generate` with the
 * preset's underlying primitives pre-filled (image_to_video if an image is
 * loaded in the editor, text_to_video otherwise).
 *
 * VFX presets are surfaced on the card for transparency but applied as a
 * post-processing step downstream — the actual ffmpeg composite worker is
 * not live yet; the viral preset still controls camera + style + shot
 * through the prompt-expansion path, which is the dominant visual effect.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

interface ViralPresetsPanelProps {
  imageUrl: string | null;
  onComplete: (videoUrl: string) => void;
}

type ViralPresetListItem = {
  id: string;
  label: string;
  tagline: string;
  category: string;
  cameraLabel: string;
  styleLabel: string;
  shotLabel: string;
  vfxLabels: string[];
};

const CATEGORY_TINT: Record<string, string> = {
  action: 'bg-red-500/10 text-red-300 border-red-500/30',
  cinematic: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  social: 'bg-pink-500/10 text-pink-300 border-pink-500/30',
  noir: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
  fantasy: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  horror: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  retro: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30',
  documentary: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
};

export function ViralPresetsPanel({ imageUrl, onComplete }: ViralPresetsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [prompt, setPrompt] = useState('');
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const { data: presets, isLoading } = useQuery<ViralPresetListItem[]>({
    queryKey: ['sceneControls', 'viralPresets'],
    queryFn: () =>
      trpcClient.sceneControls.listViralPresets.query() as Promise<ViralPresetListItem[]>,
    staleTime: 5 * 60 * 1000,
  });

  const apply = useMutation({
    mutationFn: async (presetId: string) => {
      const preset = await trpcClient.sceneControls.getViralPreset.query({ id: presetId });
      if (!preset) throw new Error('Preset not found');

      const mode = imageUrl ? 'image_to_video' : 'text_to_video';
      const finalPrompt =
        prompt.trim() ||
        (imageUrl
          ? `${preset.label}: ${preset.tagline.toLowerCase()}`
          : `${preset.label}. ${preset.tagline}`) +
          (preset.promptHint ? `, ${preset.promptHint}` : '');

      return await trpcClient.generation.generate.mutate({
        prompt: finalPrompt,
        mode,
        imageUrl: imageUrl || undefined,
        durationSec: 5,
        resolution: '720p',
        aspectRatio: '16:9',
        audio: false,
        routingMode: 'auto',
        cameraPreset: preset.camera,
        cameraIntensity: preset.cameraIntensity,
        stylePresetId: preset.style,
        shotPresetId: preset.shot,
      } as any);
    },
    onMutate: (id: string) => setGeneratingId(id),
    onSuccess: (r: any) => {
      const url = r?.videoUrl;
      if (!url) {
        toast.error('No video returned');
        return;
      }
      toast.success('Viral preset applied');
      onComplete(url);
    },
    onError: (err: any) => toast.error(err?.message || 'Generation failed'),
    onSettled: () => setGeneratingId(null),
  });

  const categories = ['all', ...Array.from(new Set((presets || []).map((p) => p.category)))];
  const visible =
    activeCategory === 'all'
      ? presets || []
      : (presets || []).filter((p) => p.category === activeCategory);

  return (
    <div className="space-y-3">
      <Card className="p-3 border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-pink-500/5">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-purple-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-medium">One-click viral looks</p>
            <p className="text-[10px] text-muted-foreground">
              {imageUrl
                ? 'Click a preset to animate your image with that vibe.'
                : 'Load an image in the Input tab for image-to-video, or hit Apply for pure text-to-video.'}
            </p>
          </div>
        </div>
      </Card>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">
          Prompt override (optional)
        </label>
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Leave blank to use the preset's built-in prompt"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {categories.map((c) => (
          <Button
            key={c}
            variant={activeCategory === c ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2.5 capitalize text-[11px]"
            onClick={() => setActiveCategory(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {visible.map((p) => {
            const isBusy = generatingId === p.id;
            return (
              <Card
                key={p.id}
                className="p-3 hover:border-purple-500/50 transition-colors cursor-pointer"
                onClick={() => !apply.isPending && apply.mutate(p.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{p.label}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 h-4 capitalize ${
                          CATEGORY_TINT[p.category] || ''
                        }`}
                      >
                        {p.category}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-1.5">{p.tagline}</p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                        {p.cameraLabel}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                        {p.styleLabel}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                        {p.shotLabel}
                      </Badge>
                      {p.vfxLabels.slice(0, 2).map((v) => (
                        <Badge
                          key={v}
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 h-4 opacity-60"
                          title="VFX queued for post-process when worker is live"
                        >
                          {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={apply.isPending}
                    className="shrink-0 h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!apply.isPending) apply.mutate(p.id);
                    }}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
