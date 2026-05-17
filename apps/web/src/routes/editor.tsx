/**
 * Video Editor — Runway/Higgsfield-style editing suite.
 *
 * Full-page editor with:
 * - Video/image preview with playback controls
 * - Editing toolbar (upscale, slow-mo, restyle, inpaint, remove BG, extend)
 * - Inpaint canvas overlay for region painting
 * - Editing history panel
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { awaitSessionValidation } from '@/lib/wallet-auth';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Play,
  Pause,
  Upload,
  Link2,
  Image,
  Film,
  History,
  Layers,
  ChevronLeft,
  Camera,
  Mic,
  Rocket,
} from 'lucide-react';
import { useVideoEditing } from '@/hooks/useVideoEditing';
import { VideoEditingToolbar } from '@/components/editing/VideoEditingToolbar';
import { InpaintCanvas } from '@/components/editing/InpaintCanvas';
import { AnimateImagePanel } from '@/components/editing/AnimateImagePanel';
import { TalkingScenePanel } from '@/components/editing/TalkingScenePanel';
import { VoiceModifyPanel } from '@/components/editing/VoiceModifyPanel';
import { PublishEpisodeDialog } from '@/components/editing/PublishEpisodeDialog';
import { DubLipsyncPanel } from '@/components/editing/DubLipsyncPanel';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export const Route = createFileRoute('/editor')({
  validateSearch: (search: Record<string, unknown>) => ({
    video: (search.video as string) || undefined,
    image: (search.image as string) || undefined,
    audio: (search.audio as string) || undefined,
    draft: (search.draft as string) || undefined,
  }),
  // WEB-6: await /auth/me so paid edit jobs can't fire during the auth hydration window.
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/editor' } });
    }
    await awaitSessionValidation();
  },
  component: EditorPage,
});

function EditorPage() {
  const {
    video: initialVideo,
    image: initialImage,
    audio: initialAudio,
    draft: initialDraftId,
  } = Route.useSearch();
  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideo || null);
  const [imageUrl, setImageUrl] = useState<string | null>(initialImage || null);
  const [audioUrl, setAudioUrl] = useState<string | null>(initialAudio || null);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [inputMode, setInputMode] = useState<'url' | 'upload'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showInpaintCanvas, setShowInpaintCanvas] = useState(false);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('tools');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editing = useVideoEditing();

  // ── E7: drafts — resume on mount when ?draft=<id> is present ─────
  useEffect(() => {
    if (!initialDraftId) return;
    let cancelled = false;
    (async () => {
      try {
        const draft = (await trpcClient.editorDrafts.get.query({
          draftId: initialDraftId,
        })) as {
          id: string;
          videoUrl: string | null;
          imageUrl: string | null;
          audioUrl: string | null;
        };
        if (cancelled) return;
        if (draft.videoUrl) setVideoUrl(draft.videoUrl);
        if (draft.imageUrl) setImageUrl(draft.imageUrl);
        if (draft.audioUrl) setAudioUrl(draft.audioUrl);
        setDraftId(draft.id);
        toast.success('Draft resumed');
      } catch (err) {
        console.error('[editor] resume draft failed:', err);
        toast.error('Could not load draft');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDraftId]);

  // ── E7: drafts — debounced autosave whenever media changes ──────
  useEffect(() => {
    if (!videoUrl && !imageUrl && !audioUrl) return;
    const handle = setTimeout(async () => {
      try {
        const res = (await trpcClient.editorDrafts.save.mutate({
          draftId: draftId ?? undefined,
          title: '',
          description: '',
          videoUrl: videoUrl ?? null,
          imageUrl: imageUrl ?? null,
          audioUrl: audioUrl ?? null,
        })) as { id: string };
        if (!draftId) setDraftId(res.id);
        setDraftSavedAt(new Date());
      } catch (err) {
        console.error('[editor] autosave failed:', err);
      }
    }, 5000);
    return () => clearTimeout(handle);
  }, [videoUrl, imageUrl, audioUrl, draftId]);

  // Editing history
  const historyQuery = useQuery({
    queryKey: ['editing', 'history'],
    queryFn: () => trpcClient.editing.history.query({ limit: 20 }),
    staleTime: 10_000,
  });

  const handleLoadUrl = useCallback(() => {
    if (!urlInput.trim()) return;
    const url = urlInput.trim();

    // Detect if video, audio, or image
    const lc = url.toLowerCase();
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi'];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    const isVideo = videoExtensions.some((ext) => lc.includes(ext));
    const isAudio = audioExtensions.some((ext) => lc.includes(ext));

    if (isVideo) {
      setVideoUrl(url);
      setImageUrl(null);
      setAudioUrl(null);
    } else if (isAudio) {
      setAudioUrl(url);
      setVideoUrl(null);
      setImageUrl(null);
    } else {
      setImageUrl(url);
      setVideoUrl(null);
      setAudioUrl(null);
    }
    toast.success('Media loaded');
  }, [urlInput]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      setVideoUrl(url);
      setImageUrl(null);
      setAudioUrl(null);
    } else if (file.type.startsWith('image/')) {
      setImageUrl(url);
      setVideoUrl(null);
      setAudioUrl(null);
    } else if (file.type.startsWith('audio/')) {
      setAudioUrl(url);
      setVideoUrl(null);
      setImageUrl(null);
    }
    toast.success(`Loaded ${file.name}`);
  }, []);

  const handleCaptureFrame = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setImageUrl(dataUrl);
    toast.success('Frame captured');
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // When an editing operation returns a new URL, update the preview
  const handleResultApplied = useCallback(() => {
    if (editing.lastResult?.videoUrl) {
      setVideoUrl(editing.lastResult.videoUrl);
    }
    if (editing.lastResult?.imageUrl) {
      setImageUrl(editing.lastResult.imageUrl);
    }
  }, [editing.lastResult]);

  const hasMedia = videoUrl || imageUrl || audioUrl;

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <div className="border-b border-border/40 bg-card/30 backdrop-blur-sm px-4 py-2 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <a href="/dashboard">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </a>
        </Button>
        <div className="h-4 w-px bg-border/40" />
        <Film className="w-4 h-4 text-purple-400" />
        <h1 className="text-sm font-medium">Video Editor</h1>
        <Badge variant="secondary" className="text-[9px]">
          Beta
        </Badge>

        {/* E6: terminal publish — single button replaces the manual three-step
            after export. Always visible; disabled until a video is loaded.
            E7: a passive "Draft saved …" tag whenever autosave fires. */}
        <div className="ml-auto flex items-center gap-3">
          {draftSavedAt && (
            <span className="text-[10px] text-muted-foreground">
              Draft saved{' '}
              {draftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button
            size="sm"
            onClick={() => setShowPublishDialog(true)}
            disabled={!videoUrl}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
          >
            <Rocket className="w-3 h-3 mr-1.5" />
            Publish as Episode
          </Button>
        </div>
      </div>

      <PublishEpisodeDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        videoUrl={videoUrl}
      />

      <div className="flex h-[calc(100vh-49px)]">
        {/* Main Preview Area */}
        <div className="flex-1 flex flex-col p-4">
          {/* Preview */}
          <div className="flex-1 flex items-center justify-center bg-black/20 rounded-lg border border-border/20 relative overflow-hidden">
            {!hasMedia ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-muted/20 flex items-center justify-center">
                  <Film className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Load a video, image, or audio clip to start editing
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Supports MP4, WebM, JPG, PNG, MP3, WAV
                  </p>
                </div>
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setInputMode('url');
                      // Focus URL input in sidebar
                    }}
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1.5" />
                    Paste URL
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload
                  </Button>
                </div>
              </div>
            ) : showInpaintCanvas && imageUrl ? (
              <InpaintCanvas
                imageUrl={imageUrl}
                onMaskChange={setMaskUrl}
                width={640}
                height={360}
              />
            ) : videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="max-w-full max-h-full rounded"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                controls={false}
                loop
              />
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt="Preview"
                className="max-w-full max-h-full rounded object-contain"
              />
            ) : audioUrl ? (
              <div className="flex flex-col items-center gap-4 p-8">
                <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mic className="w-10 h-10 text-primary" />
                </div>
                <audio src={audioUrl} controls className="w-96 max-w-full" />
                <p className="text-xs text-muted-foreground">
                  Open the Voice tab to swap or apply effect presets
                </p>
              </div>
            ) : null}
          </div>

          {/* Playback Controls */}
          {hasMedia && (
            <div className="flex items-center gap-2 mt-3 px-2">
              {videoUrl && (
                <>
                  <Button variant="outline" size="sm" onClick={togglePlay}>
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCaptureFrame}>
                    <Camera className="w-3.5 h-3.5 mr-1" />
                    Capture Frame
                  </Button>
                </>
              )}
              {imageUrl && (
                <Button
                  variant={showInpaintCanvas ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowInpaintCanvas(!showInpaintCanvas)}
                >
                  <Layers className="w-3.5 h-3.5 mr-1" />
                  {showInpaintCanvas ? 'Exit Paint Mode' : 'Paint Mask'}
                </Button>
              )}
              {editing.lastResult && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResultApplied}
                  className="ml-auto"
                >
                  Apply Result to Preview
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar — Tools & History */}
        <div className="w-[380px] border-l border-border/40 bg-card/20 overflow-y-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <TabsList className="w-full rounded-none border-b border-border/40 bg-transparent h-10">
              <TabsTrigger value="tools" className="text-xs flex-1">
                Tools
              </TabsTrigger>
              <TabsTrigger value="animate" className="text-xs flex-1">
                Animate
              </TabsTrigger>
              <TabsTrigger value="talking" className="text-xs flex-1">
                Talking
              </TabsTrigger>
              <TabsTrigger value="voice" className="text-xs flex-1">
                Voice
              </TabsTrigger>
              <TabsTrigger value="dub" className="text-xs flex-1">
                Dub
              </TabsTrigger>
              <TabsTrigger value="input" className="text-xs flex-1">
                Input
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs flex-1">
                History
              </TabsTrigger>
            </TabsList>

            {/* Animate Tab — PRD 8 image-to-video flow */}
            <TabsContent value="animate" className="flex-1 p-4 m-0 overflow-y-auto">
              <AnimateImagePanel
                imageUrl={imageUrl}
                onComplete={(url) => {
                  setVideoUrl(url);
                  setActiveTab('tools');
                }}
              />
            </TabsContent>

            {/* Talking Scene Tab — PRD 8 portrait + dialogue flow */}
            <TabsContent value="talking" className="flex-1 p-4 m-0 overflow-y-auto">
              <TalkingScenePanel
                imageUrl={imageUrl}
                onComplete={(url) => {
                  setVideoUrl(url);
                  setActiveTab('tools');
                }}
              />
            </TabsContent>

            {/* Voice Tab — swap voice / apply effect preset on audio */}
            <TabsContent value="voice" className="flex-1 p-4 m-0 overflow-y-auto">
              <VoiceModifyPanel
                audioUrl={audioUrl}
                onComplete={(newUrl) => {
                  setAudioUrl(newUrl);
                  toast.success('Voice modified — preview updated');
                }}
              />
            </TabsContent>

            {/* Dub Tab — E2 multilingual dubbing + E3 inline lipsync */}
            <TabsContent value="dub" className="flex-1 p-4 m-0 overflow-y-auto">
              <DubLipsyncPanel
                videoUrl={videoUrl}
                onVideoReplaced={(newUrl) => {
                  setVideoUrl(newUrl);
                  toast.success('Video updated to lipsynced version');
                }}
              />
            </TabsContent>

            {/* Tools Tab */}
            <TabsContent value="tools" className="flex-1 p-4 space-y-4 m-0">
              <VideoEditingToolbar
                videoUrl={videoUrl}
                imageUrl={imageUrl}
                onUpscale={editing.upscale}
                onInterpolate={editing.interpolate}
                onRestyle={editing.restyle}
                onInpaint={editing.inpaint}
                onRemoveBackground={editing.removeBackground}
                onExtend={editing.extend}
                isProcessing={editing.isProcessing}
                activeOperation={editing.activeOperation}
                lastResult={editing.lastResult}
                models={editing.models}
                getModelsForOperation={editing.getModelsForOperation}
                maskUrl={maskUrl || undefined}
              />
            </TabsContent>

            {/* Input Tab */}
            <TabsContent value="input" className="flex-1 p-4 space-y-4 m-0">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Load from URL</label>
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/video.mp4 or audio.mp3"
                    className="h-8 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleLoadUrl()}
                  />
                  <Button size="sm" onClick={handleLoadUrl} disabled={!urlInput.trim()}>
                    Load
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/40" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Upload file</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,image/*,audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  className="w-full h-24 border-dashed"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-center">
                    <Upload className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Drop or click to upload video / image / audio
                    </span>
                  </div>
                </Button>
              </div>

              {hasMedia && (
                <Card className="p-3">
                  <div className="flex items-center gap-2">
                    {videoUrl ? (
                      <Film className="w-4 h-4 text-purple-400" />
                    ) : audioUrl ? (
                      <Mic className="w-4 h-4 text-green-400" />
                    ) : (
                      <Image className="w-4 h-4 text-blue-400" />
                    )}
                    <span className="text-xs truncate flex-1">
                      {videoUrl || audioUrl || imageUrl}
                    </span>
                    <Badge variant="secondary" className="text-[9px]">
                      {videoUrl ? 'Video' : audioUrl ? 'Audio' : 'Image'}
                    </Badge>
                  </div>
                </Card>
              )}
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="flex-1 p-4 m-0">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Recent Edits</h3>
              </div>

              {historyQuery.isLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded bg-muted/20 animate-pulse" />
                  ))}
                </div>
              )}

              {historyQuery.data?.jobs.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No editing history yet. Apply an edit to see it here.
                </p>
              )}

              <div className="space-y-2">
                {historyQuery.data?.jobs.map((job) => (
                  <Card
                    key={job.id}
                    className="p-2.5 cursor-pointer hover:bg-muted/10 transition-colors"
                    onClick={() => {
                      if (job.outputUrl) {
                        if (
                          job.operation === 'interpolate' ||
                          job.operation === 'restyle' ||
                          job.operation === 'extend'
                        ) {
                          setVideoUrl(job.outputUrl);
                        } else {
                          setImageUrl(job.outputUrl);
                        }
                        toast.success('Loaded from history');
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={job.status === 'completed' ? 'default' : 'destructive'}
                        className="text-[9px]"
                      >
                        {job.operation}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground flex-1 truncate">
                        {job.prompt || job.modelId}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {job.creditsCharged} cr
                      </span>
                    </div>
                    {job.latencyMs && (
                      <span className="text-[9px] text-muted-foreground mt-0.5 block">
                        {(job.latencyMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*,audio/*"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );
}
