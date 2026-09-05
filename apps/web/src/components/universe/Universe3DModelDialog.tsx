/**
 * Universe3DModelDialog
 *
 * Lets a creator generate a 3D model (GLB) without leaving the universe
 * timeline editor. Wraps the existing `threed.*` tRPC pipeline (Meshy
 * text-to-3D preview + image-to-3D) and polls for completion. The universe
 * id is threaded through to the mutation so the server's `completeThreeDTask`
 * publishes the finished model to the universe gallery — it then shows up in
 * the Wiki → 3D Models tab automatically. No new persistence path here.
 *
 * Generation runs server-side for several minutes; the creator can close the
 * dialog and the model still lands in the wiki when it finishes.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, ImagePlus, Box, RotateCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { requireProviderKey } from '@/lib/apiKeyGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ModelViewer } from '@/components/ModelViewer';

interface Universe3DModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Universe id or address — scopes the generated model to this universe's gallery. */
  universeId: string;
}

type Status = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

const ART_STYLES = ['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr'] as const;
type ArtStyle = (typeof ART_STYLES)[number];

export function Universe3DModelDialog({
  open,
  onOpenChange,
  universeId,
}: Universe3DModelDialogProps) {
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'text' | 'image'>('text');

  const [textPrompt, setTextPrompt] = useState('');
  const [artStyle, setArtStyle] = useState<ArtStyle>('realistic');
  const [imageUrl, setImageUrl] = useState('');

  const [status, setStatus] = useState<Status>('idle');
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
    setPreviewGlbUrl(null);
    setPreviewThumb(null);
    setFailureReason(null);
  }

  /** The gallery publish is fire-and-forget on the server and can land a
   *  moment after the task flips to `completed`, so nudge the wiki list a
   *  few times rather than once. */
  function refreshWikiGallery() {
    const key = ['wiki', '3d-gallery', universeId];
    void queryClient.invalidateQueries({ queryKey: key });
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: key }), 4000);
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: key }), 12000);
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
        universeId,
      });
      setStatus(result.status === 'failed' ? 'failed' : 'running');
      pollStartRef.current = Date.now();
      pollNext(result.generationId);
    } catch (err) {
      if (await maybeGateProviderKey(err, startTextTo3D)) return;
      setStatus('failed');
      setFailureReason(err instanceof Error ? err.message : 'Generation failed');
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    }
  }

  async function startImageTo3D() {
    if (!imageUrl.trim()) {
      toast.error('Paste a public reference image URL first');
      return;
    }
    reset();
    setStatus('queued');
    try {
      const result = await trpcClient.threed.imageTo3D.mutate({
        imageUrls: [imageUrl.trim()],
        enablePbr: true,
        universeId,
      });
      setStatus(result.status === 'failed' ? 'failed' : 'running');
      pollStartRef.current = Date.now();
      pollNext(result.generationId);
    } catch (err) {
      if (await maybeGateProviderKey(err, startImageTo3D)) return;
      setStatus('failed');
      setFailureReason(err instanceof Error ? err.message : 'Generation failed');
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    }
  }

  /** 3D generation is BYOK-only (Meshy). On a `byokRequired` error, pop the
   *  "connect your key" modal and retry once. Returns true if it handled the
   *  error (caller should stop). */
  async function maybeGateProviderKey(err: unknown, retry: () => void): Promise<boolean> {
    const provider = (err as any)?.data?.byokRequired
      ? ((err as any).data.provider as string)
      : undefined;
    if (!provider) return false;
    setStatus('idle');
    const saved = await requireProviderKey(provider, {
      reason: err instanceof Error ? err.message : undefined,
    });
    if (saved) retry();
    return true;
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
        refreshWikiGallery();
        toast.success('3D model saved to this universe — see Wiki → 3D Models');
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-violet-500" />
            Create a 3D model
          </DialogTitle>
          <DialogDescription>
            Generate a GLB from a prompt or a reference image. It's added to this universe's Wiki →
            3D Models when it finishes (~5 min) — you can close this in the meantime.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'text' | 'image')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text" disabled={isBusy}>
                <Sparkles className="mr-2 h-4 w-4" />
                From text
              </TabsTrigger>
              <TabsTrigger value="image" disabled={isBusy}>
                <ImagePlus className="mr-2 h-4 w-4" />
                From image
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-3 pt-3">
              <div>
                <Label htmlFor="u3d-prompt">3D model prompt</Label>
                <Textarea
                  id="u3d-prompt"
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  placeholder="e.g. A weathered brass diving helmet with cracked glass, ornate rivets"
                  rows={3}
                  disabled={isBusy}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {ART_STYLES.map((s) => (
                  <Badge
                    key={s}
                    variant={artStyle === s ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => !isBusy && setArtStyle(s)}
                  >
                    {s}
                  </Badge>
                ))}
              </div>
              <Button onClick={startTextTo3D} disabled={isBusy} className="w-full">
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
                <Label htmlFor="u3d-image-url">Reference image URL</Label>
                <Input
                  id="u3d-image-url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://… (must be a public URL; a clean single-object shot works best)"
                  disabled={isBusy}
                />
              </div>
              <Button onClick={startImageTo3D} disabled={isBusy} className="w-full">
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

          {isBusy && (
            <p className="text-xs text-muted-foreground">
              Meshy is working on it. You can close this dialog — the model keeps generating and
              appears in Wiki → 3D Models when done.
            </p>
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
                <Link
                  to="/wiki"
                  search={{ universe: universeId, tab: '3d-models' }}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in Wiki → 3D Models
                </Link>
                <Button variant="ghost" size="sm" onClick={reset}>
                  Generate another
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
