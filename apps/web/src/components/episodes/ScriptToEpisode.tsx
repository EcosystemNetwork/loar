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

import { useState, useMemo, useEffect } from 'react';
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
  Link2,
  Split,
  RotateCw,
  SkipForward,
  StopCircle,
  PauseCircle,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

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
  const [mode, setMode] = useState<'continuity' | 'independent'>('continuity');
  const [maxRetries, setMaxRetries] = useState(10);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
        mode,
        maxRetries,
        ...(stylePreset ? { stylePreset } : {}),
      });
      return result;
    },
    onSuccess: (result) => {
      setJobId(result.jobId);
    },
  });

  const controlMutation = useMutation({
    mutationFn: async (action: 'abort' | 'skip' | 'retry') => {
      if (!jobId) return;
      await trpcClient.episodes.controlJob.mutate({ jobId, action });
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
  const isJobDone =
    jobStatus?.status === 'completed' ||
    jobStatus?.status === 'failed' ||
    jobStatus?.status === 'aborted';
  const isJobActive = !!jobStatus && !isJobDone;
  const awaitingIntervention = jobStatus?.status === 'awaiting_intervention';
  const currentClip = jobStatus?.clipResults?.[jobStatus.currentSceneIndex ?? 0] ?? null;

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

              {/* Generation mode */}
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                  Generation Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode('continuity')}
                    className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-colors border ${
                      mode === 'continuity'
                        ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-100'
                        : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <Link2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">Continuity</div>
                      <div className="text-[10px] text-zinc-500 leading-snug mt-0.5">
                        Each scene seeds the next from its last frame. Pauses on failure — never
                        advances with a stale frame.
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setMode('independent')}
                    className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-colors border ${
                      mode === 'independent'
                        ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-100'
                        : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <Split className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">Independent</div>
                      <div className="text-[10px] text-zinc-500 leading-snug mt-0.5">
                        Scenes generated standalone. Failed scenes are refunded and skipped. Faster,
                        no visual chain.
                      </div>
                    </div>
                  </button>
                </div>

                {mode === 'continuity' && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-[11px] text-zinc-500">Auto-retries per scene:</label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={maxRetries}
                      onChange={(e) =>
                        setMaxRetries(Math.max(1, Math.min(50, Number(e.target.value) || 10)))
                      }
                      className="bg-zinc-800 border-zinc-700 text-white w-16 h-7 text-xs"
                    />
                    <span className="text-[11px] text-zinc-600">then pause for your decision</span>
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
                        : jobStatus?.status === 'aborted'
                          ? 'Aborted'
                          : jobStatus?.status === 'assembling'
                            ? 'Assembling episode...'
                            : awaitingIntervention
                              ? `Scene ${(jobStatus?.currentSceneIndex ?? 0) + 1} needs your decision`
                              : currentClip?.retryStatus === 'retrying' ||
                                  currentClip?.retryStatus === 'backing_off'
                                ? `Scene ${(jobStatus?.currentSceneIndex ?? 0) + 1} — retry ${currentClip.retryAttempt ?? 0}/${jobStatus?.maxRetries ?? 10}`
                                : `Generating scene ${(jobStatus?.currentSceneIndex ?? 0) + 1} of ${totalClips}...`}
                  </span>
                  <span className="text-zinc-500">{progressPct}%</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      jobStatus?.status === 'failed' || jobStatus?.status === 'aborted'
                        ? 'bg-red-500'
                        : awaitingIntervention
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {jobStatus?.mode ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    {jobStatus.mode === 'continuity' ? (
                      <Link2 className="h-3 w-3" />
                    ) : (
                      <Split className="h-3 w-3" />
                    )}
                    <span>
                      {jobStatus.mode === 'continuity'
                        ? 'Continuity chain — next scene waits on this one'
                        : 'Independent mode — failures are skipped'}
                    </span>
                  </div>
                ) : null}
                {jobStatus?.creditsRefunded ? (
                  <p className="text-xs text-amber-400">
                    {jobStatus.creditsRefunded} credits refunded for failed clips
                  </p>
                ) : null}
              </div>

              {/* Intervention banner — continuity mode hit max retries */}
              {awaitingIntervention && (
                <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <PauseCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-amber-200">
                        Scene {(jobStatus?.currentSceneIndex ?? 0) + 1} paused — retries exhausted
                      </div>
                      <div className="text-xs text-amber-300/80 mt-1">
                        The next scene needs this one's last frame. Retry to try again, skip to
                        break the chain (next scene will start without a seed frame), or abort the
                        whole job.
                      </div>
                      {currentClip?.error ? (
                        <div
                          className="text-[11px] text-amber-300/70 mt-2 font-mono truncate"
                          title={currentClip.error}
                        >
                          Last error: {currentClip.error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-500 text-white gap-1.5 h-8"
                      disabled={controlMutation.isPending}
                      onClick={() => controlMutation.mutate('retry')}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Retry scene
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 gap-1.5 h-8"
                      disabled={controlMutation.isPending}
                      onClick={() => controlMutation.mutate('skip')}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip scene
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-800/50 text-red-300 hover:bg-red-950/40 gap-1.5 h-8"
                      disabled={controlMutation.isPending}
                      onClick={() => controlMutation.mutate('abort')}
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                      Abort job
                    </Button>
                  </div>
                </div>
              )}

              {/* Scene list */}
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {jobStatus?.clipResults.map((clip, i) => {
                  const isCurrent = (jobStatus?.currentSceneIndex ?? -1) === i;
                  const isBackingOff = clip.retryStatus === 'backing_off';
                  const isAwaiting = clip.retryStatus === 'awaiting_intervention';
                  const retryAtMs = clip.retryAt ? Date.parse(clip.retryAt) : 0;
                  const backoffRemaining =
                    isBackingOff && retryAtMs
                      ? Math.max(0, Math.ceil((retryAtMs - now) / 1000))
                      : 0;
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                        isAwaiting
                          ? 'bg-amber-900/15 border border-amber-700/30'
                          : isBackingOff
                            ? 'bg-amber-900/10 border border-amber-800/20'
                            : clip.status === 'generating'
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
                        {clip.status === 'generating' && !isBackingOff && (
                          <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                        )}
                        {isBackingOff && <Clock className="h-4 w-4 text-amber-400" />}
                        {isAwaiting && <PauseCircle className="h-4 w-4 text-amber-400" />}
                        {clip.status === 'completed' && (
                          <Check className="h-4 w-4 text-emerald-400" />
                        )}
                        {clip.status === 'failed' && !isAwaiting && (
                          <AlertCircle className="h-4 w-4 text-red-400" />
                        )}
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
                        {isBackingOff ||
                        isAwaiting ||
                        (isCurrent && (clip.retryAttempt ?? 0) > 0) ? (
                          <div className="text-[10px] text-amber-400/80 mt-0.5">
                            {isAwaiting
                              ? `Paused — retries exhausted (${clip.retryAttempt}/${jobStatus?.maxRetries ?? 10})`
                              : isBackingOff
                                ? `Backing off ${backoffRemaining}s — retry ${clip.retryAttempt ?? 0}/${jobStatus?.maxRetries ?? 10}`
                                : `Retry ${clip.retryAttempt ?? 0}/${jobStatus?.maxRetries ?? 10}`}
                          </div>
                        ) : null}
                      </div>

                      {/* Inline retry-now button during backoff on the active scene */}
                      {isCurrent && isBackingOff && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-amber-700/40 text-amber-300 hover:bg-amber-900/30 gap-1"
                          disabled={controlMutation.isPending}
                          onClick={() => controlMutation.mutate('retry')}
                        >
                          <RotateCw className="h-3 w-3" />
                          Now
                        </Button>
                      )}

                      {/* Thumbnail for completed clips */}
                      {clip.status === 'completed' && clip.videoUrl && (
                        <video
                          src={resolveIpfsUrl(clip.videoUrl)}
                          className="h-10 w-16 rounded object-cover shrink-0"
                          muted
                          preload="metadata"
                        />
                      )}

                      {/* Error message */}
                      {clip.status === 'failed' && !isAwaiting && clip.error && (
                        <span
                          className="text-xs text-red-400 truncate max-w-[150px]"
                          title={clip.error}
                        >
                          {clip.error.slice(0, 40)}
                        </span>
                      )}
                    </div>
                  );
                })}
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

            {isJobActive && !awaitingIntervention && (
              <Button
                size="sm"
                variant="outline"
                className="border-red-800/50 text-red-300 hover:bg-red-950/40 gap-1.5"
                disabled={controlMutation.isPending}
                onClick={() => controlMutation.mutate('abort')}
              >
                <StopCircle className="h-4 w-4" />
                Abort job
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
