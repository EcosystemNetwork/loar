/**
 * Script-to-Episode
 *
 * Batch-generates video clips from a script with sequential frame
 * continuity, then auto-assembles them into an episode.
 *
 * Two phases:
 *  1. Input — script textarea, duration config, style/cast options
 *  2. Progress — per-scene status list, overall progress, completion link
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  X,
  Loader2,
  Check,
  AlertCircle,
  Circle,
  ScrollText,
  Film,
  Sparkles,
  Clock,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';

interface ScriptToEpisodeProps {
  universeId: string;
  onClose: () => void;
  onComplete?: (episodeId: string) => void;
}

type ClipDuration = 5 | 10 | 15 | 20;

export function ScriptToEpisode({ universeId, onClose, onComplete }: ScriptToEpisodeProps) {
  // ── Input state ──────────────────────────────────────────────────────

  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [clipDuration, setClipDuration] = useState<ClipDuration>(10);
  const [targetDuration, setTargetDuration] = useState(60); // seconds
  const [stylePreset, setStylePreset] = useState('');
  const [qualityTarget, setQualityTarget] = useState<'draft' | 'standard' | 'premium'>('standard');

  // ── Job state ────────────────────────────────────────────────────────

  const [jobId, setJobId] = useState<string | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────

  const parsedScenes = useMemo(() => {
    const paragraphs = script
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return paragraphs;
  }, [script]);

  const isMultiScene = parsedScenes.length > 1;
  const sceneCount = isMultiScene
    ? parsedScenes.length
    : Math.max(1, Math.ceil(targetDuration / clipDuration));
  const estimatedDuration = sceneCount * clipDuration;

  // ── Mutations ────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async () => {
      const result = await trpcClient.episodes.generateFromScript.mutate({
        universeId,
        title: title || 'Untitled Episode',
        script,
        clipDurationSec: clipDuration,
        ...(!isMultiScene ? { targetDurationSec: targetDuration } : {}),
        aspectRatio: '16:9',
        resolution: '720p',
        qualityTarget,
        ...(stylePreset ? { stylePreset } : {}),
      });
      return result;
    },
    onSuccess: (result) => {
      setJobId(result.jobId);
    },
  });

  // ── Polling ──────────────────────────────────────────────────────────

  const { data: jobStatus } = useQuery({
    queryKey: ['scriptToEpisodeJob', jobId],
    queryFn: () => trpcClient.episodes.scriptJobStatus.query({ jobId: jobId! }),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 5000;
    },
  });

  const completedCount = jobStatus?.clipResults.filter((r) => r.status === 'completed').length ?? 0;
  const failedCount = jobStatus?.clipResults.filter((r) => r.status === 'failed').length ?? 0;
  const totalClips = jobStatus?.clipCount ?? sceneCount;
  const progressPct =
    totalClips > 0 ? Math.round(((completedCount + failedCount) / totalClips) * 100) : 0;
  const isJobDone = jobStatus?.status === 'completed' || jobStatus?.status === 'failed';

  // ── Format helpers ───────────────────────────────────────────────────

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Script to Episode</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-zinc-400 hover:text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!jobId ? (
            /* ── Phase 1: Input ──────────────────────────────────────── */
            <>
              {/* Title */}
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">
                  Episode Title
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My Episode"
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>

              {/* Script textarea */}
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">
                  Script
                  <span className="text-zinc-500 ml-1 font-normal">
                    (separate scenes with blank lines)
                  </span>
                </label>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder={`A wide cinematic shot of a futuristic city at dawn. Flying vehicles weave between towering skyscrapers as the sun rises over the horizon.\n\nInside a dimly lit control room, a team of analysts monitors holographic displays. Alert lights begin flashing red as an anomaly is detected.\n\nA lone figure in a dark coat steps out onto a rain-soaked rooftop, gazing down at the city below. Lightning illuminates their face as they make a fateful decision.`}
                  rows={8}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 resize-y min-h-[120px]"
                />
                <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                  <span>
                    {isMultiScene
                      ? `${parsedScenes.length} scenes detected`
                      : 'Single prompt mode — clips repeat with frame continuity'}
                  </span>
                </div>
              </div>

              {/* Duration config */}
              <div className="grid grid-cols-2 gap-4">
                {/* Clip duration */}
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                    Clip Duration
                  </label>
                  <div className="flex gap-1.5">
                    {([5, 10, 15, 20] as ClipDuration[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => setClipDuration(d)}
                        className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                          clipDuration === d
                            ? 'bg-emerald-600 text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                        }`}
                      >
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target duration (single-prompt mode only) */}
                {!isMultiScene && (
                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                      Target Duration
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={clipDuration}
                        max={1800}
                        step={clipDuration}
                        value={targetDuration}
                        onChange={(e) => setTargetDuration(Number(e.target.value) || clipDuration)}
                        className="bg-zinc-800 border-zinc-700 text-white w-24"
                      />
                      <span className="text-xs text-zinc-500">
                        seconds ({formatDuration(targetDuration)})
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Quality */}
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Quality</label>
                <div className="flex gap-1.5">
                  {(['draft', 'standard', 'premium'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQualityTarget(q)}
                      className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                        qualityTarget === q
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Style preset (optional) */}
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">
                  Style Preset <span className="text-zinc-600 font-normal">(optional)</span>
                </label>
                <Input
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value)}
                  placeholder="e.g. cinematic, anime, photorealistic"
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>

              {/* Cost preview */}
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <Film className="h-4 w-4 text-emerald-400" />
                    <span className="font-medium">{sceneCount}</span>
                    <span className="text-zinc-500">clips</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <Clock className="h-4 w-4 text-blue-400" />
                    <span className="font-medium">{formatDuration(estimatedDuration)}</span>
                    <span className="text-zinc-500">total</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* ── Phase 2: Progress ─────────────────────────────────── */
            <>
              {/* Overall progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300 font-medium">
                    {jobStatus?.status === 'completed'
                      ? 'Episode complete'
                      : jobStatus?.status === 'failed'
                        ? 'Generation failed'
                        : jobStatus?.status === 'assembling'
                          ? 'Assembling episode...'
                          : `Generating scene ${(jobStatus?.currentSceneIndex ?? 0) + 1} of ${totalClips}...`}
                  </span>
                  <span className="text-zinc-500">{progressPct}%</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      jobStatus?.status === 'failed'
                        ? 'bg-red-500'
                        : jobStatus?.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {jobStatus?.creditsRefunded ? (
                  <p className="text-xs text-amber-400">
                    {jobStatus.creditsRefunded} credits refunded for failed clips
                  </p>
                ) : null}
              </div>

              {/* Scene list */}
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {jobStatus?.clipResults.map((clip, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                      clip.status === 'generating'
                        ? 'bg-emerald-900/20 border border-emerald-800/30'
                        : clip.status === 'completed'
                          ? 'bg-zinc-800/50'
                          : clip.status === 'failed'
                            ? 'bg-red-900/10 border border-red-900/20'
                            : 'bg-zinc-800/30'
                    }`}
                  >
                    {/* Status icon */}
                    <div className="shrink-0">
                      {clip.status === 'pending' && <Circle className="h-4 w-4 text-zinc-600" />}
                      {clip.status === 'generating' && (
                        <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                      )}
                      {clip.status === 'completed' && (
                        <Check className="h-4 w-4 text-emerald-400" />
                      )}
                      {clip.status === 'failed' && <AlertCircle className="h-4 w-4 text-red-400" />}
                    </div>

                    {/* Scene info */}
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-400 mr-2 font-mono text-xs">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={`${clip.status === 'completed' ? 'text-zinc-300' : 'text-zinc-500'} truncate`}
                      >
                        {parsedScenes[i]?.slice(0, 60) || `Scene ${i + 1}`}
                        {(parsedScenes[i]?.length ?? 0) > 60 ? '...' : ''}
                      </span>
                    </div>

                    {/* Thumbnail for completed clips */}
                    {clip.status === 'completed' && clip.videoUrl && (
                      <video
                        src={clip.videoUrl}
                        className="h-10 w-16 rounded object-cover shrink-0"
                        muted
                        preload="metadata"
                      />
                    )}

                    {/* Error message */}
                    {clip.status === 'failed' && clip.error && (
                      <span
                        className="text-xs text-red-400 truncate max-w-[150px]"
                        title={clip.error}
                      >
                        {clip.error.slice(0, 40)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Completion error */}
              {jobStatus?.status === 'failed' && jobStatus.error && (
                <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3 text-sm text-red-300">
                  {jobStatus.error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-white"
            onClick={onClose}
          >
            {isJobDone ? 'Close' : 'Cancel'}
          </Button>

          <div className="flex items-center gap-2">
            {!jobId && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
                disabled={!script.trim() || generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Generate Episode ({sceneCount} clips)
              </Button>
            )}

            {jobStatus?.status === 'completed' && jobStatus.episodeId && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
                onClick={() => {
                  onComplete?.(jobStatus.episodeId!);
                  onClose();
                }}
              >
                <Film className="h-4 w-4" />
                Open in Episode Builder
              </Button>
            )}
          </div>
        </div>

        {/* Error toast */}
        {generateMutation.isError && (
          <div className="absolute bottom-16 left-5 right-5 bg-red-900/90 border border-red-700 rounded-lg p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{(generateMutation.error as Error).message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
