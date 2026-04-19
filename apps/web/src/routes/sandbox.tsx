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
import React, { useCallback, useRef, useState } from 'react';
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
  Upload,
  Dices,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Eraser,
  Sun,
  Frame,
} from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';

export const Route = createFileRoute('/sandbox')({
  component: SandboxPage,
});

type VideoModel = 'fal-kling' | 'fal-wan25' | 'fal-veo3' | 'seedance' | 'seedance-fast';
type ImageSize = 'landscape_16_9' | 'portrait_16_9' | 'square_hd';
type AspectRatio = '16:9' | '9:16' | '1:1';

type ReferenceMode = 'animate' | 'style';

type Generation = {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  status: 'generating' | 'done' | 'failed';
  imageUrl?: string;
  videoUrl?: string;
  sourceImageUrl?: string;
  referenceMode?: ReferenceMode;
  negativePrompt?: string;
  seed?: number;
  stylePresetId?: string;
  imageModel?: string;
  videoModel?: VideoModel;
  imageSize: ImageSize;
  aspectRatio: AspectRatio;
  error?: string;
  draftId?: string;
  draftSaveError?: string;
  retryCount?: number;
  createdAt: number;
};

const VARIATION_OPTIONS = [1, 2, 4, 10] as const;
const MAX_CONCURRENT_GENS = 12;
const MAX_RETRIES_PER_GEN = 2;
const QUEUE_STORAGE_KEY = 'loar:sandbox:queue:v1';
const QUEUE_MAX_PERSISTED = 50;

// Style presets — clicking a chip appends its `suffix` into the prompt.
// They're additive (not exclusive) so users can stack vibes if they want.
const STYLE_PRESETS = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    suffix: 'cinematic lighting, 35mm film, shallow depth of field, color graded',
  },
  {
    id: 'photoreal',
    label: 'Photoreal',
    suffix: 'hyperrealistic, sharp focus, natural lighting, DSLR photo, 8k',
  },
  {
    id: 'anime',
    label: 'Anime',
    suffix: 'anime style, vibrant colors, cel-shaded, expressive eyes, Studio Ghibli inspired',
  },
  {
    id: 'manga',
    label: 'Manga',
    suffix: 'black and white manga panel, ink lines, screentone shading, dynamic composition',
  },
  {
    id: 'comic',
    label: 'Comic',
    suffix: 'western comic book art, bold ink outlines, halftone dots, dramatic shading',
  },
  {
    id: 'pixar',
    label: '3D Render',
    suffix:
      'pixar-style 3D render, soft global illumination, subsurface scattering, expressive character',
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    suffix: 'soft watercolor painting, paper texture, bleeding edges, pastel palette',
  },
  {
    id: 'oil',
    label: 'Oil Painting',
    suffix: 'classical oil painting, visible brushstrokes, rich impasto, chiaroscuro lighting',
  },
  {
    id: 'pixel',
    label: 'Pixel Art',
    suffix: '16-bit pixel art, limited palette, crisp pixels, retro game sprite',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    suffix: 'cyberpunk neon, rain-slick streets, holographic signs, cinematic rim lighting',
  },
  {
    id: 'noir',
    label: 'Film Noir',
    suffix: 'black and white film noir, harsh shadows, venetian blind lighting, 1940s mood',
  },
  {
    id: 'fantasy',
    label: 'High Fantasy',
    suffix: 'epic fantasy concept art, painterly style, golden hour, mythic scale',
  },
  {
    id: 'studio',
    label: 'Studio Portrait',
    suffix: 'studio portrait photography, softbox lighting, plain backdrop, sharp eyes',
  },
  {
    id: 'lowpoly',
    label: 'Low Poly',
    suffix: 'low poly 3D, flat shading, geometric facets, minimal palette',
  },
  {
    id: 'isometric',
    label: 'Isometric',
    suffix: 'isometric illustration, clean vector shapes, soft shadows, game asset',
  },
  {
    id: 'vaporwave',
    label: 'Vaporwave',
    suffix: 'vaporwave aesthetic, pastel pink and cyan, retro grid, 1990s VHS feel',
  },
] as const;
type StylePresetId = (typeof STYLE_PRESETS)[number]['id'];

function applyStylePreset(prompt: string, presetId: string | null): string {
  if (!presetId) return prompt;
  const preset = STYLE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return prompt;
  // Don't double-apply if the user already pasted in the suffix.
  if (prompt.toLowerCase().includes(preset.suffix.toLowerCase().slice(0, 20))) return prompt;
  const trimmed = prompt.trim();
  if (!trimmed) return preset.suffix;
  const sep = /[.!?]$/.test(trimmed) ? ' ' : '. ';
  return `${trimmed}${sep}${preset.suffix}`;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

// Phase 2 — quick edit operations exposed inline on done image cards.
// Each runs against an existing image URL and returns a new image URL,
// which we treat as a fresh Generation card for consistent UX.
type EditOp = 'upscale' | 'remove-bg' | 'relight' | 'outpaint';

const EDIT_OP_LABELS: Record<EditOp, string> = {
  upscale: '4× Upscale',
  'remove-bg': 'Remove BG',
  relight: 'Relight',
  outpaint: 'Outpaint',
};

const QUICK_RELIGHT_PRESETS = [
  { id: 'golden-hour', label: 'Golden Hour' },
  { id: 'neon-night', label: 'Neon Night' },
  { id: 'moonlit-alley', label: 'Moonlit Alley' },
  { id: 'stage-interview', label: 'Studio' },
  { id: 'warm-tavern', label: 'Warm Tavern' },
  { id: 'cold-wasteland', label: 'Cold Wasteland' },
  { id: 'cinematic-noir', label: 'Noir' },
  { id: 'volumetric-cathedral', label: 'God Rays' },
] as const;

const OUTPAINT_ASPECTS = ['1:1', '4:5', '16:9', '9:16', '21:9'] as const;
type OutpaintAspect = (typeof OUTPAINT_ASPECTS)[number];

function aspectToImageSize(aspect: OutpaintAspect): ImageSize {
  if (aspect === '9:16') return 'portrait_16_9';
  if (aspect === '1:1') return 'square_hd';
  return 'landscape_16_9';
}

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
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | null>(null);
  const [stylePreset, setStylePreset] = useState<StylePresetId | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize>('landscape_16_9');
  const [videoModel, setVideoModel] = useState<VideoModel>('seedance');
  const [imageModel, setImageModel] = useState<string>('');
  const [variations, setVariations] = useState<number>(1);
  const [referenceImage, setReferenceImage] = useState<{
    url: string;
    prompt: string;
    mode: ReferenceMode;
  } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  // Parallel generation queue — finished entries persist via localStorage so
  // a refresh doesn't lose what you generated. In-flight entries are dropped
  // on reload (server still completes the job and saves the draft).
  const [generations, setGenerations] = useState<Generation[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed: Generation[] = JSON.parse(raw);
      return parsed.filter((g) => g && g.status !== 'generating').slice(0, QUEUE_MAX_PERSISTED);
    } catch {
      return [];
    }
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const persistable = generations
        .filter((g) => g.status !== 'generating')
        .slice(0, QUEUE_MAX_PERSISTED);
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      // localStorage may be full or disabled — non-fatal
    }
  }, [generations]);

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

  const inFlightCountRef = React.useRef(0);
  const checkConcurrency = useCallback((requested: number): number => {
    const slack = MAX_CONCURRENT_GENS - inFlightCountRef.current;
    if (slack <= 0) {
      toast.error(
        `Queue is full (${MAX_CONCURRENT_GENS} running). Wait for a few to finish, then try again.`
      );
      return 0;
    }
    if (requested > slack) {
      toast.message(
        `Queue cap: starting ${slack} of ${requested}. Re-run to queue the rest once these finish.`
      );
      return slack;
    }
    return requested;
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
        updateGen(gen.id, { draftId: result.id, draftSaveError: undefined });
        queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      } catch (e: any) {
        // Generation succeeded but the draft record didn't persist — surface
        // it on the card so the user can retry instead of silently losing it.
        const msg = e?.message || 'Failed to save draft';
        console.warn('sandbox auto-save failed:', e);
        updateGen(gen.id, { draftSaveError: msg });
        toast.error('Generation kept locally — draft save failed: ' + msg);
      }
    },
    [queryClient, updateGen]
  );

  const runImageGen = useCallback(
    async (
      p: string,
      opts: {
        imageSize: ImageSize;
        imageModel: string;
        negativePrompt?: string;
        seed?: number | null;
        styleRefImageUrl?: string;
        stylePresetId?: string | null;
        retryOf?: Generation;
      }
    ) => {
      const id = makeId();
      // Style ref → switch to image_to_image. The image route uses the
      // reference for composition + style guidance.
      const useStyleRef = !!opts.styleRefImageUrl;
      const gen: Generation = {
        id,
        kind: 'image',
        prompt: p,
        status: 'generating',
        imageSize: opts.imageSize,
        aspectRatio: aspectFromSize(opts.imageSize),
        imageModel: opts.imageModel || undefined,
        negativePrompt: opts.negativePrompt || undefined,
        seed: opts.seed ?? undefined,
        sourceImageUrl: opts.styleRefImageUrl,
        referenceMode: useStyleRef ? 'style' : undefined,
        stylePresetId: opts.stylePresetId || undefined,
        retryCount: opts.retryOf ? (opts.retryOf.retryCount ?? 0) + 1 : 0,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [gen, ...prev]);
      inFlightCountRef.current += 1;
      try {
        const result = await trpcClient.image.generate.mutate({
          prompt: p,
          task: useStyleRef ? 'image_to_image' : 'text_to_image',
          ...(useStyleRef ? { imageUrls: [opts.styleRefImageUrl!] } : {}),
          imageSize: opts.imageSize,
          numImages: 1,
          ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
          ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
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
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, updateGen]
  );

  const runVideoGen = useCallback(
    async (
      p: string,
      opts: {
        videoModel: VideoModel;
        imageSize: ImageSize;
        sourceImageUrl?: string;
        negativePrompt?: string;
        stylePresetId?: string | null;
        retryOf?: Generation;
      }
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
        referenceMode: hasImage ? 'animate' : undefined,
        negativePrompt: opts.negativePrompt || undefined,
        stylePresetId: opts.stylePresetId || undefined,
        retryCount: opts.retryOf ? (opts.retryOf.retryCount ?? 0) + 1 : 0,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [gen, ...prev]);
      inFlightCountRef.current += 1;
      try {
        const r: any = await trpcClient.generation.generate.mutate({
          prompt: p,
          mode,
          routingMode: 'manual',
          selectedModelId,
          ...(hasImage ? { imageUrl: opts.sourceImageUrl } : {}),
          ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
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
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, updateGen]
  );

  // Run an image edit operation (upscale / remove-bg / relight / outpaint).
  // Each op produces a new image URL which we wrap as a fresh Generation card,
  // auto-saved as a draft just like a top-of-funnel image gen.
  const runEditOp = useCallback(
    async (
      source: Generation,
      op: EditOp,
      opts: {
        relightPresetIds?: string[];
        relightFreeText?: string;
        outpaintAspect?: OutpaintAspect;
        outpaintPrompt?: string;
      } = {}
    ) => {
      if (!source.imageUrl) {
        toast.error('Source image missing');
        return;
      }
      if (checkConcurrency(1) === 0) return;

      const id = makeId();
      const baseLabel = EDIT_OP_LABELS[op];
      const stub: Generation = {
        id,
        kind: 'image',
        prompt: `${baseLabel}: ${source.prompt}`.slice(0, 280),
        status: 'generating',
        imageSize:
          op === 'outpaint' && opts.outpaintAspect
            ? aspectToImageSize(opts.outpaintAspect)
            : source.imageSize,
        aspectRatio:
          op === 'outpaint' && opts.outpaintAspect
            ? (opts.outpaintAspect as AspectRatio)
            : source.aspectRatio,
        sourceImageUrl: source.imageUrl,
        retryCount: 0,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [stub, ...prev]);
      inFlightCountRef.current += 1;
      try {
        let outUrl: string | undefined;
        if (op === 'upscale') {
          const r = await trpcClient.editing.upscale.mutate({
            imageUrl: source.imageUrl,
            scale: 4,
          });
          outUrl = r.imageUrl;
        } else if (op === 'remove-bg') {
          const r = await trpcClient.editing.removeBackground.mutate({
            imageUrl: source.imageUrl,
          });
          outUrl = r.imageUrl;
        } else if (op === 'relight') {
          const presets = opts.relightPresetIds ?? [];
          const free = opts.relightFreeText?.trim();
          if (presets.length === 0 && !free) {
            throw new Error('Pick at least one lighting preset or describe the look');
          }
          const r = await trpcClient.editing.relight.mutate({
            imageUrl: source.imageUrl,
            presetIds: presets,
            ...(free ? { freeText: free } : {}),
            numImages: 1,
          });
          outUrl = (r as any).imageUrl ?? (r as any).images?.[0]?.url;
        } else if (op === 'outpaint') {
          if (!opts.outpaintAspect) throw new Error('Pick a target aspect');
          const r = await trpcClient.outpaint.expand.mutate({
            sourceImageUrl: source.imageUrl,
            targetAspect: opts.outpaintAspect,
            mode: 'preserve',
            prompt: opts.outpaintPrompt?.trim() || '',
          });
          outUrl = (r as any).imageUrl ?? (r as any).outputUrl;
        }

        if (!outUrl) throw new Error('Edit returned no image');
        const updated: Generation = { ...stub, status: 'done', imageUrl: outUrl };
        setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
        autoSaveDraft(updated);
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || `${baseLabel} failed` });
        toast.error(`${baseLabel} failed: ` + (err?.message || ''));
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, checkConcurrency, updateGen]
  );

  const retryGen = useCallback(
    (g: Generation) => {
      if ((g.retryCount ?? 0) >= MAX_RETRIES_PER_GEN) {
        toast.error(
          `Hit retry limit (${MAX_RETRIES_PER_GEN}). Tweak the prompt or pick a different model.`
        );
        return;
      }
      if (checkConcurrency(1) === 0) return;
      removeGen(g.id);
      if (g.kind === 'image') {
        runImageGen(g.prompt, {
          imageSize: g.imageSize,
          imageModel: g.imageModel || '',
          negativePrompt: g.negativePrompt,
          seed: g.seed ?? null,
          styleRefImageUrl: g.referenceMode === 'style' ? g.sourceImageUrl : undefined,
          stylePresetId: g.stylePresetId ?? null,
          retryOf: g,
        });
      } else {
        runVideoGen(g.prompt, {
          videoModel: g.videoModel ?? 'seedance',
          imageSize: g.imageSize,
          sourceImageUrl: g.sourceImageUrl,
          negativePrompt: g.negativePrompt,
          stylePresetId: g.stylePresetId ?? null,
          retryOf: g,
        });
      }
    },
    [checkConcurrency, removeGen, runImageGen, runVideoGen]
  );

  const retryDraftSave = useCallback(
    (g: Generation) => {
      if (g.draftId || !g.draftSaveError) return;
      autoSaveDraft(g);
    },
    [autoSaveDraft]
  );

  const handleAnimate = useCallback((g: Generation) => {
    if (!g.imageUrl) return;
    setReferenceImage({ url: g.imageUrl, prompt: g.prompt, mode: 'animate' });
    setPrompt(g.prompt);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Reference image loaded — pick a video model and hit Animate', { duration: 3000 });
  }, []);

  const handleUseAsStyleRef = useCallback((g: Generation) => {
    if (!g.imageUrl) return;
    setReferenceImage({ url: g.imageUrl, prompt: g.prompt, mode: 'style' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Style reference loaded — describe a new scene and hit Generate Image', {
      duration: 3000,
    });
  }, []);

  // Upload a local file as a style reference. Reuses /api/upload, the same
  // path the rest of the platform uses, so the URL is permanent + Pinata-backed.
  const uploadReferenceImage = useCallback(async (file: File, mode: ReferenceMode) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Reference must be an image file');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Reference image too large (25MB max)');
      return;
    }
    setIsUploadingRef(true);
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${serverUrl}/api/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const json = await res.json();
      const url: string | undefined = json?.uploads?.[0]?.url || json?.url;
      if (!url) throw new Error('Upload returned no URL');
      setReferenceImage({ url, prompt: '', mode });
      toast.success('Reference image ready');
    } catch (e: any) {
      toast.error('Reference upload failed: ' + (e?.message || ''));
    } finally {
      setIsUploadingRef(false);
    }
  }, []);

  const onRefDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) uploadReferenceImage(file, referenceImage?.mode ?? 'style');
    },
    [referenceImage?.mode, uploadReferenceImage]
  );

  // Prompt enhance — calls Gemini via tRPC. Falls back gracefully if Gemini
  // isn't configured (we surface the error rather than spinning forever).
  const enhancePrompt = useCallback(
    async (kind: 'image' | 'video') => {
      const trimmed = prompt.trim();
      if (!trimmed) {
        toast.error('Type a rough idea first, then enhance');
        return;
      }
      setIsEnhancing(true);
      try {
        const improved =
          kind === 'image'
            ? await trpcClient.wiki.improveImagePrompt.mutate({ userPrompt: trimmed })
            : await trpcClient.wiki.improveVideoPrompt.mutate({ userPrompt: trimmed });
        if (typeof improved === 'string' && improved.length > 0) {
          setPrompt(improved);
          toast.success('Prompt enhanced');
        } else {
          toast.error('Enhance returned an empty prompt');
        }
      } catch (e: any) {
        toast.error('Enhance failed: ' + (e?.message || ''));
      } finally {
        setIsEnhancing(false);
      }
    },
    [prompt]
  );

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
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Prompt</label>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      disabled={isEnhancing || !prompt.trim()}
                      onClick={() => enhancePrompt('image')}
                      title="Use Gemini to expand into a detailed image prompt"
                    >
                      {isEnhancing ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3 mr-1" />
                      )}
                      Enhance for image
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      disabled={isEnhancing || !prompt.trim()}
                      onClick={() => enhancePrompt('video')}
                      title="Use Gemini to expand into a cinematic video prompt"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      Enhance for video
                    </Button>
                  </div>
                </div>
                <Textarea
                  placeholder="Describe what you want to create… e.g. 'A lone samurai on a neon-lit rooftop in cyberpunk Tokyo'"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Style preset chips */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Style</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setStylePreset(null)}
                    className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                      stylePreset === null
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                    }`}
                  >
                    None
                  </button>
                  {STYLE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setStylePreset(p.id)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                        stylePreset === p.id
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                      }`}
                      title={p.suffix}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    title="Image only — fires N parallel generations from the same prompt"
                  >
                    Variations
                  </label>
                  <Select
                    value={String(variations)}
                    onValueChange={(v) => setVariations(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VARIATION_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}× {n === 1 ? 'image' : 'images'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Reference image — dropzone when empty, preview when set */}
              {referenceImage ? (
                <div className="flex items-center gap-3 p-2 rounded-lg border border-primary/30 bg-primary/5">
                  <img src={referenceImage.url} alt="" className="h-12 w-12 rounded object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium">Reference</p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setReferenceImage({ ...referenceImage, mode: 'style' })}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                            referenceImage.mode === 'style'
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                          }`}
                          title="Use as style + composition reference for image generation"
                        >
                          Style
                        </button>
                        <button
                          type="button"
                          onClick={() => setReferenceImage({ ...referenceImage, mode: 'animate' })}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                            referenceImage.mode === 'animate'
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                          }`}
                          title="Animate this image into a video"
                        >
                          Animate
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {referenceImage.mode === 'style'
                        ? 'Image-to-image: prompt drives style + content, ref guides composition'
                        : 'Image-to-video: ref becomes the first frame'}
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
              ) : (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onRefDrop}
                  onClick={() => refFileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors text-xs text-muted-foreground"
                >
                  {isUploadingRef ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {isUploadingRef
                      ? 'Uploading reference…'
                      : 'Drop or click to add a reference image (style or animate)'}
                  </span>
                  <input
                    ref={refFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadReferenceImage(f, 'style');
                      e.target.value = '';
                    }}
                  />
                </div>
              )}

              {/* Advanced controls — negative prompt + seed */}
              <div className="border border-border rounded-lg">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/40 rounded-lg"
                >
                  <span>Advanced (negative prompt, seed)</span>
                  {showAdvanced ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {showAdvanced && (
                  <div className="px-3 pb-3 flex flex-col gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Negative prompt
                      </label>
                      <Textarea
                        placeholder="What to avoid: e.g. 'blurry, low quality, extra fingers, watermark'"
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        rows={2}
                        className="resize-none text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        className="text-[11px] font-medium text-muted-foreground"
                        title="Same seed + same prompt + same model = reproducible result. Image only."
                      >
                        Seed (image only)
                      </label>
                      <div className="flex gap-1.5">
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="Random"
                          value={seed ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            setSeed(v ? Number(v) : null);
                          }}
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          onClick={() => setSeed(randomSeed())}
                          title="Roll a new random seed"
                        >
                          <Dices className="h-3 w-3 mr-1" />
                          Random
                        </Button>
                        {seed !== null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => setSeed(null)}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={!canGenerate}
                  onClick={() => {
                    const slots = checkConcurrency(variations);
                    if (slots === 0) return;
                    const finalPrompt = applyStylePreset(prompt, stylePreset);
                    const isStyleRef = referenceImage?.mode === 'style';
                    for (let i = 0; i < slots; i++) {
                      runImageGen(finalPrompt, {
                        imageSize,
                        imageModel,
                        negativePrompt: negativePrompt.trim() || undefined,
                        // For variations we want each result distinct — only
                        // fix the seed for the first one when N>1.
                        seed: variations > 1 && i > 0 ? null : seed,
                        styleRefImageUrl: isStyleRef ? referenceImage!.url : undefined,
                        stylePresetId: stylePreset ?? null,
                      });
                    }
                    if (isStyleRef) setReferenceImage(null);
                    setPrompt('');
                  }}
                >
                  <ImageIcon className="h-4 w-4 mr-2" />
                  {variations > 1 ? `Generate ${variations} Images` : 'Generate Image'}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!canGenerate || videoNeedsImage}
                  title={
                    videoNeedsImage ? 'Pick Seedance, or set a reference image first' : undefined
                  }
                  onClick={() => {
                    if (checkConcurrency(1) === 0) return;
                    const finalPrompt = applyStylePreset(prompt, stylePreset);
                    const useAnimate = referenceImage?.mode === 'animate';
                    runVideoGen(finalPrompt, {
                      videoModel,
                      imageSize,
                      sourceImageUrl: useAnimate ? referenceImage!.url : undefined,
                      negativePrompt: negativePrompt.trim() || undefined,
                      stylePresetId: stylePreset ?? null,
                    });
                    if (useAnimate) setReferenceImage(null);
                    setPrompt('');
                  }}
                >
                  <Video className="h-4 w-4 mr-2" />
                  {referenceImage?.mode === 'animate' ? 'Animate' : 'Generate Video'}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground -mt-1">
                Up to {MAX_CONCURRENT_GENS} generations run in parallel. Each run auto-saves as a
                draft and stays in your queue across reloads.
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
                      onUseAsStyleRef={() => handleUseAsStyleRef(g)}
                      onEditOp={(op, opts) => runEditOp(g, op, opts)}
                      onRetryDraftSave={() => retryDraftSave(g)}
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
                          setReferenceImage({
                            url: draft.imageUrl,
                            prompt: draft.prompt,
                            mode: draft.videoUrl ? 'animate' : 'style',
                          });
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
  onUseAsStyleRef: () => void;
  onEditOp: (
    op: EditOp,
    opts?: {
      relightPresetIds?: string[];
      relightFreeText?: string;
      outpaintAspect?: OutpaintAspect;
      outpaintPrompt?: string;
    }
  ) => void;
  onRetryDraftSave: () => void;
}

type EditPanel = null | 'menu' | 'relight' | 'outpaint';

function GenerationCard({
  gen,
  onDismiss,
  onRetry,
  onAnimate,
  onUseAsStyleRef,
  onEditOp,
  onRetryDraftSave,
}: GenerationCardProps) {
  const retriesLeft = MAX_RETRIES_PER_GEN - (gen.retryCount ?? 0);
  const [editPanel, setEditPanel] = useState<EditPanel>(null);
  const [relightPresets, setRelightPresets] = useState<string[]>([]);
  const [relightFree, setRelightFree] = useState('');
  const [outpaintAspect, setOutpaintAspect] = useState<OutpaintAspect>('16:9');
  const [outpaintPrompt, setOutpaintPrompt] = useState('');

  const toggleRelightPreset = (id: string) => {
    setRelightPresets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
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
        <div className="flex items-center gap-1 flex-wrap">
          {gen.status === 'done' && gen.draftId && (
            <Badge variant="outline" className="text-[10px]">
              Saved
            </Badge>
          )}
          {gen.status === 'done' && !gen.draftId && gen.draftSaveError && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-destructive"
              onClick={onRetryDraftSave}
              title={gen.draftSaveError}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Save draft
            </Button>
          )}
          {gen.status === 'done' && gen.kind === 'image' && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={onAnimate}
              >
                <Video className="h-3 w-3 mr-1" />
                Animate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={onUseAsStyleRef}
                title="Use as style + composition reference for new images"
              >
                <ImageIcon className="h-3 w-3 mr-1" />
                Style ref
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel((p) => (p === 'menu' ? null : 'menu'))}
                title="Image edit operations"
              >
                <Wand2 className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </>
          )}
          {gen.status === 'failed' && retriesLeft > 0 && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onRetry}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry ({retriesLeft} left)
            </Button>
          )}
          {gen.status === 'failed' && retriesLeft <= 0 && (
            <span className="text-[10px] text-muted-foreground">Retry limit reached</span>
          )}
        </div>

        {/* Edit menu — one-click ops + expandable panels */}
        {gen.status === 'done' && gen.kind === 'image' && editPanel === 'menu' && (
          <div className="mt-1.5 pt-1.5 border-t flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setEditPanel(null);
                onEditOp('upscale');
              }}
              title="4× super-resolution upscale"
            >
              <Maximize2 className="h-3 w-3 mr-1" />
              4× Upscale
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setEditPanel(null);
                onEditOp('remove-bg');
              }}
              title="Remove background — outputs transparent PNG"
            >
              <Eraser className="h-3 w-3 mr-1" />
              Remove BG
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel('relight')}
            >
              <Sun className="h-3 w-3 mr-1" />
              Relight…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel('outpaint')}
              title="Extend the canvas to a new aspect ratio"
            >
              <Frame className="h-3 w-3 mr-1" />
              Outpaint…
            </Button>
          </div>
        )}

        {gen.status === 'done' && editPanel === 'relight' && (
          <div className="mt-1.5 pt-1.5 border-t space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">
              Pick lighting (multi-select OK)
            </p>
            <div className="flex flex-wrap gap-1">
              {QUICK_RELIGHT_PRESETS.map((p) => {
                const active = relightPresets.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleRelightPreset(p.id)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <Input
              value={relightFree}
              onChange={(e) => setRelightFree(e.target.value)}
              placeholder="Or describe the look in your own words"
              className="h-7 text-[11px]"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] flex-1"
                disabled={relightPresets.length === 0 && !relightFree.trim()}
                onClick={() => {
                  onEditOp('relight', {
                    relightPresetIds: relightPresets,
                    relightFreeText: relightFree.trim() || undefined,
                  });
                  setEditPanel(null);
                  setRelightPresets([]);
                  setRelightFree('');
                }}
              >
                Relight
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {gen.status === 'done' && editPanel === 'outpaint' && (
          <div className="mt-1.5 pt-1.5 border-t space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">Target aspect</p>
            <div className="flex flex-wrap gap-1">
              {OUTPAINT_ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setOutpaintAspect(a)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    outpaintAspect === a
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <Input
              value={outpaintPrompt}
              onChange={(e) => setOutpaintPrompt(e.target.value)}
              placeholder="Optional: hint at what to add in the new canvas"
              className="h-7 text-[11px]"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] flex-1"
                onClick={() => {
                  onEditOp('outpaint', {
                    outpaintAspect,
                    outpaintPrompt: outpaintPrompt.trim() || undefined,
                  });
                  setEditPanel(null);
                  setOutpaintPrompt('');
                }}
              >
                Outpaint
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel(null)}
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
