/**
 * LipSyncPanel — Lip-sync, caption generation, and history.
 *
 * Provides three tabbed workflows:
 * 1. Lip Sync: combine video + audio with face-sync models
 * 2. Captions: generate SRT/VTT/JSON subtitles from video
 * 3. History: browse past lip-sync and caption jobs
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { trpc, queryClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Loader2,
  Mic,
  Captions,
  Clock,
  Download,
  Play,
  CheckCircle2,
  AlertCircle,
  FileText,
  History,
  Coins,
} from 'lucide-react';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LipSyncPanelProps {
  entityId?: string;
  universeAddress?: string;
}

type LipSyncStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';
type CaptionFormat = 'srt' | 'vtt' | 'json';

const LANGUAGES = [
  { label: 'English', value: 'en' },
  { label: 'Spanish', value: 'es' },
  { label: 'French', value: 'fr' },
  { label: 'Japanese', value: 'ja' },
  { label: 'German', value: 'de' },
  { label: 'Portuguese', value: 'pt' },
  { label: 'Korean', value: 'ko' },
  { label: 'Chinese', value: 'zh' },
  { label: 'Italian', value: 'it' },
  { label: 'Hindi', value: 'hi' },
] as const;

const CAPTION_FORMATS: { label: string; value: CaptionFormat }[] = [
  { label: 'SRT', value: 'srt' },
  { label: 'VTT', value: 'vtt' },
  { label: 'JSON', value: 'json' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LipSyncPanel({ entityId, universeAddress }: LipSyncPanelProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <Tabs defaultValue="lipsync" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-transparent px-4 pt-2">
          <TabsTrigger
            value="lipsync"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Mic className="h-4 w-4 mr-1.5" />
            Lip Sync
          </TabsTrigger>
          <TabsTrigger
            value="captions"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Captions className="h-4 w-4 mr-1.5" />
            Captions
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <History className="h-4 w-4 mr-1.5" />
            History
          </TabsTrigger>
        </TabsList>

        <div className="p-4">
          <TabsContent value="lipsync" className="mt-0">
            <LipSyncTab entityId={entityId} universeAddress={universeAddress} />
          </TabsContent>
          <TabsContent value="captions" className="mt-0">
            <CaptionsTab entityId={entityId} universeAddress={universeAddress} />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <HistoryTab entityId={entityId} universeAddress={universeAddress} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lip Sync Tab                                                       */
/* ------------------------------------------------------------------ */

function LipSyncTab({
  entityId,
  universeAddress,
}: {
  entityId?: string;
  universeAddress?: string;
}) {
  const [videoUrl, setVideoUrl] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [model, setModel] = useState<'lipsync' | 'sadtalker'>('lipsync');
  const [status, setStatus] = useState<LipSyncStatus>('idle');
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const syncMutation = useMutation(
    trpc.lipsync.sync.mutationOptions({
      onMutate: () => setStatus('queued'),
      onSuccess: (data: any) => {
        setStatus('completed');
        setResultUrl(data.videoUrl || data.resultUrl || null);
        toast.success('Lip sync completed');
        queryClient.invalidateQueries({ queryKey: ['lipsync-history'] });
      },
      onError: (err: any) => {
        setStatus('failed');
        toast.error(err.message || 'Lip sync failed');
      },
    })
  );

  const handleSync = () => {
    if (!videoUrl.trim() || !audioUrl.trim()) {
      toast.error('Please provide both a video URL and an audio URL');
      return;
    }
    setResultUrl(null);
    setStatus('queued');
    syncMutation.mutate({
      videoUrl: videoUrl.trim(),
      audioUrl: audioUrl.trim(),
      model,
      entityId,
      universeAddress,
    });
  };

  const isProcessing = status === 'queued' || status === 'running' || syncMutation.isPending;

  return (
    <div className="space-y-5">
      {/* Video URL */}
      <div className="space-y-1.5">
        <Label className="text-zinc-300">Video URL</Label>
        <Input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://... or paste a generation URL"
          className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
          disabled={isProcessing}
        />
      </div>

      {/* Audio URL */}
      <div className="space-y-1.5">
        <Label className="text-zinc-300">Audio URL</Label>
        <Input
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
          placeholder="https://... audio file or TTS output"
          className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
          disabled={isProcessing}
        />
      </div>

      {/* Model selector */}
      <div className="space-y-1.5">
        <Label className="text-zinc-300">Model</Label>
        <Select
          value={model}
          onValueChange={(v) => setModel(v as 'lipsync' | 'sadtalker')}
          disabled={isProcessing}
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lipsync">Lip Sync (default)</SelectItem>
            <SelectItem value="sadtalker">SadTalker</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSync}
          disabled={isProcessing || !videoUrl.trim() || !audioUrl.trim()}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              {status === 'queued' ? 'Queued...' : 'Syncing...'}
            </>
          ) : (
            <>
              <Mic className="h-4 w-4 mr-1.5" />
              Sync
            </>
          )}
        </Button>
        <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 border-zinc-700">
          <Coins className="h-3 w-3 mr-1" />5 credits
        </Badge>
      </div>

      {/* Progress indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
          <span>
            {status === 'queued' && 'Job queued, waiting for worker...'}
            {status === 'running' && 'Processing lip sync...'}
            {syncMutation.isPending && status === 'queued' && 'Submitting job...'}
          </span>
        </div>
      )}

      {/* Failure */}
      {status === 'failed' && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span>Lip sync failed. Check inputs and try again.</span>
        </div>
      )}

      {/* Result preview */}
      {status === 'completed' && resultUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Lip sync completed</span>
          </div>
          <div className="rounded-lg overflow-hidden border border-zinc-700">
            <video src={resultUrl} controls className="w-full max-h-80 bg-black" />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => window.open(resultUrl, '_blank')}
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              Open
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              asChild
            >
              <a href={resultUrl} download>
                <Download className="h-3.5 w-3.5 mr-1" />
                Download
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Captions Tab                                                       */
/* ------------------------------------------------------------------ */

function CaptionsTab({
  entityId,
  universeAddress,
}: {
  entityId?: string;
  universeAddress?: string;
}) {
  const [videoUrl, setVideoUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [format, setFormat] = useState<CaptionFormat>('srt');
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const captionMutation = useMutation(
    trpc.lipsync.generateCaptions.mutationOptions({
      onSuccess: (data: any) => {
        setCaptionText(data.captionText || data.text || '');
        setDownloadUrl(data.downloadUrl || data.fileUrl || null);
        toast.success('Captions generated');
        queryClient.invalidateQueries({ queryKey: ['lipsync-history'] });
      },
      onError: (err: any) => {
        toast.error(err.message || 'Caption generation failed');
      },
    })
  );

  const handleGenerate = () => {
    if (!videoUrl.trim()) {
      toast.error('Please provide a video URL');
      return;
    }
    setCaptionText(null);
    setDownloadUrl(null);
    captionMutation.mutate({
      videoUrl: videoUrl.trim(),
      language,
      format,
      entityId,
      universeAddress,
    });
  };

  const handleDownloadBlob = () => {
    if (!captionText) return;
    const ext = format === 'json' ? 'json' : format;
    const mimeType = format === 'json' ? 'application/json' : 'text/plain';
    const blob = new Blob([captionText], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captions.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Video URL */}
      <div className="space-y-1.5">
        <Label className="text-zinc-300">Video URL</Label>
        <Input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://... video to caption"
          className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
          disabled={captionMutation.isPending}
        />
      </div>

      {/* Language */}
      <div className="space-y-1.5">
        <Label className="text-zinc-300">Language</Label>
        <Select value={language} onValueChange={setLanguage} disabled={captionMutation.isPending}>
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Format */}
      <div className="space-y-1.5">
        <Label className="text-zinc-300">Format</Label>
        <Select
          value={format}
          onValueChange={(v) => setFormat(v as CaptionFormat)}
          disabled={captionMutation.isPending}
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAPTION_FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleGenerate}
          disabled={captionMutation.isPending || !videoUrl.trim()}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          {captionMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              Generating...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4 mr-1.5" />
              Generate Captions
            </>
          )}
        </Button>
        <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 border-zinc-700">
          <Coins className="h-3 w-3 mr-1" />3 credits
        </Badge>
      </div>

      {/* Caption result */}
      {captionText !== null && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Captions ready</span>
          </div>
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 max-h-64 overflow-y-auto">
            <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">{captionText}</pre>
          </div>
          <div className="flex gap-2">
            {downloadUrl ? (
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                asChild
              >
                <a href={downloadUrl} download>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download
                </a>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                onClick={handleDownloadBlob}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                Download .{format}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History Tab                                                        */
/* ------------------------------------------------------------------ */

function HistoryTab({
  entityId,
  universeAddress,
}: {
  entityId?: string;
  universeAddress?: string;
}) {
  const { data: history, isLoading } = useQuery({
    ...trpc.lipsync.getHistory.queryOptions({
      entityId,
      universeAddress,
      limit: 50,
    }),
    queryKey: ['lipsync-history', entityId, universeAddress],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const items = (history as any[]) || [];

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No lip-sync or caption jobs yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
      {items.map((item: any) => (
        <HistoryItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function HistoryItem({ item }: { item: any }) {
  const isLipSync = item.type === 'lipsync' || item.type === 'lip_sync';
  const statusColor: Record<string, string> = {
    completed: 'text-green-400',
    failed: 'text-red-400',
    running: 'text-yellow-400',
    queued: 'text-zinc-400',
  };

  const resultUrl = item.resultUrl || item.videoUrl || item.downloadUrl || null;

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex items-start gap-3">
      {/* Thumbnail / icon */}
      <div className="flex-shrink-0 w-16 h-12 rounded bg-zinc-700 flex items-center justify-center overflow-hidden">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : isLipSync ? (
          <Mic className="h-5 w-5 text-zinc-500" />
        ) : (
          <FileText className="h-5 w-5 text-zinc-500" />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-zinc-700 text-zinc-300 text-xs">
            {isLipSync ? 'Lip Sync' : 'Captions'}
          </Badge>
          <span className={`text-xs font-medium ${statusColor[item.status] || 'text-zinc-400'}`}>
            {item.status}
          </span>
        </div>
        <p className="text-xs text-zinc-500 mt-1 truncate">
          {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Unknown date'}
        </p>
      </div>

      {/* Action */}
      {item.status === 'completed' && resultUrl && (
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-400 hover:text-white"
          onClick={() => window.open(resultUrl, '_blank')}
        >
          {isLipSync ? <Play className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
}
