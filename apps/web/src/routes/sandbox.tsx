/**
 * Sandbox Creator
 *
 * A friction-free creative workspace. Generate images and videos from prompts
 * without needing to set up a universe first. Save drafts, edit them, and
 * promote to a universe when ready.
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
import React, { useState } from 'react';
import {
  Wand2,
  Video,
  Save,
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
} from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';

export const Route = createFileRoute('/sandbox')({
  component: SandboxPage,
});

type VideoModel = 'fal-kling' | 'fal-wan25' | 'fal-veo3' | 'seedance' | 'seedance-fast';

type BgGeneration = {
  id: string;
  prompt: string;
  model: string;
  status: 'generating' | 'done' | 'failed';
  videoUrl?: string;
  imageUrl?: string;
};

const VIDEO_MODELS: { value: VideoModel; label: string; badge?: string }[] = [
  { value: 'seedance', label: 'Seedance 2.0', badge: 'Free' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', badge: 'Free' },
  { value: 'fal-kling', label: 'Kling 2.5' },
  { value: 'fal-wan25', label: 'Wan 2.5' },
  { value: 'fal-veo3', label: 'Veo 3' },
];

const IMAGE_SIZES = [
  { value: 'landscape_16_9', label: '16:9 Landscape' },
  { value: 'portrait_16_9', label: '9:16 Portrait' },
  { value: 'square_hd', label: '1:1 Square' },
] as const;

function SandboxPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Creation state
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [imageSize, setImageSize] = useState<'landscape_16_9' | 'portrait_16_9' | 'square_hd'>(
    'landscape_16_9'
  );
  const [videoModel, setVideoModel] = useState<VideoModel>('seedance');
  const [imageModel, setImageModel] = useState<string>(''); // '' = auto routing
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);

  // Background generations — tracks generations the user has "moved on" from
  const [bgGenerations, setBgGenerations] = useState<BgGeneration[]>([]);
  const bgGenerationsRef = React.useRef<BgGeneration[]>([]);

  // Track whether the user has "moved on" from the current generation
  const [movedOn, setMovedOn] = useState(false);
  const movedOnRef = React.useRef(false);

  // Image generation — uses routed endpoint with model selection
  const generateImageMutation = useMutation({
    mutationFn: async () => {
      const result = await trpcClient.image.generate.mutate({
        prompt,
        task: 'text_to_image',
        imageSize,
        numImages: 1,
        routingMode: imageModel ? 'manual' : 'auto',
        ...(imageModel ? { selectedModelId: imageModel } : {}),
      });
      // Normalize to legacy shape for downstream compat
      return {
        imageUrl: result.imageUrls?.[0] ?? null,
        status: result.status,
      };
    },
    onSuccess: (data) => {
      const url = data.imageUrl ?? null;
      if (movedOnRef.current) {
        setBgGenerations((prev) => {
          const next = prev.map((g) =>
            g.status === 'generating'
              ? { ...g, status: 'done' as const, imageUrl: url ?? undefined }
              : g
          );
          bgGenerationsRef.current = next;
          return next;
        });
        toast.success('Background image ready! Saved to drafts.', { duration: 5000 });
        const bg = bgGenerationsRef.current.find((g) => g.status === 'generating');
        if (bg && url) {
          trpcClient.sandbox.saveDraft
            .mutate({
              title: bg.prompt.slice(0, 80),
              prompt: bg.prompt,
              imageUrl: url,
              model: bg.model,
            })
            .then(() => queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] }))
            .catch(() => {});
        }
      } else {
        setGeneratedImageUrl(url);
        setGeneratedVideoUrl(null);
        if (!url) toast.error('No image returned');
      }
    },
    onError: (err: any) => {
      if (movedOnRef.current) {
        setBgGenerations((prev) =>
          prev.map((g) => (g.status === 'generating' ? { ...g, status: 'failed' as const } : g))
        );
        toast.error('Background image failed: ' + (err.message || 'Unknown error'));
      } else {
        toast.error(err.message || 'Image generation failed');
      }
    },
  });

  // Reset form for a new generation while current one runs in the background
  const startNew = () => {
    const currentPrompt = prompt;
    const currentModel = videoModel;
    const currentImageUrl = generatedImageUrl;
    const newBg: BgGeneration = {
      id: Date.now().toString(),
      prompt: currentPrompt,
      model: currentModel,
      status: 'generating',
      imageUrl: currentImageUrl ?? undefined,
    };
    setBgGenerations((prev) => {
      const next = [...prev, newBg];
      bgGenerationsRef.current = next;
      return next;
    });
    movedOnRef.current = true;
    setMovedOn(true);
    setPrompt('');
    setTitle('');
    setGeneratedImageUrl(null);
    setGeneratedVideoUrl(null);
    toast('Started fresh! Your generation is running in the background.', { duration: 3000 });
  };

  // Map sandbox model IDs to registry model IDs for the unified generate endpoint
  const MODEL_REGISTRY_MAP: Record<VideoModel, { t2v: string; i2v: string }> = {
    seedance: { t2v: 'seedance2-t2v', i2v: 'seedance2-i2v' },
    'seedance-fast': { t2v: 'seedance2-fast-t2v', i2v: 'seedance2-fast-i2v' },
    'fal-kling': { t2v: 'kling-t2v', i2v: 'kling-i2v' },
    'fal-wan25': { t2v: 'wan25-t2v', i2v: 'wan25-i2v' },
    'fal-veo3': { t2v: 'veo31-t2v', i2v: 'veo31-i2v' },
  };

  // Video generation — uses unified generate endpoint (correct pricing per model)
  const generateVideoMutation = useMutation({
    mutationFn: async () => {
      const hasImage = !!generatedImageUrl;
      const mode = hasImage ? 'image_to_video' : 'text_to_video';
      const modelIds = MODEL_REGISTRY_MAP[videoModel];
      const selectedModelId = hasImage ? modelIds.i2v : modelIds.t2v;
      const isSeedance = videoModel === 'seedance' || videoModel === 'seedance-fast';

      const r = await trpcClient.generation.generate.mutate({
        prompt,
        mode,
        routingMode: 'manual',
        selectedModelId,
        ...(hasImage ? { imageUrl: generatedImageUrl } : {}),
        durationSec: 5,
        resolution: '720p',
        aspectRatio: imageSize === 'portrait_16_9' ? '9:16' : '16:9',
        audio: isSeedance, // Seedance supports native audio
      });
      return 'videoUrl' in r ? r.videoUrl : undefined;
    },
    onSuccess: (url) => {
      if (movedOnRef.current) {
        // User started a new prompt — auto-save this as a draft in the background
        setBgGenerations((prev) => {
          const next = prev.map((g) =>
            g.status === 'generating'
              ? { ...g, status: 'done' as const, videoUrl: url ?? undefined }
              : g
          );
          bgGenerationsRef.current = next;
          return next;
        });
        toast.success('Background generation finished! Saved to drafts.', { duration: 5000 });
        // Auto-save as draft
        const bg = bgGenerationsRef.current.find((g) => g.status === 'generating');
        if (bg) {
          trpcClient.sandbox.saveDraft
            .mutate({
              title: bg.prompt.slice(0, 80),
              prompt: bg.prompt,
              imageUrl: bg.imageUrl ?? undefined,
              videoUrl: url ?? undefined,
              model: bg.model,
            })
            .then(() => queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] }))
            .catch(() => {});
        }
      } else {
        setGeneratedVideoUrl(url ?? null);
      }
    },
    onError: (err: any) => {
      if (movedOnRef.current) {
        setBgGenerations((prev) =>
          prev.map((g) => (g.status === 'generating' ? { ...g, status: 'failed' as const } : g))
        );
        toast.error('Background generation failed: ' + (err.message || 'Unknown error'));
      } else {
        toast.error(err.message || 'Video generation failed');
      }
    },
  });

  // Save draft
  const saveDraftMutation = useMutation({
    mutationFn: () =>
      trpcClient.sandbox.saveDraft.mutate({
        title: title || prompt.slice(0, 80),
        prompt,
        imageUrl: generatedImageUrl ?? undefined,
        videoUrl: generatedVideoUrl ?? undefined,
        model: videoModel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      toast.success('Draft saved!');
      setPrompt('');
      setTitle('');
      setGeneratedImageUrl(null);
      setGeneratedVideoUrl(null);
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save draft'),
  });

  // Delete draft
  const deleteDraftMutation = useMutation({
    mutationFn: (id: string) => trpcClient.sandbox.deleteDraft.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      toast.success('Draft deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete draft'),
  });

  // Load saved drafts
  const { data: drafts } = useQuery({
    queryKey: ['sandbox-drafts'],
    queryFn: () => trpcClient.sandbox.myDrafts.query(),
    enabled: isAuthenticated,
  });

  const isGeneratingImage = generateImageMutation.isPending;
  const isGeneratingVideo = generateVideoMutation.isPending;
  const hasContent = !!generatedImageUrl || !!generatedVideoUrl;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">Sandbox</h1>
            <Badge variant="secondary">Beta</Badge>
          </div>
          <p className="text-muted-foreground">
            Create freely. No universe required — generate images and videos, then decide what to do
            with them.
          </p>
        </div>

        {!isAuthenticated && !isAuthenticating ? (
          <Card className="mb-8">
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
            {/* Left: Creation Panel */}
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
                  <label className="text-xs font-medium text-muted-foreground">Image ratio</label>
                  <Select
                    value={imageSize}
                    onValueChange={(v) => setImageSize(v as typeof imageSize)}
                  >
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

              {/* Action buttons */}
              <div className="flex gap-2">
                {isGeneratingImage || isGeneratingVideo ? (
                  /* While generating: show progress + Start New button */
                  <>
                    <Button disabled className="flex-1" variant="outline">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {isGeneratingImage ? 'Generating image…' : `Generating video…`}
                    </Button>
                    <Button onClick={startNew} className="flex-1">
                      <Plus className="h-4 w-4 mr-2" />
                      Start New
                    </Button>
                  </>
                ) : (
                  /* Normal state: Generate Image / Generate Video */
                  <>
                    <Button
                      onClick={() => {
                        movedOnRef.current = false;
                        setMovedOn(false);
                        generateImageMutation.mutate();
                      }}
                      disabled={!prompt.trim()}
                      className="flex-1"
                    >
                      <ImageIcon className="h-4 w-4 mr-2" />
                      Generate Image
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        movedOnRef.current = false;
                        setMovedOn(false);
                        generateVideoMutation.mutate();
                      }}
                      disabled={
                        (!generatedImageUrl &&
                          videoModel !== 'seedance' &&
                          videoModel !== 'seedance-fast') ||
                        !prompt.trim()
                      }
                      title={
                        videoModel === 'seedance' || videoModel === 'seedance-fast'
                          ? 'Seedance supports text-to-video — no image needed'
                          : 'Generate an image first, then animate'
                      }
                    >
                      <Video className="h-4 w-4 mr-2" />
                      {generatedImageUrl ? 'Animate' : 'Generate Video'}
                    </Button>
                  </>
                )}
              </div>

              {/* Background generation banner */}
              {bgGenerations.some((g) => g.status === 'generating') && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-primary">
                    {bgGenerations.filter((g) => g.status === 'generating').length} generation
                    {bgGenerations.filter((g) => g.status === 'generating').length > 1
                      ? 's'
                      : ''}{' '}
                    running in background
                  </span>
                  <span className="text-muted-foreground text-xs ml-auto">
                    Auto-saves when done
                  </span>
                </div>
              )}

              {/* Preview */}
              {(generatedImageUrl ||
                generatedVideoUrl ||
                isGeneratingImage ||
                isGeneratingVideo) && (
                <div className="rounded-lg overflow-hidden bg-muted aspect-video flex items-center justify-center">
                  {isGeneratingImage && (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-sm">Generating image…</p>
                      <p className="text-xs text-muted-foreground/60">
                        Click "Start New" above to begin another while this finishes
                      </p>
                    </div>
                  )}
                  {isGeneratingVideo && (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-sm">
                        {generatedImageUrl ? 'Animating' : 'Generating video'} with{' '}
                        {VIDEO_MODELS.find((m) => m.value === videoModel)?.label}…
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        This can take 1-3 min — click "Start New" to keep creating
                      </p>
                    </div>
                  )}
                  {!isGeneratingImage && !isGeneratingVideo && generatedVideoUrl && (
                    <video
                      src={generatedVideoUrl}
                      controls
                      autoPlay
                      loop
                      className="w-full h-full object-contain"
                    />
                  )}
                  {!isGeneratingImage &&
                    !isGeneratingVideo &&
                    !generatedVideoUrl &&
                    generatedImageUrl && (
                      <img
                        src={generatedImageUrl}
                        alt="Generated"
                        className="w-full h-full object-contain"
                      />
                    )}
                </div>
              )}

              {/* Save / publish actions */}
              {hasContent && (
                <div className="flex flex-col gap-3 pt-1">
                  <Input
                    placeholder="Give it a title (optional)"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => saveDraftMutation.mutate()}
                      disabled={saveDraftMutation.isPending}
                    >
                      {saveDraftMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Draft
                    </Button>
                    <Button className="flex-1" onClick={() => navigate({ to: '/create' })}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Universe
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Drafts Gallery */}
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Your Drafts</h2>

              {!drafts || drafts.length === 0 ? (
                <Card>
                  <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                    <Wand2 className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-muted-foreground text-sm">
                      Nothing saved yet. Generate something and hit Save Draft.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {drafts.map((draft: any) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      onDelete={() => deleteDraftMutation.mutate(draft.id)}
                      onLoad={() => {
                        setPrompt(draft.prompt);
                        setTitle(draft.title);
                        setGeneratedImageUrl(draft.imageUrl);
                        setGeneratedVideoUrl(draft.videoUrl);
                        if (draft.model) setVideoModel(draft.model as VideoModel);
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

// ── Draft Card with Edit + Promote ──────────────────────────────────

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
  onLoad: () => void;
}

function DraftCard({ draft, onDelete, onLoad }: DraftCardProps) {
  const queryClient = useQueryClient();
  const thumb = draft.videoUrl || draft.imageUrl;
  const isPromoted = draft.status === 'promoted';

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title);

  // Promote state — '__gallery__' = general gallery (no universe)
  const [showPromote, setShowPromote] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('__gallery__');
  const [classification, setClassification] = useState<'fan' | 'original' | 'licensed'>('original');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('public');

  // Fetch user's universes for promote selector
  const { data: universesResult } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
    enabled: showPromote,
  });
  const universes = (universesResult as any)?.data ?? universesResult ?? [];

  // Update draft mutation
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

  // Promote mutation
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
              onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
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

        {/* Status badge */}
        {isPromoted && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-green-500/90 text-white border-0 text-[10px]">Promoted</Badge>
          </div>
        )}

        {/* Hover actions */}
        {!showPromote && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {!isPromoted && (
              <Button size="sm" variant="default" onClick={() => setShowPromote(true)}>
                <Rocket className="h-3.5 w-3.5 mr-1" />
                Promote
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onLoad}>
              Load
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
        {/* Inline title edit */}
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

        {/* Promote to Universe panel */}
        {showPromote && !isPromoted && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              Promote to Universe
            </p>

            {/* Target selector — gallery or universe */}
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

            {/* Classification */}
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

            {/* Visibility */}
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

            {/* Actions */}
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
