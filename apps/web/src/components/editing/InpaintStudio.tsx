/**
 * InpaintStudio
 *
 * Dedicated inpaint / remove / replace / generative-fill studio.
 * - Brush or polygon mask selection
 * - Action modes: replace / remove / add / fix (each applies tuned prompt)
 * - Prompt + negative prompt + seed locking
 * - Mask uploaded to storage so FAL gets a real URL (not a fat base64 body)
 * - Auto-publishes results to the user's gallery
 * - Version history: re-run the same mask with different prompts
 *
 * All compute is server-side via `editing.inpaint`.
 */

import { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { InpaintCanvas, type InpaintCanvasHandle } from './InpaintCanvas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  Eraser,
  Wand2,
  Plus,
  Wrench,
  Lock,
  LockOpen,
  Download,
  History,
  Dice5,
  Camera,
  Film,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InpaintMode } from '@/hooks/useVideoEditing';

interface InpaintStudioProps {
  sourceImageUrl: string;
  sourceGenerationId?: string;
  universeId?: string;
  onResult?: (imageUrl: string) => void;
}

const MODE_CONFIG: Record<
  InpaintMode,
  {
    label: string;
    icon: React.ReactNode;
    color: string;
    description: string;
    promptPlaceholder: string;
    promptRequired: boolean;
  }
> = {
  replace: {
    label: 'Replace',
    icon: <Wand2 className="h-3.5 w-3.5" />,
    color: 'text-purple-400',
    description: 'Paint a region and describe what should replace it.',
    promptPlaceholder: 'A red vintage sports car, photorealistic, golden hour light…',
    promptRequired: true,
  },
  remove: {
    label: 'Remove',
    icon: <Eraser className="h-3.5 w-3.5" />,
    color: 'text-red-400',
    description: 'Paint an object to erase — model inpaints a clean plate.',
    promptPlaceholder: 'Optional: hint about what the background should look like',
    promptRequired: false,
  },
  add: {
    label: 'Add',
    icon: <Plus className="h-3.5 w-3.5" />,
    color: 'text-green-400',
    description: 'Paint an empty area and describe what to add.',
    promptPlaceholder: 'A coffee cup on the desk, steam rising, warm lighting…',
    promptRequired: true,
  },
  fix: {
    label: 'Fix Details',
    icon: <Wrench className="h-3.5 w-3.5" />,
    color: 'text-cyan-400',
    description: 'Paint a distorted region (hands, faces) to regenerate cleanly.',
    promptPlaceholder: 'Optional: what this region should look like',
    promptRequired: false,
  },
};

// Client-side blob cap. The `/api/upload` endpoint enforces a stricter server
// limit (10MB masks, 15MB frames); this pre-check keeps the user from spending
// seconds uploading a 400MB canvas only to be rejected — and prevents the
// browser from blowing through memory while building the form body.
const CLIENT_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

async function uploadBlob(blob: Blob, filename: string): Promise<string> {
  if (blob.size === 0) throw new Error('Upload payload is empty');
  if (blob.size > CLIENT_UPLOAD_MAX_BYTES) {
    throw new Error(`Upload exceeds ${(CLIENT_UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(0)}MB limit`);
  }
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await fetch(`${import.meta.env.VITE_SERVER_URL || ''}/api/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed: ${text}`);
  }
  const data = (await res.json()) as { manifest: { uploads: { url: string }[] } };
  const url = data.manifest?.uploads?.[0]?.url;
  if (!url) throw new Error('Upload returned no URL');
  return url;
}

// Strip internal-sounding bits (stack traces, provider names) from server error
// messages before showing them in a toast. Keeps the signal — "upload failed",
// "insufficient credits" — without leaking operational details.
function toastableError(err: unknown, fallback = 'Something went wrong'): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);
  if (!raw || raw === 'undefined') return fallback;
  return raw
    .replace(/\bFAL\b/gi, 'provider')
    .replace(/\bGoogle\b/gi, 'provider')
    .replace(/\bElevenLabs\b/gi, 'provider')
    .replace(/\bImagen\b/gi, 'provider')
    .replace(/\bFlux\b/gi, 'model')
    .replace(/\bat .*\.ts:\d+:\d+/g, '') // strip stack locations if any leaked
    .slice(0, 240)
    .trim();
}

const uploadMask = (blob: Blob) => uploadBlob(blob, `inpaint-mask-${Date.now()}.png`);

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(lower);
}

// ── Video frame picker ────────────────────────────────────────────────

function FramePicker({
  videoUrl,
  onCaptured,
}: {
  videoUrl: string;
  onCaptured: (frameUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      toast.error('Video not loaded yet');
      return;
    }
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob((b) => r(b), 'image/png'));
      if (!blob) throw new Error('Frame export failed');
      if (blob.size > CLIENT_UPLOAD_MAX_BYTES) {
        throw new Error(
          'Captured frame is too large — try a shorter video or lower resolution source'
        );
      }
      const url = await uploadBlob(blob, `frame-${Date.now()}.png`);
      onCaptured(url);
      toast.success('Frame captured');
    } catch (err: unknown) {
      toast.error(toastableError(err, 'Capture failed'));
    } finally {
      setCapturing(false);
    }
  }, [onCaptured]);

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-medium">Pick a frame to edit</span>
        <Badge variant="secondary" className="text-[10px]">
          Video source
        </Badge>
      </div>
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        crossOrigin="anonymous"
        className="w-full rounded border border-border/40 max-h-[420px]"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />
      <div className="flex items-center gap-3">
        <Slider
          value={[currentTime]}
          onValueChange={([v]) => {
            if (videoRef.current) videoRef.current.currentTime = v;
          }}
          min={0}
          max={duration || 0}
          step={0.01}
          className="flex-1"
          disabled={!duration}
        />
        <span className="text-[10px] text-muted-foreground font-mono min-w-[70px] text-right">
          {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
        </span>
      </div>
      <Button onClick={handleCapture} disabled={capturing || !duration} className="w-full">
        {capturing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Capturing…
          </>
        ) : (
          <>
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            Use this frame
          </>
        )}
      </Button>
    </Card>
  );
}

export function InpaintStudio({
  sourceImageUrl,
  sourceGenerationId,
  universeId,
  onResult,
}: InpaintStudioProps) {
  const queryClient = useQueryClient();
  const canvasRef = useRef<InpaintCanvasHandle>(null);

  // If the caller passes a video URL, we first let the user pick a frame,
  // then the captured frame URL becomes the active source for the canvas.
  const [activeSrc, setActiveSrc] = useState<string>(sourceImageUrl);
  useEffect(() => {
    setActiveSrc(sourceImageUrl);
  }, [sourceImageUrl]);
  const sourceIsVideo = isVideoUrl(activeSrc);

  const [mode, setMode] = useState<InpaintMode>('replace');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<string>('');
  const [seedLocked, setSeedLocked] = useState(false);
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [maskReady, setMaskReady] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [lastSeed, setLastSeed] = useState<number | null>(null);

  // Editing history filtered to inpaint jobs from this source
  const historyQuery = useQuery({
    queryKey: ['editing', 'history', 'inpaint', sourceGenerationId ?? sourceImageUrl],
    queryFn: () => trpcClient.editing.history.query({ operation: 'inpaint', limit: 30 }),
    staleTime: 15_000,
  });

  const relevantHistory = useMemo(() => {
    const jobs = historyQuery.data?.jobs ?? [];
    if (sourceGenerationId) {
      return jobs.filter((j: any) => j.sourceGenerationId === sourceGenerationId);
    }
    return jobs.filter((j: any) => j.inputUrl === sourceImageUrl);
  }, [historyQuery.data, sourceGenerationId, sourceImageUrl]);

  const modelsQuery = useQuery({
    queryKey: ['editing', 'models', 'inpaint'],
    queryFn: () => trpcClient.editing.listModels.query({ operation: 'inpaint' }),
    staleTime: 5 * 60_000,
  });

  const [modelId, setModelId] = useState<string | undefined>(undefined);
  // Auto-prefer the lama eraser for Remove mode when the user hasn't pinned a model
  const autoModelId = useMemo(() => {
    if (modelId) return modelId;
    const models = modelsQuery.data ?? [];
    if (mode === 'remove') {
      const eraser = models.find((m: any) => m.tags?.includes('erase'));
      if (eraser) return eraser.id;
    }
    return models.find((m: any) => !m.tags?.includes('erase'))?.id || models[0]?.id;
  }, [modelId, mode, modelsQuery.data]);
  const effectiveModelId = autoModelId || 'inpaint-flux';
  const selectedModel = modelsQuery.data?.find((m: any) => m.id === effectiveModelId);
  const isEraserModel = !!selectedModel?.tags?.includes('erase');

  const runInpaint = useMutation({
    mutationFn: async () => {
      const handle = canvasRef.current;
      if (!handle) throw new Error('Canvas not ready');

      const modeConfig = MODE_CONFIG[mode];
      // Eraser models don't need a prompt, overriding the mode-level requirement
      if (!isEraserModel && modeConfig.promptRequired && !prompt.trim()) {
        throw new Error(`${modeConfig.label} mode requires a prompt`);
      }

      const maskBlob = await handle.exportMaskBlob();
      if (!maskBlob) throw new Error('Paint a mask before running');

      const maskUrl = await uploadMask(maskBlob);

      const seedNum = seed.trim() ? Number.parseInt(seed, 10) : undefined;
      if (seed.trim() && (!Number.isFinite(seedNum) || seedNum! < 0)) {
        throw new Error('Seed must be a non-negative integer');
      }

      return trpcClient.editing.inpaint.mutate({
        imageUrl: activeSrc,
        maskUrl,
        prompt: prompt.trim(),
        mode,
        modelId: effectiveModelId,
        negativePrompt: negativePrompt.trim() || undefined,
        seed: seedNum,
        guidanceScale,
        sourceGenerationId,
        universeId,
        publishToGallery: true,
      });
    },
    onSuccess: (data) => {
      setResultUrl(data.imageUrl);
      if (typeof data.seed === 'number') {
        setLastSeed(data.seed);
        if (seedLocked && !seed.trim()) setSeed(String(data.seed));
      }
      onResult?.(data.imageUrl);
      queryClient.invalidateQueries({ queryKey: ['editing', 'history'] });
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      toast.success(`${MODE_CONFIG[mode].label} complete`);
    },
    onError: (err: unknown) => toast.error(toastableError(err, 'Inpaint failed')),
  });

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `inpaint-${mode}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      toast.error('Download failed');
    }
  }, [resultUrl, mode]);

  const handleRandomizeSeed = useCallback(() => {
    setSeed(String(Math.floor(Math.random() * 1_000_000_000)));
    setSeedLocked(true);
  }, []);

  const modeConfig = MODE_CONFIG[mode];
  const creditCost = selectedModel?.creditCost ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* ── Canvas + result ──────────────────────────────────────────── */}
      <div className="space-y-4">
        {sourceIsVideo ? (
          <FramePicker videoUrl={activeSrc} onCaptured={(url) => setActiveSrc(url)} />
        ) : (
          <Card className="p-3">
            <InpaintCanvas
              ref={canvasRef}
              imageUrl={activeSrc}
              onMaskChange={(m) => setMaskReady(!!m)}
              width={720}
              height={480}
            />
          </Card>
        )}

        {resultUrl && (
          <Card className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-[10px]">
                  Result
                </Badge>
                {typeof lastSeed === 'number' && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    seed {lastSeed}
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download
                </Button>
              </div>
            </div>
            <img
              src={resultUrl}
              alt="Inpaint result"
              loading="lazy"
              decoding="async"
              className="w-full rounded"
            />
          </Card>
        )}
      </div>

      {/* ── Controls sidebar ─────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Action mode selector */}
        <Card className="p-3">
          <div className="mb-2 text-xs font-medium">Action</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(MODE_CONFIG) as InpaintMode[]).map((m) => {
              const cfg = MODE_CONFIG[m];
              const active = mode === m;
              return (
                <Button
                  key={m}
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  className={cn('justify-start h-auto py-2', active && 'ring-1 ring-primary/40')}
                  onClick={() => setMode(m)}
                >
                  <span className={cn('mr-1.5', !active && cfg.color)}>{cfg.icon}</span>
                  <span className="text-xs">{cfg.label}</span>
                </Button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{modeConfig.description}</p>
        </Card>

        {/* Prompt */}
        <Card className="p-3 space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">
              Prompt{' '}
              {modeConfig.promptRequired && !isEraserModel && (
                <span className="text-red-400">*</span>
              )}
              {isEraserModel && (
                <span className="text-[10px] text-muted-foreground font-normal ml-1">
                  (ignored by eraser model)
                </span>
              )}
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                isEraserModel
                  ? 'Eraser mode fills with surrounding texture — no prompt needed'
                  : modeConfig.promptPlaceholder
              }
              className="text-xs min-h-[68px]"
              disabled={isEraserModel}
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block text-muted-foreground">
              Negative prompt
            </label>
            <Input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Things to avoid…"
              className="h-8 text-xs"
            />
          </div>

          {/* Seed lock */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium">Seed</label>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5"
                  onClick={handleRandomizeSeed}
                  title="Generate random seed"
                >
                  <Dice5 className="h-3 w-3" />
                </Button>
                <Button
                  variant={seedLocked ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-1.5"
                  onClick={() => setSeedLocked((v) => !v)}
                  title={seedLocked ? 'Seed locked' : 'Seed free'}
                >
                  {seedLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                </Button>
              </div>
            </div>
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder={seedLocked ? 'Locked — re-used across runs' : 'Random each run'}
              className="h-8 text-xs font-mono"
              disabled={!seedLocked && !seed}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Lock to reproduce the same fill on re-runs. Click the die for a random seed.
            </p>
          </div>

          {/* Guidance scale */}
          <div>
            <label className="text-xs font-medium mb-1 block">
              Guidance <span className="text-muted-foreground">({guidanceScale.toFixed(1)})</span>
            </label>
            <Slider
              value={[guidanceScale]}
              onValueChange={([v]) => setGuidanceScale(v)}
              min={1}
              max={20}
              step={0.5}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>Creative</span>
              <span>Prompt-adherent</span>
            </div>
          </div>

          {/* Model selector */}
          {(modelsQuery.data?.length ?? 0) > 1 && (
            <div>
              <label className="text-xs font-medium mb-1 block">Model</label>
              <Select value={effectiveModelId} onValueChange={setModelId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelsQuery.data?.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}{' '}
                      <span className="text-[10px] text-muted-foreground ml-1">
                        {m.creditCost} cr
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Execute */}
          <Button
            className="w-full"
            disabled={runInpaint.isPending || !maskReady || sourceIsVideo}
            onClick={() => runInpaint.mutate()}
          >
            {runInpaint.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {modeConfig.label} · {creditCost} cr
              </>
            )}
          </Button>
          {sourceIsVideo && (
            <p className="text-[11px] text-amber-500 text-center">
              Capture a frame above to continue
            </p>
          )}
          {!sourceIsVideo && !maskReady && (
            <p className="text-[11px] text-amber-500 text-center">Paint a mask to continue</p>
          )}
        </Card>

        {/* Version history */}
        {relevantHistory.length > 0 && (
          <Card className="p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              Runs on this image
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {relevantHistory.map((j: any) => (
                <button
                  key={j.id}
                  onClick={() => {
                    if (j.outputUrl) setResultUrl(j.outputUrl);
                    if (j.prompt) setPrompt(j.prompt);
                  }}
                  className="w-full flex gap-2 p-1.5 rounded hover:bg-muted/10 text-left"
                >
                  {j.outputUrl ? (
                    <img
                      src={resolveIpfsUrl(j.outputUrl)}
                      alt=""
                      className="w-10 h-10 rounded object-cover shrink-0"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-muted/20 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <Badge
                        variant={j.status === 'completed' ? 'secondary' : 'destructive'}
                        className="text-[9px] px-1 py-0"
                      >
                        {j.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {j.operation}
                      </span>
                    </div>
                    <p className="text-[10px] truncate text-muted-foreground">
                      {j.prompt || '(no prompt)'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
