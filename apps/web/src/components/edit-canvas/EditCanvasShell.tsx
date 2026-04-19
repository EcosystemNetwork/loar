/**
 * EditCanvasShell — the /studio/edit/$assetId page body.
 *
 * Holds:
 *   - tool tabs (Inpaint / Outpaint / Relight / Retexture)
 *   - video frame capture UI when the asset is a video
 *   - asset inspector + version history on the right
 *   - preview + submit flow shared across all tools
 *
 * Each tool is a panel under [panels/] that calls back into the shell when
 * its job completes, so the preview/submit UX is consistent regardless of
 * which op ran.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, ArrowLeft, Wand2, Expand, Sun, Layers3 } from 'lucide-react';
import { toast } from 'sonner';
import { useEditSession } from '@/hooks/useEditSession';
import { AssetInspector } from './AssetInspector';
import { HistoryPanel } from './HistoryPanel';
import { SubmitPreview } from './SubmitPreview';
import { VideoFrameCapture } from './VideoFrameCapture';
import { InpaintPanel } from './panels/InpaintPanel';
import { OutpaintPanel } from './panels/OutpaintPanel';
import { RelightPanel } from './panels/RelightPanel';
import { RetexturePanel } from './panels/RetexturePanel';

export function EditCanvasShell({ assetId }: { assetId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeTool, setActiveTool] = useState<'inpaint' | 'outpaint' | 'relight' | 'retexture'>(
    'inpaint'
  );
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

  async function handleKeep(label: string) {
    if (!preview) return;
    setIsKeeping(true);
    try {
      await session.submitJob({ jobId: preview.jobId, label });
      toast.success('New version saved');
      setPreview(null);
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

  const mediaType = baseVersion?.mediaType ?? content.mediaType;
  const isVideo = mediaType === 'video' || mediaType === 'ai-video';
  const baseMediaUrl = baseVersion?.mediaUrl ?? content.mediaUrl;
  // For video assets, image ops operate on the captured frame.
  const workingImageUrl = isVideo ? session.capturedFrameUrl : baseMediaUrl;

  return (
    <div className="container mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/gallery' })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">Edit — {content.title}</h1>
          <p className="text-sm text-muted-foreground">
            Paint, reframe, relight, or retexture. Every edit becomes a traceable new version.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* LEFT — tool tabs + preview */}
        <div className="space-y-4">
          {isVideo && <VideoFrameCapture videoUrl={baseMediaUrl} session={session} />}

          <Tabs value={activeTool} onValueChange={(v) => setActiveTool(v as typeof activeTool)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="inpaint" className="gap-1.5">
                <Wand2 className="h-3.5 w-3.5" /> Inpaint
              </TabsTrigger>
              <TabsTrigger value="outpaint" className="gap-1.5">
                <Expand className="h-3.5 w-3.5" /> Outpaint
              </TabsTrigger>
              <TabsTrigger value="relight" className="gap-1.5">
                <Sun className="h-3.5 w-3.5" /> Relight
              </TabsTrigger>
              <TabsTrigger value="retexture" className="gap-1.5">
                <Layers3 className="h-3.5 w-3.5" /> Retexture
              </TabsTrigger>
            </TabsList>

            {isVideo && !workingImageUrl ? (
              <Card className="mt-3">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Capture a frame from the video above to start editing. Image ops run against the
                  captured still, and the resulting version is chained to this video.
                </CardContent>
              </Card>
            ) : workingImageUrl ? (
              <>
                <TabsContent value="inpaint" className="mt-3">
                  <InpaintPanel
                    imageUrl={workingImageUrl}
                    session={session}
                    onJobComplete={({ jobId, outputUrl, beforeUrl }) =>
                      setPreview({ jobId, beforeUrl, afterUrl: outputUrl })
                    }
                  />
                </TabsContent>
                <TabsContent value="outpaint" className="mt-3">
                  <OutpaintPanel
                    imageUrl={workingImageUrl}
                    session={session}
                    onJobComplete={({ jobId, outputUrl, beforeUrl }) =>
                      setPreview({ jobId, beforeUrl, afterUrl: outputUrl })
                    }
                  />
                </TabsContent>
                <TabsContent value="relight" className="mt-3">
                  <RelightPanel
                    imageUrl={workingImageUrl}
                    session={session}
                    onJobComplete={({ jobId, outputUrl, beforeUrl }) =>
                      setPreview({ jobId, beforeUrl, afterUrl: outputUrl })
                    }
                  />
                </TabsContent>
                <TabsContent value="retexture" className="mt-3">
                  <RetexturePanel
                    imageUrl={workingImageUrl}
                    session={session}
                    onJobComplete={({ jobId, outputUrl, beforeUrl }) =>
                      setPreview({ jobId, beforeUrl, afterUrl: outputUrl })
                    }
                  />
                </TabsContent>
              </>
            ) : null}
          </Tabs>

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
