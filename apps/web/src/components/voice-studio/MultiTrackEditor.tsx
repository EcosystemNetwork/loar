/**
 * Voice Studio — Multi-Track Editor tab.
 *
 * Pro-grade multi-track view of a dubbing project:
 *   • Top: optional reference video player + timeline ruler
 *   • Below: one dialogue lane per character, all aligned to seconds
 *   • Each generated line renders as a waveform region (see WaveformLane.tsx)
 *
 * Operations on a selected region:
 *   • Regenerate (re-runs TTS with the same voice/text)
 *   • Replace voice (dropdown of voicePool)
 *   • Edit text
 *   • Adjust start time
 *   • Delete
 *
 * For v1, lane-level mixed playback is delegated to the existing
 * `dubbing.composite({mode:'mux'})` server step — click "Preview mix" to
 * re-merge + listen. Per-region playback works inline.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  Play,
  Pause,
  RefreshCcw,
  Trash2,
  Volume2,
  Layers,
  Wand2,
  Film,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WaveformLane, type LaneRegion } from './WaveformLane';
import type { DubbingProject, ScriptLine, MyVoice, LibraryVoice } from './voice-studio.types';

const LANE_COLORS = [
  'bg-sky-500/30',
  'bg-violet-500/30',
  'bg-emerald-500/30',
  'bg-amber-500/30',
  'bg-rose-500/30',
  'bg-cyan-500/30',
  'bg-fuchsia-500/30',
  'bg-orange-500/30',
];

interface MultiTrackEditorProps {
  projectId?: string;
  onSelectProject?: (id: string) => void;
}

export function MultiTrackEditor({ projectId, onSelectProject }: MultiTrackEditorProps) {
  const queryClient = useQueryClient();
  const [pxPerSec, setPxPerSec] = useState(40);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: projects } = useQuery({
    queryKey: ['dubbing', 'list'],
    queryFn: () => trpcClient.dubbing.list.query({ limit: 50 }),
    enabled: !projectId,
  });

  const { data: project, refetch: refetchProject } = useQuery({
    queryKey: ['dubbing', 'project', projectId],
    queryFn: () =>
      projectId ? trpcClient.dubbing.get.query({ jobId: projectId }) : Promise.resolve(null),
    enabled: !!projectId,
  });

  const { data: myVoices } = useQuery({
    queryKey: ['voiceLibrary', 'myVoices'],
    queryFn: () => trpcClient.voiceLibrary.myVoices.query({}),
  });
  const { data: libraryVoices } = useQuery({
    queryKey: ['voiceLibrary', 'list', 'multitrack'],
    queryFn: () => trpcClient.voiceLibrary.list.query({ limit: 60 }),
  });
  const voicePool: Array<{ voiceId: string; name: string }> = useMemo(() => {
    const pool: Array<{ voiceId: string; name: string }> = [];
    for (const v of (myVoices ?? []) as MyVoice[])
      pool.push({ voiceId: v.voiceId, name: `${v.name} (mine)` });
    for (const v of (libraryVoices ?? []) as LibraryVoice[]) {
      if (!pool.some((p) => p.voiceId === v.voiceId))
        pool.push({ voiceId: v.voiceId, name: v.name });
    }
    return pool;
  }, [myVoices, libraryVoices]);

  const proj = project as DubbingProject | null;
  const lines: ScriptLine[] = useMemo(() => proj?.scriptLines ?? [], [proj]);

  // ── Build lanes (grouped by characterName, fallback to voiceId) ───
  const { lanes, totalDuration } = useMemo(() => {
    const laneMap = new Map<string, { label: string; lines: ScriptLine[] }>();
    let cursor = 0;
    const positioned: Array<{ line: ScriptLine; startSec: number; durationSec: number }> = [];
    for (const line of lines) {
      const dur = line.audioDurationSec ?? estimateDurationSec(line.text);
      const start = line.startSec ?? cursor;
      cursor = Math.max(cursor, start + dur + 0.2);
      positioned.push({ line, startSec: start, durationSec: dur });
      const key = line.characterName || line.voiceId;
      if (!laneMap.has(key)) {
        laneMap.set(key, {
          label:
            line.characterName ||
            voicePool.find((v) => v.voiceId === line.voiceId)?.name ||
            line.voiceId.slice(0, 8),
          lines: [],
        });
      }
      laneMap.get(key)!.lines.push(line);
    }

    const lanes = Array.from(laneMap.entries()).map(([key, info], idx) => {
      const regions: LaneRegion[] = positioned
        .filter((p) => (p.line.characterName || p.line.voiceId) === key)
        .filter((p) => p.line.audioUrl)
        .map((p) => ({
          id: p.line.id,
          audioUrl: p.line.audioUrl!,
          startSec: p.startSec,
          durationSec: p.durationSec,
          label: p.line.text.slice(0, 40),
          status: p.line.status,
        }));
      return {
        key,
        label: info.label,
        color: LANE_COLORS[idx % LANE_COLORS.length],
        regions,
      };
    });

    return { lanes, totalDuration: Math.max(cursor, 30) };
  }, [lines, voicePool]);

  // ── Mutations ──────────────────────────────────────────────────────
  const updateLine = useMutation({
    mutationFn: (args: { lineId: string; patch: Partial<ScriptLine> }) =>
      trpcClient.dubbing.updateLine.mutate({
        jobId: projectId!,
        lineId: args.lineId,
        patch: args.patch as never,
      }),
    onSuccess: () => refetchProject(),
    onError: (err: Error) => toast.error(err.message),
  });
  const regenLine = useMutation({
    mutationFn: (lineId: string) =>
      trpcClient.dubbing.generateLine.mutate({ jobId: projectId!, lineId }),
    onSuccess: () => refetchProject(),
    onError: (err: Error) => toast.error(err.message),
  });
  const removeLine = useMutation({
    mutationFn: (lineId: string) =>
      trpcClient.dubbing.removeLine.mutate({ jobId: projectId!, lineId }),
    onSuccess: () => {
      setSelectedLineId(null);
      refetchProject();
    },
  });
  const composite = useMutation({
    mutationFn: (mode: 'mux' | 'lipsync') =>
      trpcClient.dubbing.composite.mutate({ jobId: projectId!, mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dubbing', 'project', projectId] });
      toast.success('Mix updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function playRegion(line: ScriptLine) {
    if (!line.audioUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (playingId === line.id) {
      setPlayingId(null);
      return;
    }
    const a = new Audio(line.audioUrl);
    a.onended = () => setPlayingId(null);
    a.play().catch((e) => toast.error(`Playback failed: ${e.message}`));
    audioRef.current = a;
    setPlayingId(line.id);
  }

  // ── No project chosen — pick / create ─────────────────────────────
  if (!projectId) {
    const list = (projects ?? []) as Array<{ id: string; title?: string }>;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4" /> Pick a project
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Create one in the Script Editor tab first.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((p) => (
                <li key={p.id}>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onSelectProject?.(p.id)}
                  >
                    {p.title || p.id}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  const selected = selectedLineId ? lines.find((l) => l.id === selectedLineId) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Transport */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{proj?.title}</span>
            <Badge variant="outline" className="capitalize">
              {proj?.status}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">Zoom</Label>
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(Number(e.target.value))}
              className="w-32"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => composite.mutate('mux')}
              disabled={composite.isPending}
            >
              {composite.isPending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Film className="mr-1.5 size-3.5" />
              )}
              Preview mix
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => composite.mutate('lipsync')}
              disabled={composite.isPending}
            >
              <Wand2 className="mr-1.5 size-3.5" />
              Lip-sync mix
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reference video */}
      {proj?.baseVideoUrl ? (
        <Card>
          <CardContent className="p-4">
            <video controls src={proj.baseVideoUrl} className="w-full rounded" />
          </CardContent>
        </Card>
      ) : null}

      {/* Lanes */}
      <Card>
        <CardContent className="p-0">
          {/* Time ruler */}
          <div className="flex">
            <div className="w-28 shrink-0 border-r border-border bg-card/50 px-2 py-1 text-[10px] text-muted-foreground">
              {totalDuration.toFixed(1)}s
            </div>
            <div
              className="relative h-5 grow overflow-x-auto border-b border-border bg-background"
              style={{ minWidth: Math.max(totalDuration * pxPerSec, 400) }}
            >
              {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, sec) => (
                <div
                  key={sec}
                  className="absolute top-0 h-full border-l border-border/60 text-[9px] text-muted-foreground"
                  style={{ left: sec * pxPerSec }}
                >
                  <span className="ml-0.5">{sec}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dialogue lanes */}
          {lanes.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No generated lines yet. Generate lines in the Script Editor tab.
            </div>
          ) : (
            lanes.map((lane) => (
              <WaveformLane
                key={lane.key}
                laneLabel={lane.label}
                color={lane.color}
                regions={lane.regions}
                pxPerSec={pxPerSec}
                totalDurationSec={totalDuration}
                selectedRegionId={selectedLineId ?? undefined}
                onSelectRegion={setSelectedLineId}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Final mix playback */}
      {proj?.finalVideoUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composite</CardTitle>
          </CardHeader>
          <CardContent>
            <video controls src={proj.finalVideoUrl} className="w-full rounded" />
          </CardContent>
        </Card>
      ) : proj?.mergedAudioUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mixed dialogue</CardTitle>
          </CardHeader>
          <CardContent>
            <audio controls src={proj.mergedAudioUrl} className="w-full" />
          </CardContent>
        </Card>
      ) : null}

      {/* Inspector */}
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Volume2 className="size-4" /> Region inspector
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <Label className="text-xs">Text</Label>
              <Textarea
                value={selected.text}
                onChange={(e) =>
                  updateLine.mutate({ lineId: selected.id, patch: { text: e.target.value } })
                }
                rows={2}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div>
                <Label className="text-xs">Voice</Label>
                <Select
                  value={selected.voiceId}
                  onValueChange={(v) =>
                    updateLine.mutate({ lineId: selected.id, patch: { voiceId: v } })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voicePool.map((v) => (
                      <SelectItem key={v.voiceId} value={v.voiceId}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Start (s)</Label>
                <Input
                  type="number"
                  step={0.1}
                  value={selected.startSec ?? 0}
                  onChange={(e) =>
                    updateLine.mutate({
                      lineId: selected.id,
                      patch: { startSec: Number(e.target.value) || 0 },
                    })
                  }
                  className="h-8"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playRegion(selected)}
                  disabled={!selected.audioUrl}
                >
                  {playingId === selected.id ? (
                    <Pause className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regenLine.mutate(selected.id)}
                  disabled={regenLine.isPending}
                >
                  {regenLine.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => removeLine.mutate(selected.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// Rough TTS duration estimate (~14 chars/sec for English natural speech).
function estimateDurationSec(text: string): number {
  return Math.max(0.5, text.length / 14);
}
