/**
 * PersonaMeshy3DGenerator
 *
 * Embedded sub-flow for generating a 3D model from text or image during
 * persona creation/editing. Wraps the existing `threed.*` tRPC endpoints
 * (text-to-3D preview, text-to-3D refine, image-to-3D) and polls for task
 * completion. On success, hands the GLB URL + generationId back to the
 * parent form via `onGenerated`.
 *
 * Live preview during generation is rendered via the existing <ModelViewer />
 * once the task completes. Mid-generation we show a poster image + spinner.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, ImagePlus, Box, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ModelViewer } from '@/components/ModelViewer';

interface Generation3DResult {
  generationId: string;
  glbUrl: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
}

interface PersonaMeshy3DGeneratorProps {
  /** Called when a generation completes successfully. */
  onGenerated: (result: Generation3DResult) => void;
  /** Reference image URL when generating from a likeness/face. Pre-fills image tab. */
  initialImageUrl?: string | null;
  /** Disable controls while parent is submitting. */
  disabled?: boolean;
}

type Status = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

export function PersonaMeshy3DGenerator({
  onGenerated,
  initialImageUrl,
  disabled,
}: PersonaMeshy3DGeneratorProps) {
  const [tab, setTab] = useState<'text' | 'image'>(initialImageUrl ? 'image' : 'text');

  // Text-to-3D state
  const [textPrompt, setTextPrompt] = useState('');
  const [artStyle, setArtStyle] = useState<
    'realistic' | 'cartoon' | 'low-poly' | 'sculpture' | 'pbr'
  >('realistic');

  // Image-to-3D state
  const [imageUrl, setImageUrl] = useState(initialImageUrl ?? '');

  // Shared generation state
  const [status, setStatus] = useState<Status>('idle');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [previewGlbUrl, setPreviewGlbUrl] = useState<string | null>(null);
  const [previewThumb, setPreviewThumb] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(0);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    []
  );

  const isBusy = status === 'queued' || status === 'running';
  const hasResult = status === 'completed' && previewGlbUrl !== null;

  function reset() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setStatus('idle');
    setGenerationId(null);
    setPreviewGlbUrl(null);
    setPreviewThumb(null);
    setFailureReason(null);
  }

  async function startTextTo3D() {
    if (!textPrompt.trim()) {
      toast.error('Describe the 3D model you want to generate');
      return;
    }
    reset();
    setStatus('queued');
    try {
      const result = await trpcClient.threed.textTo3DPreview.mutate({
        prompt: textPrompt,
        artStyle,
      });
      setGenerationId(result.generationId);
      setStatus(result.status === 'failed' ? 'failed' : 'running');
      pollStartRef.current = Date.now();
      pollNext(result.generationId);
    } catch (err) {
      setStatus('failed');
      setFailureReason(err instanceof Error ? err.message : 'Generation failed');
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    }
  }

  async function startImageTo3D() {
    if (!imageUrl.trim()) {
      toast.error('Paste a reference image URL first');
      return;
    }
    reset();
    setStatus('queued');
    try {
      const result = await trpcClient.threed.imageTo3D.mutate({
        imageUrls: [imageUrl],
        enablePbr: true,
      });
      setGenerationId(result.generationId);
      setStatus(result.status === 'failed' ? 'failed' : 'running');
      pollStartRef.current = Date.now();
      pollNext(result.generationId);
    } catch (err) {
      setStatus('failed');
      setFailureReason(err instanceof Error ? err.message : 'Generation failed');
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    }
  }

  function pollNext(genId: string) {
    pollTimer.current = setTimeout(() => void doPoll(genId), POLL_INTERVAL_MS);
  }

  async function doPoll(genId: string) {
    if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
      setStatus('failed');
      setFailureReason('Generation timed out after 12 minutes');
      toast.error('3D generation timed out');
      return;
    }
    try {
      const task = await trpcClient.threed.getTask.query({ generationId: genId });
      if (!task) {
        pollNext(genId);
        return;
      }
      const t = task as {
        status?: Status;
        modelUrls?: { glb?: string };
        thumbnailUrl?: string | null;
        videoUrl?: string | null;
        failureReason?: string | null;
      };
      if (t.status === 'completed' && t.modelUrls?.glb) {
        setStatus('completed');
        setPreviewGlbUrl(t.modelUrls.glb);
        setPreviewThumb(t.thumbnailUrl ?? null);
        onGenerated({
          generationId: genId,
          glbUrl: t.modelUrls.glb,
          thumbnailUrl: t.thumbnailUrl ?? null,
          videoUrl: t.videoUrl ?? null,
        });
        return;
      }
      if (t.status === 'failed') {
        setStatus('failed');
        setFailureReason(t.failureReason ?? 'Generation failed');
        toast.error(t.failureReason ?? 'Generation failed');
        return;
      }
      pollNext(genId);
    } catch (err) {
      setStatus('failed');
      setFailureReason(err instanceof Error ? err.message : 'Polling failed');
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'text' | 'image')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="text" disabled={isBusy || disabled}>
            <Sparkles className="mr-2 h-4 w-4" />
            From text
          </TabsTrigger>
          <TabsTrigger value="image" disabled={isBusy || disabled}>
            <ImagePlus className="mr-2 h-4 w-4" />
            From image
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="space-y-3 pt-3">
          <div>
            <Label htmlFor="meshy-prompt">3D model prompt</Label>
            <Textarea
              id="meshy-prompt"
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              placeholder="e.g. A stylized cyberpunk samurai bust with neon hair, expressive face"
              rows={3}
              disabled={isBusy || disabled}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr'] as const).map((s) => (
              <Badge
                key={s}
                variant={artStyle === s ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => !isBusy && !disabled && setArtStyle(s)}
              >
                {s}
              </Badge>
            ))}
          </div>
          <Button onClick={startTextTo3D} disabled={isBusy || disabled} className="w-full">
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating ({status})…
              </>
            ) : (
              <>
                <Box className="mr-2 h-4 w-4" />
                Generate 3D preview (~$0.05)
              </>
            )}
          </Button>
        </TabsContent>

        <TabsContent value="image" className="space-y-3 pt-3">
          <div>
            <Label htmlFor="meshy-image-url">Reference image URL</Label>
            <Input
              id="meshy-image-url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://… (front-facing portrait works best)"
              disabled={isBusy || disabled}
            />
            {initialImageUrl && imageUrl !== initialImageUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2 text-xs"
                onClick={() => setImageUrl(initialImageUrl)}
              >
                Reset to likeness reference
              </Button>
            )}
          </div>
          <Button onClick={startImageTo3D} disabled={isBusy || disabled} className="w-full">
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating ({status})…
              </>
            ) : (
              <>
                <Box className="mr-2 h-4 w-4" />
                Generate 3D from image (~$0.15)
              </>
            )}
          </Button>
        </TabsContent>
      </Tabs>

      {status === 'failed' && failureReason && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-medium text-destructive">Generation failed</div>
          <div className="mt-1 text-destructive/80">{failureReason}</div>
          <Button variant="outline" size="sm" className="mt-2" onClick={reset}>
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}

      {hasResult && previewGlbUrl && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Generated model</div>
          <div className="overflow-hidden rounded-lg border bg-muted/40">
            <ModelViewer
              src={previewGlbUrl}
              poster={previewThumb ?? undefined}
              alt="Generated 3D model preview"
              className="h-72 w-full"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>generationId: {generationId?.slice(0, 8)}…</span>
            <Button variant="ghost" size="sm" onClick={reset}>
              Generate another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
