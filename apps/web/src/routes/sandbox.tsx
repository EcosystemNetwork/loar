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
import type {
  VideoModel,
  ImageSize,
  AspectRatio,
  ReferenceMode,
  GenKind,
  Generation,
  SandboxMode,
  StylePresetId,
  EditOp,
  RestyleModelId,
  InterpolateMultiplier,
  VideoResolution,
  CameraIntensity,
  OutpaintAspect,
  DraftData,
} from '@/types/sandbox.types';
import {
  STYLE_PRESETS,
  RESTYLE_MODELS,
  INTERPOLATE_MULTIPLIERS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
  CAMERA_PRESET_OPTIONS,
  QUICK_RELIGHT_PRESETS,
  OUTPAINT_ASPECTS,
  VIDEO_MODELS,
  VALID_VIDEO_MODELS,
  SEEDANCE_MODELS,
  IMAGE_SIZES,
  MODEL_REGISTRY_MAP,
  MAX_CONCURRENT_GENS,
  QUEUE_MAX_PERSISTED,
  QUEUE_STORAGE_KEY,
  SANDBOX_TABS,
  VARIATION_OPTIONS,
  EDIT_OP_LABELS,
  MAX_RETRIES_PER_GEN,
} from '@/components/sandbox/constants';
import {
  applyStylePreset,
  randomSeed,
  isSubmitShortcut,
  makeId,
  aspectToImageSize,
  aspectFromSize,
} from '@/components/sandbox/utils';
import { GenerationCard } from '@/components/sandbox/GenerationCard';
import { DraftCard, inferDraftKind } from '@/components/sandbox/DraftCard';
import { useWalletAuth } from '@/lib/wallet-auth';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { SUPPORTED_CHAINS, type ChainSelection, DEFAULT_CHAIN_SELECTION } from '@/configs/chains';
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
  Mic,
} from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';
import { VoiceModifyPanel } from '@/components/editing/VoiceModifyPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export const Route = createFileRoute('/sandbox')({
  component: SandboxPage,
});

function SandboxPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Form state
  const [mode, setMode] = useState<SandboxMode>('image');
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

  // Video controls (only relevant in video mode)
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoResolution, setVideoResolution] = useState<VideoResolution>('720p');
  const [cameraPreset, setCameraPreset] = useState<string>('');
  const [cameraIntensity, setCameraIntensity] = useState<CameraIntensity>('standard');
  const [videoAudioOn, setVideoAudioOn] = useState<boolean>(true);

  // Drafts panel filter
  const [draftFilter, setDraftFilter] = useState<'all' | GenKind>('all');

  // Auto-send: after each generation auto-saves to drafts, optionally promote it
  // straight into a universe (or the user's gallery). Persists across reloads.
  // '__off__' = drafts only, '__gallery__' = promote to personal gallery (no
  // universe), any other value = universe id (Firestore doc id / contract addr).
  const AUTO_SEND_KEY = 'sandbox.autoSendTarget';
  const AUTO_SEND_CLASSIFICATION_KEY = 'sandbox.autoSendClassification';
  const AUTO_SEND_VISIBILITY_KEY = 'sandbox.autoSendVisibility';
  const TARGET_CHAIN_KEY = 'sandbox.targetChain';

  const readLocal = (key: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };

  const [autoSendTarget, setAutoSendTarget] = useState<string>(() =>
    readLocal(AUTO_SEND_KEY, '__off__')
  );
  const [autoSendClassification, setAutoSendClassification] = useState<
    'fan' | 'original' | 'licensed'
  >(() => readLocal(AUTO_SEND_CLASSIFICATION_KEY, 'fan') as 'fan' | 'original' | 'licensed');
  const [autoSendVisibility, setAutoSendVisibility] = useState<'public' | 'unlisted' | 'private'>(
    () => readLocal(AUTO_SEND_VISIBILITY_KEY, 'unlisted') as 'public' | 'unlisted' | 'private'
  );

  // Target chain — picks where generated items will eventually live (drafts get
  // a `targetChain` stamp, propagated on promote into content/universe). Stored
  // as a CAIP-2 ChainOption.id ("eip155:84532" | "solana:devnet").
  const [targetChainId, setTargetChainId] = useState<string>(() => {
    const stored = readLocal(TARGET_CHAIN_KEY, '');
    if (stored && SUPPORTED_CHAINS.some((c) => c.id === stored)) return stored;
    const def = SUPPORTED_CHAINS[0]?.id;
    return def ?? '';
  });
  const targetChainSelection: ChainSelection =
    SUPPORTED_CHAINS.find((c) => c.id === targetChainId)?.selection ?? DEFAULT_CHAIN_SELECTION;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AUTO_SEND_KEY, autoSendTarget);
      window.localStorage.setItem(AUTO_SEND_CLASSIFICATION_KEY, autoSendClassification);
      window.localStorage.setItem(AUTO_SEND_VISIBILITY_KEY, autoSendVisibility);
      window.localStorage.setItem(TARGET_CHAIN_KEY, targetChainId);
    } catch {
      // localStorage may be unavailable (SSR, private mode) — settings won't persist this turn.
    }
  }, [autoSendTarget, autoSendClassification, autoSendVisibility, targetChainId]);

  // Refs so autoSaveDraft reads the latest values without re-building every
  // run* callback (and their long dep chains) when settings change.
  const autoSendTargetRef = React.useRef(autoSendTarget);
  const autoSendClassificationRef = React.useRef(autoSendClassification);
  const autoSendVisibilityRef = React.useRef(autoSendVisibility);
  const targetChainIdRef = React.useRef(targetChainId);
  React.useEffect(() => {
    autoSendTargetRef.current = autoSendTarget;
    autoSendClassificationRef.current = autoSendClassification;
    autoSendVisibilityRef.current = autoSendVisibility;
    targetChainIdRef.current = targetChainId;
  }, [autoSendTarget, autoSendClassification, autoSendVisibility, targetChainId]);

  // Only list universes the caller can actually promote into — server does the
  // creator-match + multi-sig owner check.
  const { data: autoSendUniversesResult } = useQuery({
    queryKey: ['sandbox-promotable-universes'],
    queryFn: () => trpcClient.sandbox.myPromotableUniverses.query(),
    enabled: isAuthenticated,
  });
  const autoSendUniverses: any[] = Array.isArray(autoSendUniversesResult)
    ? autoSendUniversesResult
    : [];

  // If the user previously saved a universe id that they no longer admin,
  // gracefully fall back to off so we don't silently fail on every generation.
  React.useEffect(() => {
    if (
      autoSendTarget !== '__off__' &&
      autoSendTarget !== '__gallery__' &&
      autoSendUniversesResult &&
      !autoSendUniverses.some((u) => u.id === autoSendTarget)
    ) {
      setAutoSendTarget('__off__');
    }
  }, [autoSendTarget, autoSendUniversesResult, autoSendUniverses]);

  // Voice / audio / talking-scene state
  const [voiceMode, setVoiceMode] = useState<'tts' | 'sfx'>('tts');
  const [voiceId, setVoiceId] = useState<string>('');
  const [sfxDuration, setSfxDuration] = useState<number>(5);
  const [audioDuration, setAudioDuration] = useState<number>(15);
  const [audioGenre, setAudioGenre] = useState<string>('');
  const [threedMode, setThreedMode] = useState<'text' | 'image'>('text');
  const [threedArtStyle, setThreedArtStyle] = useState<
    'realistic' | 'cartoon' | 'low-poly' | 'sculpture' | 'pbr'
  >('realistic');
  const [talkingDialogue, setTalkingDialogue] = useState<string>('');
  const [talkingMotion, setTalkingMotion] = useState<string>('');
  const [talkingDuration, setTalkingDuration] = useState<number>(6);

  const { data: voicesList } = useQuery({
    queryKey: ['sandbox-voices'],
    queryFn: () => trpcClient.voice.listVoices.query(),
    enabled: isAuthenticated && (mode === 'voice' || mode === 'talking'),
    staleTime: 5 * 60 * 1000,
  });
  // Pick a sane default voice once the list loads.
  React.useEffect(() => {
    if (!voiceId && Array.isArray(voicesList) && voicesList.length > 0) {
      setVoiceId((voicesList[0] as any).voice_id || (voicesList[0] as any).id || '');
    }
  }, [voicesList, voiceId]);

  // Parallel generation queue — finished entries persist via localStorage so
  // a refresh doesn't lose what you generated. In-flight entries that are
  // interrupted are mapped to 'failed' so users can press Retry without losing settings.
  const [generations, setGenerations] = useState<Generation[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed: Generation[] = JSON.parse(raw);
      return parsed
        .filter(Boolean)
        .map((g) =>
          g.status === 'generating'
            ? { ...g, status: 'failed' as const, error: 'Interrupted by navigation' }
            : g
        )
        .slice(0, QUEUE_MAX_PERSISTED);
    } catch {
      return [];
    }
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const persistable = generations
        .map((g) => {
          // Fix F: Omit massive data URLs to prevent QuotaExceededError
          if (g.sourceImageUrl?.startsWith('data:')) {
            return { ...g, sourceImageUrl: undefined };
          }
          return g;
        })
        .slice(0, QUEUE_MAX_PERSISTED);
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(persistable));
    } catch (e) {
      console.warn('[sandbox] localStorage save failed', e);
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
  const isMounted = React.useRef(true);
  React.useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

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
        const draftKind: 'image' | 'video' | 'audio' | '3d' =
          gen.kind === '3d-model' ? '3d' : gen.kind;
        const result = await trpcClient.sandbox.saveDraft.mutate({
          title: gen.prompt.slice(0, 80) || 'Untitled',
          prompt: gen.prompt,
          imageUrl: gen.imageUrl,
          videoUrl: gen.videoUrl,
          audioUrl: gen.audioUrl,
          modelUrl: gen.modelUrl,
          thumbnailUrl: gen.thumbnailUrl,
          kind: draftKind,
          model: gen.kind === 'video' ? gen.videoModel : gen.imageModel || undefined,
          // Stamp the user's currently-selected target chain so promote → content
          // carries the chain forward without a second decision.
          targetChain: targetChainIdRef.current || undefined,
        });
        updateGen(gen.id, { draftId: result.id, draftSaveError: undefined });
        queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });

        // Auto-send: if the user has picked a target, promote the freshly
        // saved draft straight to the gallery or a universe. Server enforces
        // universe admin access — a rejection surfaces as a toast but does
        // not fail the generation itself.
        const target = autoSendTargetRef.current;
        if (target && target !== '__off__') {
          try {
            const universeId = target === '__gallery__' ? undefined : target;
            await trpcClient.sandbox.promoteToUniverse.mutate({
              draftId: result.id,
              ...(universeId ? { universeId } : {}),
              classification: autoSendClassificationRef.current,
              visibility: autoSendVisibilityRef.current,
            });
            queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
          } catch (e: any) {
            const msg = e?.message || 'Auto-send failed';
            toast.error('Saved to drafts, but auto-send failed: ' + msg);
          }
        }
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
        durationSec?: number;
        resolution?: VideoResolution;
        cameraPreset?: string;
        cameraIntensity?: CameraIntensity;
        audioOn?: boolean;
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
      const audio = opts.audioOn !== undefined ? opts.audioOn : isSeedance;

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
        videoDurationSec: opts.durationSec,
        videoResolution: opts.resolution,
        cameraPreset: opts.cameraPreset || undefined,
        cameraIntensity: opts.cameraPreset ? opts.cameraIntensity : undefined,
        videoAudio: audio,
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
          durationSec: opts.durationSec ?? 5,
          resolution: opts.resolution ?? '720p',
          aspectRatio,
          audio,
          ...(opts.cameraPreset ? { cameraPreset: opts.cameraPreset } : {}),
          ...(opts.cameraPreset && opts.cameraIntensity
            ? { cameraIntensity: opts.cameraIntensity }
            : {}),
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

  // ── Voice (TTS + SFX) ─────────────────────────────────────────────────
  const runVoiceGen = useCallback(
    async (
      text: string,
      opts: { voiceId: string; flavor: 'tts' | 'sfx'; sfxDurationSec?: number }
    ) => {
      const id = makeId();
      const flavorLabel = opts.flavor === 'tts' ? 'TTS' : 'SFX';
      const stub: Generation = {
        id,
        kind: 'audio',
        prompt: `${flavorLabel}: ${text}`.slice(0, 280),
        status: 'generating',
        imageSize: 'square_hd',
        aspectRatio: '1:1',
        audioFlavor: opts.flavor,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [stub, ...prev]);
      inFlightCountRef.current += 1;
      try {
        let outUrl: string | undefined;
        if (opts.flavor === 'tts') {
          if (!opts.voiceId) throw new Error('Pick a voice first');
          const r: any = await trpcClient.voice.synthesize.mutate({
            text,
            voiceId: opts.voiceId,
          });
          outUrl = r?.audioUrl ?? null;
          if (!outUrl) throw new Error('TTS returned no audio (try again)');
        } else {
          const r: any = await trpcClient.voice.soundEffect.mutate({
            text,
            ...(opts.sfxDurationSec ? { durationSeconds: opts.sfxDurationSec } : {}),
          });
          outUrl = r?.audioUrl ?? null;
          if (!outUrl) throw new Error('SFX returned no audio (try again)');
        }
        const updated: Generation = { ...stub, status: 'done', audioUrl: outUrl };
        setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
        autoSaveDraft(updated);
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || 'Voice generation failed' });
        toast.error('Voice gen failed: ' + (err?.message || ''));
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, updateGen]
  );

  // ── Audio (text→music) ────────────────────────────────────────────────
  const runAudioGen = useCallback(
    async (p: string, opts: { durationSec: number; genre?: string }) => {
      const id = makeId();
      const stub: Generation = {
        id,
        kind: 'audio',
        prompt: `Music: ${p}`.slice(0, 280),
        status: 'generating',
        imageSize: 'square_hd',
        aspectRatio: '1:1',
        audioFlavor: 'music',
        createdAt: Date.now(),
      };
      setGenerations((prev) => [stub, ...prev]);
      inFlightCountRef.current += 1;
      try {
        const r: any = await trpcClient.audio.generate.mutate({
          prompt: p,
          mode: 'text_to_music',
          durationSec: opts.durationSec,
          ...(opts.genre ? { genre: opts.genre } : {}),
        });
        const url = r?.audioUrl ?? null;
        if (!url) throw new Error('Music gen returned no audio');
        const updated: Generation = { ...stub, status: 'done', audioUrl: url };
        setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
        autoSaveDraft(updated);
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || 'Audio generation failed' });
        toast.error('Audio gen failed: ' + (err?.message || ''));
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, updateGen]
  );

  // ── 3D (async via Meshy) ──────────────────────────────────────────────
  const run3DGen = useCallback(
    async (
      p: string,
      opts: {
        threedMode: 'text' | 'image';
        artStyle: 'realistic' | 'cartoon' | 'low-poly' | 'sculpture' | 'pbr';
        imageUrl?: string;
      }
    ) => {
      const id = makeId();
      const stub: Generation = {
        id,
        kind: '3d-model',
        prompt: `3D ${opts.threedMode === 'image' ? '(image→3D)' : '(text→3D)'}: ${p}`.slice(
          0,
          280
        ),
        status: 'generating',
        imageSize: 'square_hd',
        aspectRatio: '1:1',
        thumbnailUrl: opts.imageUrl,
        sourceImageUrl: opts.imageUrl,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [stub, ...prev]);
      inFlightCountRef.current += 1;
      try {
        let pollId: string;
        if (opts.threedMode === 'image') {
          if (!opts.imageUrl) throw new Error('3D from image needs an uploaded image');
          const r: any = await trpcClient.threed.imageTo3D.mutate({
            imageUrls: [opts.imageUrl],
            enablePbr: opts.artStyle === 'pbr' || opts.artStyle === 'realistic',
          });
          pollId = r?.generationId;
        } else {
          const r: any = await trpcClient.threed.textTo3DPreview.mutate({
            prompt: p,
            artStyle: opts.artStyle,
          });
          pollId = r?.generationId;
        }
        if (!pollId) throw new Error('3D job did not return a generation ID');
        updateGen(id, { pollGenerationId: pollId });

        // Poll up to ~10 minutes (matches the server-side timeout)
        const started = Date.now();
        const TIMEOUT_MS = 10 * 60 * 1000;
        const pollIntervalMs = 5_000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (!isMounted.current) return;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          if (!isMounted.current) return;
          const t: any = await trpcClient.threed.getTask.query({ generationId: pollId });
          if (!t) throw new Error('3D task disappeared');
          const status = t.status as string | undefined;
          if (status === 'completed') {
            const modelUrl: string | undefined =
              t.modelUrls?.glb || t.modelUrls?.fbx || t.modelUrls?.obj || t.modelUrls?.usdz;
            const thumb: string | undefined = t.thumbnailUrl || t.videoUrl;
            if (!modelUrl) throw new Error('3D job completed but produced no model file');
            const updated: Generation = {
              ...stub,
              status: 'done',
              modelUrl,
              thumbnailUrl: t.thumbnailUrl || stub.thumbnailUrl,
              videoUrl: t.videoUrl, // turntable preview if present
              imageUrl: thumb,
            };
            setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
            autoSaveDraft(updated);
            break;
          }
          if (status === 'failed') {
            throw new Error(t.failureReason || '3D generation failed');
          }
          if (Date.now() - started > TIMEOUT_MS) {
            throw new Error(
              '3D job timed out (10 min). Check the gallery later — the server may still finish.'
            );
          }
        }
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || '3D generation failed' });
        toast.error('3D gen failed: ' + (err?.message || ''));
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, updateGen]
  );

  // ── Talking scene (image + dialogue → lip-synced video) ──────────────
  const runTalkingScene = useCallback(
    async (opts: {
      imageUrl: string;
      dialogue: string;
      voiceId: string;
      motionPrompt?: string;
      durationSec: number;
    }) => {
      const id = makeId();
      const stub: Generation = {
        id,
        kind: 'video',
        prompt: `Talking: ${opts.dialogue}`.slice(0, 280),
        status: 'generating',
        imageSize: 'landscape_16_9',
        aspectRatio: '16:9',
        sourceImageUrl: opts.imageUrl,
        imageUrl: opts.imageUrl,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [stub, ...prev]);
      inFlightCountRef.current += 1;
      try {
        const r: any = await trpcClient.talkingScene.create.mutate({
          imageUrl: opts.imageUrl,
          dialogue: opts.dialogue,
          voiceId: opts.voiceId,
          ...(opts.motionPrompt ? { motionPrompt: opts.motionPrompt } : {}),
          durationSec: opts.durationSec,
        });
        const url: string | undefined = r?.videoUrl ?? r?.outputUrl;
        if (!url) throw new Error('Talking scene returned no video');
        const updated: Generation = { ...stub, status: 'done', videoUrl: url };
        setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
        autoSaveDraft(updated);
      } catch (err: any) {
        updateGen(id, { status: 'failed', error: err?.message || 'Talking scene failed' });
        toast.error('Talking scene failed: ' + (err?.message || ''));
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      }
    },
    [autoSaveDraft, updateGen]
  );

  // Run an image or video edit operation. Each op creates a fresh Generation
  // card and is auto-saved as a draft just like a top-of-funnel generation.
  const runEditOp = useCallback(
    async (
      source: Generation,
      op: EditOp,
      opts: {
        relightPresetIds?: string[];
        relightFreeText?: string;
        outpaintAspect?: OutpaintAspect;
        outpaintPrompt?: string;
        restylePrompt?: string;
        restyleStrength?: number;
        restyleModelId?: RestyleModelId;
        extendPrompt?: string;
        extendDurationSec?: number;
        interpolateMultiplier?: InterpolateMultiplier;
      } = {}
    ) => {
      const isVideoOp = op === 'restyle' || op === 'extend' || op === 'interpolate';
      const sourceUrl = isVideoOp ? source.videoUrl : source.imageUrl;
      if (!sourceUrl) {
        toast.error(isVideoOp ? 'Source video missing' : 'Source image missing');
        return;
      }
      if (checkConcurrency(1) === 0) return;

      const id = makeId();
      const baseLabel = EDIT_OP_LABELS[op];
      const stub: Generation = {
        id,
        kind: isVideoOp ? 'video' : 'image',
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
        sourceImageUrl: isVideoOp ? source.imageUrl : source.imageUrl,
        retryCount: 0,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [stub, ...prev]);
      inFlightCountRef.current += 1;
      try {
        let outUrl: string | undefined;
        let outVideoUrl: string | undefined;
        if (op === 'upscale') {
          const r = await trpcClient.editing.upscale.mutate({
            imageUrl: source.imageUrl!,
            scale: 4,
          });
          outUrl = r.imageUrl;
        } else if (op === 'remove-bg') {
          const r = await trpcClient.editing.removeBackground.mutate({
            imageUrl: source.imageUrl!,
          });
          outUrl = r.imageUrl;
        } else if (op === 'relight') {
          const presets = opts.relightPresetIds ?? [];
          const free = opts.relightFreeText?.trim();
          if (presets.length === 0 && !free) {
            throw new Error('Pick at least one lighting preset or describe the look');
          }
          const r = await trpcClient.editing.relight.mutate({
            imageUrl: source.imageUrl!,
            presetIds: presets,
            ...(free ? { freeText: free } : {}),
            numImages: 1,
          });
          outUrl = (r as any).imageUrl ?? (r as any).images?.[0]?.url;
        } else if (op === 'outpaint') {
          if (!opts.outpaintAspect) throw new Error('Pick a target aspect');
          const r = await trpcClient.outpaint.expand.mutate({
            sourceImageUrl: source.imageUrl!,
            targetAspect: opts.outpaintAspect,
            mode: 'preserve',
            prompt: opts.outpaintPrompt?.trim() || '',
          });
          outUrl = (r as any).imageUrl ?? (r as any).outputUrl;
        } else if (op === 'restyle') {
          const p = opts.restylePrompt?.trim();
          if (!p) throw new Error('Restyle needs a prompt describing the new look');
          const r = await trpcClient.editing.restyle.mutate({
            videoUrl: source.videoUrl!,
            prompt: p,
            modelId: opts.restyleModelId ?? 'restyle-wan-v2v',
            strength: opts.restyleStrength ?? 0.65,
          });
          outVideoUrl = (r as any).videoUrl;
        } else if (op === 'extend') {
          const p = opts.extendPrompt?.trim();
          if (!p) throw new Error('Extend needs a prompt for what happens next');
          const r = await trpcClient.editing.extend.mutate({
            videoUrl: source.videoUrl!,
            prompt: p,
            durationSec: opts.extendDurationSec ?? 5,
          });
          outVideoUrl = (r as any).videoUrl;
        } else if (op === 'interpolate') {
          const r = await trpcClient.editing.interpolate.mutate({
            videoUrl: source.videoUrl!,
            multiplier: opts.interpolateMultiplier ?? 2,
          });
          outVideoUrl = (r as any).videoUrl;
        }

        if (isVideoOp) {
          if (!outVideoUrl) throw new Error('Edit returned no video');
          const updated: Generation = { ...stub, status: 'done', videoUrl: outVideoUrl };
          setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
          autoSaveDraft(updated);
        } else {
          if (!outUrl) throw new Error('Edit returned no image');
          const updated: Generation = { ...stub, status: 'done', imageUrl: outUrl };
          setGenerations((prev) => prev.map((g) => (g.id === id ? updated : g)));
          autoSaveDraft(updated);
        }
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
          durationSec: g.videoDurationSec,
          resolution: g.videoResolution,
          cameraPreset: g.cameraPreset,
          cameraIntensity: g.cameraIntensity,
          audioOn: g.videoAudio,
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

  const handleVoiceModified = useCallback(
    (source: Generation, newAudioUrl: string, _newGenerationId: string, presetLabel: string) => {
      const id = makeId();
      const newGen: Generation = {
        id,
        kind: 'audio',
        prompt: `Modified (${presetLabel}) — ${source.prompt}`.slice(0, 280),
        status: 'done',
        imageSize: 'square_hd',
        aspectRatio: '1:1',
        audioFlavor: source.audioFlavor ?? 'tts',
        audioUrl: newAudioUrl,
        createdAt: Date.now(),
      };
      setGenerations((prev) => [newGen, ...prev]);
      autoSaveDraft(newGen);
    },
    [autoSaveDraft]
  );

  // Upload a local file. Images become reference images for the next gen;
  // videos land directly in the queue as 'imported' done cards so users can
  // immediately run video edit ops (restyle / extend / interpolate) on their
  // own footage. Reuses /api/upload (Pinata-backed permanent URLs).
  const uploadAsset = useCallback(
    async (file: File, mode: ReferenceMode) => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !isVideo) {
        toast.error('Drop an image or video file');
        return;
      }
      const cap = isVideo ? 200 : 25;
      if (file.size > cap * 1024 * 1024) {
        toast.error(`${isVideo ? 'Video' : 'Image'} too large (${cap}MB max)`);
        return;
      }
      setIsUploadingRef(true);
      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
        // Pre-flight session check (matches DirectUpload) so a stale cookie
        // surfaces a clean error instead of a cryptic 401 mid-upload.
        const meRes = await fetch(`${serverUrl}/auth/me`, { credentials: 'include' });
        if (!meRes.ok || !(await meRes.json())?.authenticated) {
          toast.error('Session expired — please sign in again');
          setIsUploadingRef(false);
          return;
        }
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

        if (isImage) {
          setReferenceImage({ url, prompt: '', mode });
          toast.success('Reference image ready');
        } else {
          // Imported video → drop a synthetic done card into the queue so the
          // user can run Restyle / Extend / Interpolate on their own footage.
          const id = makeId();
          const imported: Generation = {
            id,
            kind: 'video',
            prompt: `Imported: ${file.name}`,
            status: 'done',
            videoUrl: url,
            imageSize: 'landscape_16_9',
            aspectRatio: '16:9',
            createdAt: Date.now(),
          };
          setGenerations((prev) => [imported, ...prev]);
          // Persist as a draft so it survives reloads + lands in the gallery.
          autoSaveDraft(imported);
          toast.success('Video imported — open the Edit menu to restyle/extend/interpolate');
        }
      } catch (e: any) {
        toast.error('Upload failed: ' + (e?.message || ''));
      } finally {
        setIsUploadingRef(false);
      }
    },
    [autoSaveDraft]
  );

  const onRefDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) uploadAsset(file, referenceImage?.mode ?? 'style');
    },
    [referenceImage?.mode, uploadAsset]
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

  // ⌘/Ctrl+Enter triggers the primary action of the active tab.
  const submitCurrent = useCallback(() => {
    if (mode === 'image') {
      if (!canGenerate) return;
      const slots = checkConcurrency(variations);
      if (slots === 0) return;
      const finalPrompt = applyStylePreset(prompt, stylePreset);
      const isStyleRef = referenceImage?.mode === 'style';
      for (let i = 0; i < slots; i++) {
        runImageGen(finalPrompt, {
          imageSize,
          imageModel,
          negativePrompt: negativePrompt.trim() || undefined,
          seed: variations > 1 && i > 0 ? null : seed,
          styleRefImageUrl: isStyleRef ? referenceImage!.url : undefined,
          stylePresetId: stylePreset ?? null,
        });
      }
      if (isStyleRef) setReferenceImage(null);
      setPrompt('');
    } else if (mode === 'video') {
      if (!canGenerate || videoNeedsImage) return;
      if (checkConcurrency(1) === 0) return;
      const finalPrompt = applyStylePreset(prompt, stylePreset);
      const useAnimate = referenceImage?.mode === 'animate';
      runVideoGen(finalPrompt, {
        videoModel,
        imageSize,
        sourceImageUrl: useAnimate ? referenceImage!.url : undefined,
        negativePrompt: negativePrompt.trim() || undefined,
        stylePresetId: stylePreset ?? null,
        durationSec: videoDuration,
        resolution: videoResolution,
        cameraPreset: cameraPreset || undefined,
        cameraIntensity: cameraPreset ? cameraIntensity : undefined,
        audioOn: videoAudioOn,
      });
      if (useAnimate) setReferenceImage(null);
      setPrompt('');
    } else if (mode === 'voice') {
      if (!prompt.trim() || (voiceMode === 'tts' && !voiceId)) return;
      if (checkConcurrency(1) === 0) return;
      runVoiceGen(prompt, {
        voiceId,
        flavor: voiceMode,
        sfxDurationSec: voiceMode === 'sfx' ? sfxDuration : undefined,
      });
      setPrompt('');
    } else if (mode === 'audio') {
      if (!prompt.trim()) return;
      if (checkConcurrency(1) === 0) return;
      runAudioGen(prompt, {
        durationSec: audioDuration,
        genre: audioGenre.trim() || undefined,
      });
      setPrompt('');
    } else if (mode === '3d') {
      const sourceImg = drafts?.find((d: any) => d.imageUrl)?.imageUrl ?? undefined;
      if (threedMode === 'text' && !prompt.trim()) return;
      if (threedMode === 'image' && !sourceImg) return;
      if (checkConcurrency(1) === 0) return;
      run3DGen(prompt, {
        threedMode,
        artStyle: threedArtStyle,
        ...(threedMode === 'image' && sourceImg ? { imageUrl: sourceImg } : {}),
      });
      setPrompt('');
    } else if (mode === 'talking') {
      if (!referenceImage?.url || !talkingDialogue.trim() || !voiceId) return;
      if (checkConcurrency(1) === 0) return;
      runTalkingScene({
        imageUrl: referenceImage.url,
        dialogue: talkingDialogue,
        voiceId,
        motionPrompt: talkingMotion.trim() || undefined,
        durationSec: talkingDuration,
      });
      setTalkingDialogue('');
      setTalkingMotion('');
      setReferenceImage(null);
    }
  }, [
    mode,
    canGenerate,
    videoNeedsImage,
    checkConcurrency,
    variations,
    prompt,
    stylePreset,
    referenceImage,
    imageSize,
    imageModel,
    negativePrompt,
    seed,
    runImageGen,
    runVideoGen,
    videoModel,
    videoDuration,
    videoResolution,
    cameraPreset,
    cameraIntensity,
    videoAudioOn,
    voiceMode,
    voiceId,
    sfxDuration,
    runVoiceGen,
    audioDuration,
    audioGenre,
    runAudioGen,
    threedMode,
    threedArtStyle,
    drafts,
    run3DGen,
    talkingDialogue,
    talkingMotion,
    talkingDuration,
    runTalkingScene,
  ]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      // Only fire when typing inside the sandbox form (textarea/input)
      const tag = active.tagName.toLowerCase();
      if (tag !== 'textarea' && tag !== 'input') return;
      e.preventDefault();
      submitCurrent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitCurrent]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 sm:py-8 max-w-6xl pb-bottom-nav md:pb-12">
        {/* Header */}
        <div className="mb-6 sm:mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <Sparkles className="h-6 w-6 text-primary" />
              <h1 className="text-2xl sm:text-3xl font-bold">Lab</h1>
              <Badge variant="secondary">Beta</Badge>
              {activeCount > 0 && (
                <Badge className="bg-primary/20 text-primary border-primary/30">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  {activeCount} running
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Image, video, voice, audio, 3D, and lip-synced talking scenes — all queue in parallel
              and auto-save to your drafts. Press{' '}
              <kbd className="px-1 py-0.5 text-[10px] bg-muted rounded border border-border">
                ⌘↵
              </kbd>{' '}
              in any prompt to fire.
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Left: create + queue */}
            <div className="flex flex-col gap-4 min-w-0">
              <h2 className="text-lg font-semibold">Create</h2>

              {/* Mode tabs */}
              <div className="flex flex-wrap gap-1 border border-border rounded-lg p-1 bg-muted/20">
                {SANDBOX_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMode(t.id)}
                    className={`flex-1 min-w-[70px] text-[11px] px-2 py-1.5 rounded transition-colors ${
                      mode === t.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/60'
                    }`}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {(mode === 'image' || mode === 'video') && (
                <>
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
                      <label className="text-xs font-medium text-muted-foreground">
                        Video model
                      </label>
                      <Select
                        value={videoModel}
                        onValueChange={(v) => setVideoModel(v as VideoModel)}
                      >
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
                      <img
                        src={referenceImage.url}
                        alt=""
                        className="h-12 w-12 rounded object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium">Reference</p>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setReferenceImage({ ...referenceImage, mode: 'style' })
                              }
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
                              onClick={() =>
                                setReferenceImage({ ...referenceImage, mode: 'animate' })
                              }
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
                          ? 'Uploading…'
                          : 'Drop or click to add an image (style/animate ref) or a video (import for restyle/extend/interpolate)'}
                      </span>
                      <input
                        ref={refFileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAsset(f, 'style');
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

                  {/* Video controls — only relevant in video mode */}
                  {mode === 'video' && (
                    <div className="border border-border rounded-lg p-3 space-y-2.5">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        Video controls
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] text-muted-foreground">
                            Duration ({videoDuration}s)
                          </label>
                          <div className="flex gap-1">
                            {VIDEO_DURATIONS.map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setVideoDuration(d)}
                                className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                                  videoDuration === d
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                                }`}
                              >
                                {d}s
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] text-muted-foreground">Resolution</label>
                          <div className="flex gap-1">
                            {VIDEO_RESOLUTIONS.map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setVideoResolution(r)}
                                className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                                  videoResolution === r
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">Camera motion</label>
                        <Select value={cameraPreset} onValueChange={setCameraPreset}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CAMERA_PRESET_OPTIONS.map((p) => (
                              <SelectItem key={p.id || 'none'} value={p.id}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {cameraPreset && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] text-muted-foreground">
                            Camera intensity
                          </label>
                          <div className="flex gap-1">
                            {(['subtle', 'standard', 'pronounced'] as const).map((i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setCameraIntensity(i)}
                                className={`flex-1 text-[10px] py-1 rounded border transition-colors capitalize ${
                                  cameraIntensity === i
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                                }`}
                              >
                                {i}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={videoAudioOn}
                          onChange={(e) => setVideoAudioOn(e.target.checked)}
                          className="accent-primary"
                        />
                        Generate audio (only used by models that support it — Seedance, Veo 3)
                      </label>
                    </div>
                  )}

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
                        videoNeedsImage
                          ? 'Pick Seedance, or set a reference image first'
                          : undefined
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
                          durationSec: videoDuration,
                          resolution: videoResolution,
                          cameraPreset: cameraPreset || undefined,
                          cameraIntensity: cameraPreset ? cameraIntensity : undefined,
                          audioOn: videoAudioOn,
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
                    Up to {MAX_CONCURRENT_GENS} generations run in parallel. Each run auto-saves as
                    a draft and stays in your queue across reloads.
                  </p>
                </>
              )}

              {/* Voice (TTS + SFX) */}
              {mode === 'voice' && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1">
                    {(['tts', 'sfx'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setVoiceMode(m)}
                        className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                          voiceMode === m
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                        }`}
                      >
                        {m === 'tts' ? 'Text-to-Speech' : 'Sound Effect'}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      voiceMode === 'tts'
                        ? 'Type the line to speak — full sentences work best'
                        : 'Describe the sound — e.g. "thunder crack with low rumble"'
                    }
                    rows={3}
                    className="resize-none"
                  />
                  {voiceMode === 'tts' && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Voice</label>
                      {Array.isArray(voicesList) && voicesList.length === 0 ? (
                        <p className="text-[11px] text-destructive">
                          No voices available — ElevenLabs is not configured on the server. Set
                          ELEVENLABS_API_KEY to enable TTS.
                        </p>
                      ) : (
                        <Select value={voiceId} onValueChange={setVoiceId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Loading voices…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(voicesList ?? []).map((v: any) => {
                              const id = v.voice_id || v.id;
                              const label = v.name || id;
                              return (
                                <SelectItem key={id} value={id}>
                                  {label}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                  {voiceMode === 'sfx' && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">
                        Duration {sfxDuration}s
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={22}
                        step={1}
                        value={sfxDuration}
                        onChange={(e) => setSfxDuration(Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                    </div>
                  )}
                  <Button
                    disabled={!prompt.trim() || (voiceMode === 'tts' && !voiceId)}
                    onClick={() => {
                      if (checkConcurrency(1) === 0) return;
                      runVoiceGen(prompt, {
                        voiceId,
                        flavor: voiceMode,
                        sfxDurationSec: voiceMode === 'sfx' ? sfxDuration : undefined,
                      });
                      setPrompt('');
                    }}
                  >
                    {voiceMode === 'tts' ? 'Synthesize Speech' : 'Generate Sound Effect'}
                  </Button>
                </div>
              )}

              {/* Audio (text→music) */}
              {mode === 'audio' && (
                <div className="flex flex-col gap-3">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the music — e.g. 'epic orchestral battle theme with choir, 120bpm'"
                    rows={3}
                    className="resize-none"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Duration ({audioDuration}s)
                      </label>
                      <input
                        type="range"
                        min={5}
                        max={60}
                        step={1}
                        value={audioDuration}
                        onChange={(e) => setAudioDuration(Number(e.target.value))}
                        className="accent-primary"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Genre (optional)
                      </label>
                      <Input
                        value={audioGenre}
                        onChange={(e) => setAudioGenre(e.target.value)}
                        placeholder="e.g. lo-fi, orchestral, synthwave"
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    disabled={!prompt.trim()}
                    onClick={() => {
                      if (checkConcurrency(1) === 0) return;
                      runAudioGen(prompt, {
                        durationSec: audioDuration,
                        genre: audioGenre.trim() || undefined,
                      });
                      setPrompt('');
                    }}
                  >
                    Generate Music
                  </Button>
                </div>
              )}

              {/* 3D */}
              {mode === '3d' && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1">
                    {(['text', 'image'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setThreedMode(m)}
                        className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                          threedMode === m
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                        }`}
                      >
                        {m === 'text' ? 'Text → 3D' : 'Image → 3D'}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      threedMode === 'text'
                        ? 'Describe the model — e.g. "low-poly viking longboat, weathered wood texture"'
                        : 'Optional prompt to guide the geometry (works without one too)'
                    }
                    rows={3}
                    className="resize-none"
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Art style</label>
                    <Select
                      value={threedArtStyle}
                      onValueChange={(v) => setThreedArtStyle(v as typeof threedArtStyle)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr'] as const).map(
                          (s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  {threedMode === 'image' && (
                    <p className="text-[10px] text-muted-foreground">
                      Drop an image into the queue (right-side drafts panel) or via the dropzone in
                      Image mode, then come back here. The most recent image draft is used as
                      source.
                    </p>
                  )}
                  <Button
                    disabled={
                      !prompt.trim() && threedMode === 'text'
                        ? true
                        : threedMode === 'image' && !drafts?.find((d: any) => d.imageUrl)
                    }
                    onClick={() => {
                      if (checkConcurrency(1) === 0) return;
                      const sourceImg = drafts?.find((d: any) => d.imageUrl)?.imageUrl ?? undefined;
                      run3DGen(prompt, {
                        threedMode,
                        artStyle: threedArtStyle,
                        ...(threedMode === 'image' && sourceImg ? { imageUrl: sourceImg } : {}),
                      });
                      setPrompt('');
                    }}
                  >
                    {threedMode === 'text' ? 'Generate 3D Model' : 'Convert Image → 3D'}
                  </Button>
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    3D generation runs async — the queue card stays "generating" while Meshy works
                    (1-3 min typical). You can keep using other tabs.
                  </p>
                </div>
              )}

              {/* Talking scene */}
              {mode === 'talking' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-muted-foreground">
                    Combine an image + dialogue + voice into a lip-synced clip. Drop the source
                    image in the Image dropzone or pick from your drafts.
                  </p>
                  {referenceImage ? (
                    <div className="flex items-center gap-3 p-2 rounded-lg border border-primary/30 bg-primary/5">
                      <img
                        src={referenceImage.url}
                        alt=""
                        className="h-12 w-12 rounded object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">Talking source</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {referenceImage.url}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setReferenceImage(null)}
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
                      <Upload className="h-3.5 w-3.5" />
                      <span>Drop or click to add a portrait image</span>
                      <input
                        ref={refFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAsset(f, 'animate');
                          e.target.value = '';
                        }}
                      />
                    </div>
                  )}
                  <Textarea
                    value={talkingDialogue}
                    onChange={(e) => setTalkingDialogue(e.target.value)}
                    placeholder='What the character says — e.g. "I have been waiting for you, traveler."'
                    rows={3}
                    className="resize-none"
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Voice</label>
                    {Array.isArray(voicesList) && voicesList.length === 0 ? (
                      <p className="text-[11px] text-destructive">
                        No voices available — ElevenLabs is not configured on the server.
                      </p>
                    ) : (
                      <Select value={voiceId} onValueChange={setVoiceId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Loading voices…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(voicesList ?? []).map((v: any) => {
                            const id = v.voice_id || v.id;
                            return (
                              <SelectItem key={id} value={id}>
                                {v.name || id}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <Input
                    value={talkingMotion}
                    onChange={(e) => setTalkingMotion(e.target.value)}
                    placeholder="Optional motion direction (subtle nod, looking left, etc.)"
                    className="h-9 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">
                      Duration {talkingDuration}s
                    </label>
                    <input
                      type="range"
                      min={3}
                      max={10}
                      step={1}
                      value={talkingDuration}
                      onChange={(e) => setTalkingDuration(Number(e.target.value))}
                      className="flex-1 accent-primary"
                    />
                  </div>
                  <Button
                    disabled={!referenceImage?.url || !talkingDialogue.trim() || !voiceId}
                    onClick={() => {
                      if (!referenceImage?.url) return;
                      if (checkConcurrency(1) === 0) return;
                      runTalkingScene({
                        imageUrl: referenceImage.url,
                        dialogue: talkingDialogue,
                        voiceId,
                        motionPrompt: talkingMotion.trim() || undefined,
                        durationSec: talkingDuration,
                      });
                      setTalkingDialogue('');
                      setTalkingMotion('');
                      setReferenceImage(null);
                    }}
                  >
                    Generate Talking Scene
                  </Button>
                </div>
              )}

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
                      onVoiceModified={(newUrl, newId, label) =>
                        handleVoiceModified(g, newUrl, newId, label)
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: drafts */}
            <div className="flex flex-col gap-4">
              {/* Target chain — where items will live once promoted/minted */}
              {SUPPORTED_CHAINS.length > 1 && (
                <Card>
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Globe className="h-3 w-3" />
                      Target chain
                    </div>
                    <Select value={targetChainId} onValueChange={setTargetChainId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select chain" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_CHAINS.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {targetChainSelection.kind === 'solana'
                        ? 'Saved generations stamp this chain; minting lands on Solana.'
                        : 'Saved generations stamp this chain; minting lands on EVM.'}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Auto-send setting: fire-and-forget promotion after each generation */}
              <Card>
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Rocket className="h-3 w-3" />
                    Auto-send generations
                  </div>
                  <Select value={autoSendTarget} onValueChange={setAutoSendTarget}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__off__" className="text-xs">
                        Off — save to drafts only
                      </SelectItem>
                      <SelectItem value="__gallery__" className="text-xs">
                        My Gallery (no universe)
                      </SelectItem>
                      {autoSendUniverses.length > 0 && (
                        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          Your universes
                        </div>
                      )}
                      {autoSendUniverses.map((u: any) => (
                        <SelectItem key={u.id} value={u.id} className="text-xs">
                          {u.name || u.id.slice(0, 12)}
                          {u.isMultiSig ? ' (multi-sig)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {autoSendTarget !== '__off__' && (
                    <>
                      <div className="pt-1">
                        <div className="text-[10px] text-muted-foreground mb-1">Rights</div>
                        <div className="flex gap-1">
                          {(['fan', 'original', 'licensed'] as const).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setAutoSendClassification(c)}
                              className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                                autoSendClassification === c
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                              }`}
                            >
                              {c.charAt(0).toUpperCase() + c.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-1">
                        <div className="text-[10px] text-muted-foreground mb-1">Visibility</div>
                        <Select
                          value={autoSendVisibility}
                          onValueChange={(v) =>
                            setAutoSendVisibility(v as typeof autoSendVisibility)
                          }
                        >
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
                      </div>

                      {autoSendClassification === 'licensed' && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-snug">
                          Licensed content enters pending review before it appears publicly.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-semibold">Your Drafts</h2>
                {drafts && drafts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: 'all' as const, label: 'All' },
                      { id: 'image' as const, label: 'Image' },
                      { id: 'video' as const, label: 'Video' },
                      { id: 'audio' as const, label: 'Audio' },
                      { id: '3d-model' as const, label: '3D' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setDraftFilter(f.id)}
                        className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                          draftFilter === f.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

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
                (() => {
                  const filtered = (drafts as DraftData[]).filter(
                    (d) => draftFilter === 'all' || inferDraftKind(d) === draftFilter
                  );
                  if (filtered.length === 0) {
                    return (
                      <Card>
                        <CardContent className="py-8 flex flex-col items-center gap-2 text-center">
                          <Wand2 className="h-6 w-6 text-muted-foreground/40" />
                          <p className="text-muted-foreground text-xs">
                            No {draftFilter} drafts yet.
                          </p>
                        </CardContent>
                      </Card>
                    );
                  }
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      {filtered.map((draft) => (
                        <DraftCard
                          key={draft.id}
                          draft={draft}
                          onDelete={() => delDraftMutation.mutate(draft.id)}
                          onReuse={() => {
                            const kind = inferDraftKind(draft);
                            // Switch to the right tab so the form matches the kind
                            if (kind === 'audio') setMode('voice');
                            else if (kind === '3d-model') setMode('3d');
                            else if (kind === 'video') setMode('video');
                            else setMode('image');
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
                  );
                })()
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
