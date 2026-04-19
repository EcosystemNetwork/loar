/**
 * Sandbox Creator
 *
 * A friction-free creative workspace. Queue up as many image/video generations
 * as you want — they run in parallel, each is auto-saved to drafts on success,
 * and you can promote any draft to a universe or gallery later.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import React, { useCallback, useState } from 'react';
import {
  Wand2,
  Video,
  Trash2,
  Plus,
  Sparkles,
  ArrowRight,
  ImageIcon,
  Loader2,
  Rocket,
  Pencil,
  Check,
  X,
  Globe,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';

export const Route = createFileRoute('/sandbox')({
  component: SandboxPage,
});

type VideoModel = 'fal-kling' | 'fal-wan25' | 'fal-veo3' | 'seedance' | 'seedance-fast';
type ImageSize = 'landscape_16_9' | 'portrait_16_9' | 'square_hd';
type AspectRatio = '16:9' | '9:16' | '1:1';

type Generation = {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  status: 'generating' | 'done' | 'failed';
  imageUrl?: string;
  videoUrl?: string;
  sourceImageUrl?: string;
  imageModel?: string;
  videoModel?: VideoModel;
  imageSize: ImageSize;
  aspectRatio: AspectRatio;
  error?: string;
  draftId?: string;
  createdAt: number;
};

const VIDEO_MODELS: { value: VideoModel; label: string; badge?: string }[] = [
  { value: 'seedance', label: 'Seedance 2.0', badge: 'Free' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', badge: 'Free' },
  { value: 'fal-kling', label: 'Kling 2.5' },
  { value: 'fal-wan25', label: 'Wan 2.5' },
  { value: 'fal-veo3', label: 'Veo 3' },
];
const VALID_VIDEO_MODELS = new Set<VideoModel>(VIDEO_MODELS.map((m) => m.value));
const SEEDANCE_MODELS = new Set<VideoModel>(['seedance', 'seedance-fast']);

const IMAGE_SIZES = [
  { value: 'landscape_16_9', label: '16:9 Landscape' },
  { value: 'portrait_16_9', label: '9:16 Portrait' },
  { value: 'square_hd', label: '1:1 Square' },
] as const;

const MODEL_REGISTRY_MAP: Record<VideoModel, { t2v: string; i2v: string }> = {
  seedance: { t2v: 'seedance2-t2v', i2v: 'seedance2-i2v' },
  'seedance-fast': { t2v: 'seedance2-fast-t2v', i2v: 'seedance2-fast-i2v' },
  'fal-kling': { t2v: 'kling-t2v', i2v: 'kling-i2v' },
  'fal-wan25': { t2v: 'wan25-t2v', i2v: 'wan25-i2v' },
  'fal-veo3': { t2v: 'veo31-t2v', i2v: 'veo31-i2v' },
};

function aspectFromSize(size: ImageSize): AspectRatio {
  if (size === 'portrait_16_9') return '9:16';
  if (size === 'square_hd') return '1:1';
  return '16:9';
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function SandboxPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Form state
  const [prompt, setPrompt] = useState('');
  const [imageSize, setImageSize] = useState<ImageSize>('landscape_16_9');
  const [videoModel, setVideoModel] = useState<VideoModel>('seedance');
  const [imageModel, setImageModel] = useState<string>('');
  const [referenceImage, setReferenceImage] = useState<{ url: string; prompt: string } | null>(
    null
  );

  // Parallel generation queue
  const [generations, setGenerations] = useState<Generation[]>([]);

  // Drafts panel
  const { data: drafts } = useQuery({
    queryKey: ['sandbox-drafts'],
    queryFn: () => trpcClient.sandbox.myDrafts.query(),
    enabled: isAuthenticated,
  });

  const updateGen = useCallback((id: string, patch: Partial<Generation>) => {
    setGenerations((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, []);

  const removeGen = useCallback((id: string) => {
    setGenerations((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const clearDone = useCallback(() => {
    setGenerations((prev) => prev.filter((g) => g.status === 'generating'));
  }, []);

  const autoSaveDraft = useCallback(
    async (gen: Generation) => {
      try {
        const result = await trpcClient.sandbox.saveDraft.mutate({
          title: gen.prompt.slice(0, 80) || 'Untitled',
          prompt: gen.prompt,
          imageUrl: gen.imageUrl,
          videoUrl: gen.videoUrl,
          model: gen.kind === 'video' ? gen.videoModel : gen.imageModel || undefined,
        });
        updateGen(gen.id, { draftId: result.id });
        queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      } catch (e: any) {
        // Non-fatal: generation succeeded, draft save didn't
        console.warn('sandbox auto-save failed:', e);
        toast.error('Saved generation but failed to create draft');
      }
    },
    [queryClient, updateGen]
  );

  const runImageGen = useCallback(
    async (p: string, opts: { imageSize: ImageSize; imageModel: string }) => {
      const id = makeId();
      const gen: Generation = {
        id,
        kind: 'image',
        prompt: p,
        status: 'generating',
        imageSize: opts.imageSize,
        aspectRatio: aspectFromSize(opts.imageSize),
        imageModel: opts.imageModel || undefined,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [gen, ...prev]);
      try {
        const result = await trpcClient.image.generate.mutate({
          prompt: p,
          task: 'text_to_image',
          imageSize: opts.imageSize,
          numImages: 1,
          routingMode: opts.imageModel ? 'manual' : 'auto',
          ...(opts.imageModel ? { selectedModelId: opts.imageModel } : {}),
        });
        const url = result.imageUrls?.[0];
        if (!url) throw new Error('No image returned');
        const updated: Generation = { ...gen, status: 'done', imageUrl: url };
        setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
        autoSaveDraft(updated);
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || 'Image generation failed' });
        toast.error('Image generation failed: ' + (err?.message || ''));
      }
    },
    [autoSaveDraft, updateGen]
  );

  const runVideoGen = useCallback(
    async (
      p: string,
      opts: { videoModel: VideoModel; imageSize: ImageSize; sourceImageUrl?: string }
    ) => {
      const id = makeId();
      const hasImage = !!opts.sourceImageUrl;
      const mode = hasImage ? 'image_to_video' : 'text_to_video';
      const modelIds = MODEL_REGISTRY_MAP[opts.videoModel];
      const selectedModelId = hasImage ? modelIds.i2v : modelIds.t2v;
      const isSeedance = SEEDANCE_MODELS.has(opts.videoModel);
      const aspectRatio = aspectFromSize(opts.imageSize);

      const gen: Generation = {
        id,
        kind: 'video',
        prompt: p,
        status: 'generating',
        videoModel: opts.videoModel,
        imageSize: opts.imageSize,
        aspectRatio,
        sourceImageUrl: opts.sourceImageUrl,
        imageUrl: opts.sourceImageUrl,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [gen, ...prev]);
      try {
        const r: any = await trpcClient.generation.generate.mutate({
          prompt: p,
          mode,
          routingMode: 'manual',
          selectedModelId,
          ...(hasImage ? { imageUrl: opts.sourceImageUrl } : {}),
          durationSec: 5,
          resolution: '720p',
          aspectRatio,
          audio: isSeedance,
        });
        const url = r?.videoUrl;
        if (!url) throw new Error('No video returned');
        const updated: Generation = { ...gen, status: 'done', videoUrl: url };
        setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
        autoSaveDraft(updated);
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || 'Video generation failed' });
        toast.error('Video generation failed: ' + (err?.message || ''));
      }
    },
    [autoSaveDraft, updateGen]
  );

  const retryGen = useCallback(
    (g: Generation) => {
      removeGen(g.id);
      if (g.kind === 'image') {
        runImageGen(g.prompt, { imageSize: g.imageSize, imageModel: g.imageModel || '' });
      } else {
        runVideoGen(g.prompt, {
          videoModel: g.videoModel ?? 'seedance',
          imageSize: g.imageSize,
          sourceImageUrl: g.sourceImageUrl,
        });
      }
    },
    [removeGen, runImageGen, runVideoGen]
  );

  const handleAnimate = useCallback((g: Generation) => {
    if (!g.imageUrl) return;
    setReferenceImage({ url: g.imageUrl, prompt: g.prompt });
    setPrompt(g.prompt);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Reference image loaded — pick a video model and hit Animate', { duration: 3000 });
  }, []);

  const delDraftMutation = useMutation({
    mutationFn: (id: string) => trpcClient.sandbox.deleteDraft.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      toast.success('Draft deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete draft'),
  });

  const canGenerate = prompt.trim().length > 0;
  // Non-Seedance video models run image-to-video only in the registry, so they need a reference.
  const videoNeedsImage = !SEEDANCE_MODELS.has(videoModel) && !referenceImage;
  const activeCount = generations.filter((g) => g.status === 'generating').length;
  const hasDoneGens = generations.some((g) => g.status !== 'generating');

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <Sparkles className="h-6 w-6 text-primary" />
              <h1 className="text-3xl font-bold">Sandbox</h1>
              <Badge variant="secondary">Beta</Badge>
              {activeCount > 0 && (
                <Badge className="bg-primary/20 text-primary border-primary/30">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  {activeCount} running
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Queue up as many generations as you want — they run in parallel and auto-save to your
              drafts.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => navigate({ to: '/create' })}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Universe
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>

        {!isAuthenticated && !isAuthenticating ? (
          <Card>
            <CardContent className="py-10 flex flex-col items-center gap-4">
              <Wand2 className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground text-center max-w-sm">
                Connect your wallet to start generating. Your creations are saved to your account.
              </p>
              <WalletConnectButton />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: create + queue */}
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Create</h2>

              {/* Prompt */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Prompt</label>
                <Textarea
                  placeholder="Describe what you want to create… e.g. 'A lone samurai on a neon-lit rooftop in cyberpunk Tokyo'"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Settings row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Aspect</label>
                  <Select value={imageSize} onValueChange={(v) => setImageSize(v as ImageSize)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_SIZES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ModelSelector
                  type="image"
                  value={imageModel}
                  onChange={setImageModel}
                  label="Image model"
                  task="text_to_image"
                  compact
                />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Video model</label>
                  <Select value={videoModel} onValueChange={(v) => setVideoModel(v as VideoModel)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          <span className="flex items-center gap-1.5">
                            {m.label}
                            {m.badge && (
                              <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                                {m.badge}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Reference image slot */}
              {referenceImage && (
                <div className="flex items-center gap-3 p-2 rounded-lg border border-primary/30 bg-primary/5">
                  <img src={referenceImage.url} alt="" className="h-12 w-12 rounded object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Reference image</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      Will be animated by the selected video model
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setReferenceImage(null)}
                    title="Clear reference"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={!canGenerate}
                  onClick={() => {
                    runImageGen(prompt, { imageSize, imageModel });
                    setPrompt('');
                  }}
                >
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Generate Image
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!canGenerate || videoNeedsImage}
                  title={
                    videoNeedsImage ? 'Pick Seedance, or set a reference image first' : undefined
                  }
                  onClick={() => {
                    runVideoGen(prompt, {
                      videoModel,
                      imageSize,
                      sourceImageUrl: referenceImage?.url,
                    });
                    setReferenceImage(null);
                    setPrompt('');
                  }}
                >
                  <Video className="h-4 w-4 mr-2" />
                  {referenceImage ? 'Animate' : 'Generate Video'}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground -mt-1">
                Queue is unbounded — keep typing and hitting Generate. Each run auto-saves as a
                draft.
              </p>

              {/* Queue header */}
              {generations.length > 0 && (
                <div className="flex items-center justify-between pt-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {activeCount > 0
                      ? `${activeCount} running · ${generations.length - activeCount} done`
                      : `${generations.length} recent`}
                  </h3>
                  {hasDoneGens && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearDone}>
                      Clear done
                    </Button>
                  )}
                </div>
              )}

              {/* Queue grid */}
              {generations.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {generations.map((g) => (
                    <GenerationCard
                      key={g.id}
                      gen={g}
                      onDismiss={() => removeGen(g.id)}
                      onRetry={() => retryGen(g)}
                      onAnimate={() => handleAnimate(g)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: drafts */}
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Your Drafts</h2>

              {!drafts || drafts.length === 0 ? (
                <Card>
                  <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                    <Wand2 className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-muted-foreground text-sm">
                      Nothing saved yet. Generate something and it'll show up here.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {drafts.map((draft: any) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      onDelete={() => delDraftMutation.mutate(draft.id)}
                      onReuse={() => {
                        setPrompt(draft.prompt);
                        if (draft.model && VALID_VIDEO_MODELS.has(draft.model as VideoModel)) {
                          setVideoModel(draft.model as VideoModel);
                        }
                        if (draft.imageUrl) {
                          setReferenceImage({ url: draft.imageUrl, prompt: draft.prompt });
                        }
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Generation Card ─────────────────────────────────────────────────

interface GenerationCardProps {
  gen: Generation;
  onDismiss: () => void;
  onRetry: () => void;
  onAnimate: () => void;
}

function GenerationCard({ gen, onDismiss, onRetry, onAnimate }: GenerationCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted relative">
        {gen.status === 'generating' && (
          <>
            {gen.sourceImageUrl && (
              <img
                src={gen.sourceImageUrl}
                alt=""
                className="w-full h-full object-cover opacity-30"
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Generating {gen.kind}…</span>
            </div>
          </>
        )}
        {gen.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <span className="text-xs text-destructive">Failed</span>
            {gen.error && (
              <span className="text-[10px] text-muted-foreground line-clamp-2">{gen.error}</span>
            )}
          </div>
        )}
        {gen.status === 'done' && gen.videoUrl && (
          <video
            src={gen.videoUrl}
            className="w-full h-full object-cover"
            controls
            muted
            loop
            playsInline
          />
        )}
        {gen.status === 'done' && !gen.videoUrl && gen.imageUrl && (
          <img src={gen.imageUrl} alt="" className="w-full h-full object-cover" />
        )}

        <Button
          size="icon"
          variant="secondary"
          className="absolute top-1.5 right-1.5 h-6 w-6 opacity-80 hover:opacity-100"
          onClick={onDismiss}
          title="Dismiss from queue"
        >
          <X className="h-3 w-3" />
        </Button>

        <Badge variant="secondary" className="absolute top-1.5 left-1.5 text-[10px]">
          {gen.kind === 'video' ? (
            <Video className="h-2.5 w-2.5 mr-1" />
          ) : (
            <ImageIcon className="h-2.5 w-2.5 mr-1" />
          )}
          {gen.kind}
        </Badge>
      </div>

      <CardContent className="p-2 space-y-1.5">
        <p className="text-xs text-muted-foreground line-clamp-2">{gen.prompt}</p>
        <div className="flex items-center gap-1">
          {gen.status === 'done' && gen.draftId && (
            <Badge variant="outline" className="text-[10px]">
              Saved
            </Badge>
          )}
          {gen.status === 'done' && gen.kind === 'image' && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onAnimate}>
              <Video className="h-3 w-3 mr-1" />
              Animate
            </Button>
          )}
          {gen.status === 'failed' && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onRetry}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Draft Card ─────────────────────────────────────────────────

interface DraftData {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string | null;
  videoUrl: string | null;
  model: string | null;
  tags: string[];
  status: string;
  createdAt: string | null;
}

interface DraftCardProps {
  draft: DraftData;
  onDelete: () => void;
  onReuse: () => void;
}

function DraftCard({ draft, onDelete, onReuse }: DraftCardProps) {
  const queryClient = useQueryClient();
  const thumb = draft.videoUrl || draft.imageUrl;
  const isPromoted = draft.status === 'promoted';

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title);

  const [showPromote, setShowPromote] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('__gallery__');
  const [classification, setClassification] = useState<'fan' | 'original' | 'licensed'>('original');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('public');

  const { data: universesResult } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
    enabled: showPromote,
  });
  const universes = (universesResult as any)?.data ?? universesResult ?? [];

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; title?: string; tags?: string[] }) =>
      trpcClient.sandbox.updateDraft.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      setEditing(false);
      toast.success('Draft updated');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  });

  const promoteMutation = useMutation({
    mutationFn: () =>
      trpcClient.sandbox.promoteToUniverse.mutate({
        draftId: draft.id,
        ...(selectedTarget !== '__gallery__' ? { universeId: selectedTarget } : {}),
        classification,
        visibility,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      setShowPromote(false);
      toast.success(
        selectedTarget === '__gallery__' ? 'Published to your gallery!' : 'Promoted to universe!'
      );
    },
    onError: (err: any) => toast.error(err.message || 'Failed to promote'),
  });

  return (
    <Card className="overflow-hidden group relative">
      {/* Thumbnail */}
      <div className="aspect-video bg-muted relative">
        {thumb ? (
          draft.videoUrl ? (
            <video
              src={draft.videoUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLVideoElement).play().catch(() => {});
              }}
              onMouseLeave={(e) => {
                const v = e.currentTarget as HTMLVideoElement;
                v.pause();
                v.currentTime = 0;
              }}
            />
          ) : (
            <img src={draft.imageUrl!} alt={draft.title} className="w-full h-full object-cover" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Wand2 className="h-6 w-6 text-muted-foreground/30" />
          </div>
        )}

        {isPromoted && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-green-500/90 text-white border-0 text-[10px]">Promoted</Badge>
          </div>
        )}

        {!showPromote && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {!isPromoted && (
              <Button size="sm" variant="default" onClick={() => setShowPromote(true)}>
                <Rocket className="h-3.5 w-3.5 mr-1" />
                Promote
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onReuse}>
              Reuse
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <CardContent className="p-3">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="h-7 text-sm px-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateMutation.mutate({ id: draft.id, title: editTitle });
                }
                if (e.key === 'Escape') {
                  setEditing(false);
                  setEditTitle(draft.title);
                }
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => updateMutation.mutate({ id: draft.id, title: editTitle })}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setEditing(false);
                setEditTitle(draft.title);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <p className="text-sm font-medium truncate">{draft.title}</p>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5">{draft.prompt}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {draft.videoUrl && (
            <Badge variant="secondary" className="text-xs">
              <Video className="h-2.5 w-2.5 mr-1" />
              Video
            </Badge>
          )}
          {draft.model && (
            <Badge variant="outline" className="text-[10px]">
              {draft.model.replace('fal-', '')}
            </Badge>
          )}
        </div>

        {showPromote && !isPromoted && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              Promote to Universe
            </p>

            <Select value={selectedTarget} onValueChange={setSelectedTarget}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select destination" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__gallery__" className="text-xs font-medium">
                  My Gallery (no universe)
                </SelectItem>
                {Array.isArray(universes) &&
                  universes.map((u: any) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name || u.id.slice(0, 12)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <div className="flex gap-1">
              {(['original', 'fan', 'licensed'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setClassification(c)}
                  className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                    classification === c
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>

            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public" className="text-xs">
                  Public
                </SelectItem>
                <SelectItem value="unlisted" className="text-xs">
                  Unlisted
                </SelectItem>
                <SelectItem value="private" className="text-xs">
                  Private
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={promoteMutation.isPending}
                onClick={() => promoteMutation.mutate()}
              >
                {promoteMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Rocket className="h-3 w-3 mr-1" />
                )}
                {selectedTarget === '__gallery__' ? 'Publish' : 'Promote'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setShowPromote(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
