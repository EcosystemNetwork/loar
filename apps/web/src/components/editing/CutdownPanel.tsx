/**
 * CutdownPanel — E5 from prd-editor.md
 *
 * Auto-assembles a short-form cutdown from the editor's current video.
 * cutdown.generate runs ASR + segment-ranking on the source video and
 * returns one or more recommended clips (start/end + transcript text).
 * The user picks a target aspect ratio + length, kicks off the job,
 * watches per-segment status, and (when complete) loads the assembled
 * output back into the editor.
 *
 * Stays narrow on purpose: this is "auto-cutdown from prompt", not a
 * full timeline editor. The full multi-clip timeline assembly is tracked
 * separately as a future iteration.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Loader2, Scissors, Check, AlertTriangle, Play } from 'lucide-react';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';

interface CutdownSegment {
  start: number;
  end: number;
  text?: string;
}

interface CutdownState {
  cutdownId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  segments: CutdownSegment[];
  outputVideoUrl?: string;
  totalDurationSec: number;
  error?: string;
}

interface CutdownPanelProps {
  videoUrl: string | null;
  onVideoReplaced: (newVideoUrl: string) => void;
}

const ASPECT_OPTIONS = [
  { value: '9:16' as const, label: 'Vertical 9:16' },
  { value: '1:1' as const, label: 'Square 1:1' },
  { value: '4:5' as const, label: 'Portrait 4:5' },
];

export function CutdownPanel({ videoUrl, onVideoReplaced }: CutdownPanelProps) {
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1' | '4:5'>('9:16');
  const [maxDurationSec, setMaxDurationSec] = useState(30);
  const [mode, setMode] = useState<'auto' | 'highlight' | 'full'>('auto');
  const [addCaptions, setAddCaptions] = useState(true);
  const [job, setJob] = useState<CutdownState | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!videoUrl) throw new Error('Load a video first');
      const res = (await trpcClient.cutdown.generate.mutate({
        sourceVideoUrl: videoUrl,
        targetAspectRatio: aspectRatio,
        mode,
        maxDurationSec,
        addCaptions,
        captionStyle: 'default',
      } as never)) as {
        cutdownId: string;
        status: CutdownState['status'];
        segments?: CutdownSegment[];
        totalDurationSec?: number;
      };

      setJob({
        cutdownId: res.cutdownId,
        status: res.status,
        segments: res.segments ?? [],
        totalDurationSec: res.totalDurationSec ?? 0,
      });
      return res;
    },
    onSuccess: () => toast.success('Cutdown started — segments will appear when ready'),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Cutdown failed to start'),
  });

  // Poll the cutdown.get endpoint until the job reaches a terminal state.
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return;

    const handle = setInterval(async () => {
      try {
        const res = (await trpcClient.cutdown.get.query({
          cutdownId: job.cutdownId,
        } as never)) as Record<string, unknown>;
        const next: CutdownState = {
          cutdownId: job.cutdownId,
          status: (res.status as CutdownState['status']) ?? 'processing',
          segments: (res.segments as CutdownSegment[] | undefined) ?? [],
          outputVideoUrl: (res.outputVideoUrl as string | undefined) ?? undefined,
          totalDurationSec: (res.totalDurationSec as number | undefined) ?? 0,
          error: res.error as string | undefined,
        };
        setJob(next);
        if (next.status === 'failed') {
          toast.error(next.error || 'Cutdown failed');
        }
      } catch (err) {
        console.error('[CutdownPanel] status poll failed:', err);
      }
    }, 6000);

    return () => clearInterval(handle);
  }, [job]);

  function applyResult() {
    if (!job?.outputVideoUrl) {
      toast.error('Output not ready');
      return;
    }
    onVideoReplaced(job.outputVideoUrl);
    toast.success('Cutdown loaded into editor');
  }

  return (
    <div className="space-y-3">
      {!videoUrl && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Load a video in the Input tab to cut it down.
          </p>
        </Card>
      )}

      {/* Aspect */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Output aspect</label>
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECT_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={aspectRatio === opt.value ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7"
              onClick={() => setAspectRatio(opt.value)}
              disabled={generateMutation.isPending}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Mode */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Strategy</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['auto', 'highlight', 'full'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7 capitalize"
              onClick={() => setMode(m)}
              disabled={generateMutation.isPending}
            >
              {m}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Auto: best moments in {maxDurationSec}s. Highlight: a single peak. Full: keep all.
        </p>
      </div>

      {/* Duration */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">
          Max duration ({maxDurationSec}s)
        </label>
        <Slider
          value={[maxDurationSec]}
          min={5}
          max={90}
          step={5}
          onValueChange={(v) => setMaxDurationSec(v[0] ?? 30)}
          disabled={generateMutation.isPending}
        />
      </div>

      {/* Captions toggle */}
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={addCaptions}
          onChange={(e) => setAddCaptions(e.target.checked)}
          disabled={generateMutation.isPending}
        />
        <span>Burn in captions (recommended for short-form)</span>
      </label>

      <Button
        size="sm"
        className="w-full"
        onClick={() => generateMutation.mutate()}
        disabled={!videoUrl || generateMutation.isPending}
      >
        {generateMutation.isPending ? (
          <>
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <Scissors className="w-3 h-3 mr-1.5" />
            Generate cutdown
          </>
        )}
      </Button>

      {/* Job status */}
      {job && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {job.status === 'completed' ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : job.status === 'failed' ? (
                <AlertTriangle className="w-3 h-3 text-red-500" />
              ) : (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              <span className="text-xs font-medium capitalize">{job.status}</span>
            </div>
            {job.segments.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {job.segments.length} segment{job.segments.length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>

          {job.segments.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {job.segments.map((seg, i) => (
                <div
                  key={`${seg.start}-${i}`}
                  className="text-[10px] text-muted-foreground border-l-2 border-border/40 pl-2 py-0.5"
                >
                  <span className="font-mono mr-2">
                    {seg.start.toFixed(1)}–{seg.end.toFixed(1)}s
                  </span>
                  {seg.text && <span>{seg.text.slice(0, 100)}</span>}
                </div>
              ))}
            </div>
          )}

          {job.status === 'completed' && job.outputVideoUrl && (
            <Button size="sm" variant="outline" className="w-full" onClick={applyResult}>
              <Play className="w-3 h-3 mr-1.5" />
              Load into editor
            </Button>
          )}

          {job.status === 'failed' && job.error && (
            <p className="text-[10px] text-red-400">{job.error}</p>
          )}
        </Card>
      )}
    </div>
  );
}
