/**
 * EditCanvasShell — the /studio/edit/$assetId page body.
 *
 * Composition:
 *   left column   — InpaintCanvas (existing brush/polygon mask UI) +
 *                   prompt/mode controls + Run button + SubmitPreview
 *   right column  — AssetInspector + HistoryPanel
 *
 * All server-side work (openSession / uploadMask / runInpaint / submitJob)
 * is funnelled through `useEditSession`. This component just handles UI
 * state + wiring.
 */

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { InpaintCanvas, type InpaintCanvasHandle } from '@/components/editing/InpaintCanvas';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { useEditSession } from '@/hooks/useEditSession';
import { AssetInspector } from './AssetInspector';
import { HistoryPanel } from './HistoryPanel';
import { SubmitPreview } from './SubmitPreview';

type Mode = 'replace' | 'remove' | 'add' | 'fix';

const MODE_OPTIONS: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'replace', label: 'Replace', hint: 'Swap the masked region for something new' },
  { id: 'remove', label: 'Remove', hint: 'Erase the masked region seamlessly' },
  { id: 'add', label: 'Add', hint: 'Paint in a new object inside the mask' },
  { id: 'fix', label: 'Fix', hint: 'Repair anatomy or artifacts inside the mask' },
];

export function EditCanvasShell({ assetId }: { assetId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canvasRef = useRef<InpaintCanvasHandle>(null);

  const [mode, setMode] = useState<Mode>('replace');
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [preview, setPreview] = useState<{
    jobId: string;
    beforeUrl: string;
    afterUrl: string;
  } | null>(null);
  const [isKeeping, setIsKeeping] = useState(false);

  const contentQuery = useQuery({
    queryKey: ['content', 'get', assetId],
    queryFn: () => trpcClient.content.get.query({ id: assetId }),
    staleTime: 30_000,
  });

  const versionsQuery = useQuery({
    queryKey: ['editJobs', 'listVersions', assetId],
    queryFn: () => trpcClient.editJobs.listVersions.query({ contentId: assetId }),
    staleTime: 5_000,
  });

  const session = useEditSession(assetId);
  const baseVersion = session.baseVersion;
  const content = contentQuery.data;

  async function handleRun() {
    if (!canvasRef.current?.hasMask()) {
      toast.error('Paint a mask first');
      return;
    }
    if (mode === 'replace' && !prompt.trim()) {
      toast.error('Replace mode needs a prompt describing the fill');
      return;
    }
    const maskBlob = await canvasRef.current.exportMaskBlob();
    if (!maskBlob) {
      toast.error('Could not export mask');
      return;
    }
    setIsRunning(true);
    try {
      const pngBase64 = await blobToBase64(maskBlob);
      const { maskId } = await session.uploadMask(pngBase64);
      const job = await session.runInpaint({ maskId, prompt, mode });
      if (!baseVersion) throw new Error('No base version');
      setPreview({
        jobId: job.jobId,
        beforeUrl: baseVersion.mediaUrl,
        afterUrl: job.outputUrl,
      });
    } catch (err: any) {
      toast.error(err?.message || 'Edit failed');
    } finally {
      setIsRunning(false);
    }
  }

  async function handleKeep(label: string) {
    if (!preview) return;
    setIsKeeping(true);
    try {
      await session.submitJob({ jobId: preview.jobId, label });
      toast.success('New version saved');
      setPreview(null);
      setPrompt('');
      canvasRef.current?.clear();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['editJobs', 'listVersions', assetId] }),
        qc.invalidateQueries({ queryKey: ['content', 'get', assetId] }),
      ]);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save version');
    } finally {
      setIsKeeping(false);
    }
  }

  if (contentQuery.isLoading || session.isOpening) {
    return (
      <div className="flex items-center justify-center h-96 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening edit session…
      </div>
    );
  }

  if (!content) {
    return (
      <div className="max-w-md mx-auto mt-24 space-y-4 text-center">
        <h2 className="text-lg font-medium">Asset not found</h2>
        <p className="text-sm text-muted-foreground">
          This asset may have been removed, or you don't have access to edit it.
        </p>
        <Button onClick={() => navigate({ to: '/gallery' })}>Back to gallery</Button>
      </div>
    );
  }

  const mediaUrl = baseVersion?.mediaUrl ?? content.mediaUrl;
  const isImage = (baseVersion?.mediaType ?? content.mediaType).includes('image');

  return (
    <div className="container mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/gallery' })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">Edit — {content.title}</h1>
          <p className="text-sm text-muted-foreground">
            Paint a region, describe the change, and every edit becomes a traceable new version.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* LEFT — canvas + controls + preview */}
        <div className="space-y-4">
          {isImage ? (
            <Card>
              <CardContent className="p-3">
                <InpaintCanvas
                  ref={canvasRef}
                  imageUrl={mediaUrl}
                  onMaskChange={() => {}}
                  width={960}
                  height={540}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Video assets will support frame-capture editing in the next release. For now, open
                an image asset to use the canvas.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {MODE_OPTIONS.map((m) => (
                  <Button
                    key={m.id}
                    variant={mode === m.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground ml-auto self-center">
                  {MODE_OPTIONS.find((o) => o.id === mode)?.hint}
                </span>
              </div>
              <Textarea
                placeholder={
                  mode === 'remove'
                    ? 'Optional: describe what the empty area should look like'
                    : 'Describe what should go in the masked region…'
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="text-sm"
              />
              <Button
                onClick={handleRun}
                disabled={isRunning || !isImage || !session.sessionId}
                className="w-full"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Running edit…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    Run edit
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {preview && (
            <SubmitPreview
              beforeUrl={preview.beforeUrl}
              afterUrl={preview.afterUrl}
              onKeep={handleKeep}
              onDiscard={() => setPreview(null)}
              isKeeping={isKeeping}
            />
          )}
        </div>

        {/* RIGHT — inspector + history */}
        <div className="space-y-4">
          <AssetInspector
            content={content as any}
            baseVersion={baseVersion}
            versionCount={versionsQuery.data?.versions.length ?? 0}
          />
          <HistoryPanel contentId={assetId} />
        </div>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
