/**
 * Voice Studio — Script Editor tab.
 *
 * Script-first dubbing UI. Build a dialogue script line-by-line, assign a
 * voice to each line (drawn from My Voices + Library), generate per-line TTS
 * (or batch all), and trigger composite onto a base video.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Play,
  Pause,
  Loader2,
  Sparkles,
  Wand2,
  Film,
  FileText,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  DubbingProject,
  ScriptLine,
  MyVoice,
  LibraryVoice,
  ElevenLabsVoiceModelId,
} from './voice-studio.types';

const MODEL_OPTIONS: Array<{ id: ElevenLabsVoiceModelId; label: string }> = [
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 — fast' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { id: 'eleven_turbo_v2', label: 'Turbo v2' },
  { id: 'eleven_v3', label: 'v3 — best emotion' },
];

interface ScriptEditorProps {
  episodeId?: string;
  initialProjectId?: string;
}

export function ScriptEditor({ episodeId, initialProjectId }: ScriptEditorProps) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [draftText, setDraftText] = useState('');
  const [draftVoiceId, setDraftVoiceId] = useState('');
  const [draftCharacter, setDraftCharacter] = useState('');
  const [playingLineId, setPlayingLineId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // ── Load voice pool (My Voices + ~30 from library for quick cast) ──
  const { data: myVoices } = useQuery({
    queryKey: ['voiceLibrary', 'myVoices'],
    queryFn: () => trpcClient.voiceLibrary.myVoices.query({}),
  });
  const { data: libraryVoices } = useQuery({
    queryKey: ['voiceLibrary', 'list', 'script-editor'],
    queryFn: () => trpcClient.voiceLibrary.list.query({ limit: 60 }),
  });

  const voicePool: Array<{ voiceId: string; name: string; source: string }> = [];
  for (const v of (myVoices ?? []) as MyVoice[]) {
    voicePool.push({ voiceId: v.voiceId, name: `${v.name} (mine)`, source: 'mine' });
  }
  for (const v of (libraryVoices ?? []) as LibraryVoice[]) {
    if (voicePool.some((p) => p.voiceId === v.voiceId)) continue;
    voicePool.push({ voiceId: v.voiceId, name: v.name, source: 'library' });
  }

  // ── Project ────────────────────────────────────────────────────────
  const { data: project, refetch: refetchProject } = useQuery({
    queryKey: ['dubbing', 'project', projectId],
    queryFn: () =>
      projectId ? trpcClient.dubbing.get.query({ jobId: projectId }) : Promise.resolve(null),
    enabled: !!projectId,
  });

  const createProject = useMutation({
    mutationFn: () =>
      trpcClient.dubbing.createProject.mutate({
        episodeId,
        title: episodeId ? `Episode dub` : 'Untitled dub',
        scriptLines: [],
      }),
    onSuccess: (res) => {
      setProjectId(res.jobId);
      toast.success('Project created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (!projectId && !createProject.isPending) {
      createProject.mutate();
    }
    // intentionally only on mount + when episodeId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  const addLine = useMutation({
    mutationFn: (line: { text: string; voiceId: string; characterName?: string }) =>
      trpcClient.dubbing.addLine.mutate({
        jobId: projectId!,
        line: {
          text: line.text,
          voiceId: line.voiceId,
          characterName: line.characterName || undefined,
        },
      }),
    onSuccess: () => {
      setDraftText('');
      setDraftCharacter('');
      refetchProject();
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

  const removeLine = useMutation({
    mutationFn: (lineId: string) =>
      trpcClient.dubbing.removeLine.mutate({ jobId: projectId!, lineId }),
    onSuccess: () => refetchProject(),
    onError: (err: Error) => toast.error(err.message),
  });

  const genLine = useMutation({
    mutationFn: (lineId: string) =>
      trpcClient.dubbing.generateLine.mutate({ jobId: projectId!, lineId }),
    onSuccess: () => refetchProject(),
    onError: (err: Error) => toast.error(err.message),
  });

  const genAll = useMutation({
    mutationFn: () => trpcClient.dubbing.generateAll.mutate({ jobId: projectId! }),
    onSuccess: (res) => {
      toast.success(`Generated ${res.generated} line(s), ${res.failed} failed`);
      refetchProject();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const composite = useMutation({
    mutationFn: (mode: 'mux' | 'lipsync') =>
      trpcClient.dubbing.composite.mutate({ jobId: projectId!, mode }),
    onSuccess: (res) => {
      toast.success(res.finalVideoUrl ? 'Video composited' : 'Audio merged');
      refetchProject();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateProject = useMutation({
    mutationFn: (patch: { baseVideoUrl?: string | null; title?: string }) =>
      trpcClient.dubbing.update.mutate({ jobId: projectId!, ...patch }),
    onSuccess: () => refetchProject(),
    onError: (err: Error) => toast.error(err.message),
  });

  function playLine(line: ScriptLine) {
    if (!line.audioUrl) return;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    if (playingLineId === line.id) {
      setPlayingLineId(null);
      return;
    }
    const a = new Audio(line.audioUrl);
    a.onended = () => setPlayingLineId(null);
    a.play().catch((e) => toast.error(`Playback failed: ${e.message}`));
    setAudioEl(a);
    setPlayingLineId(line.id);
  }

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">Creating project…</p>;
  }

  const proj = project as DubbingProject | null;
  const lines: ScriptLine[] = proj?.scriptLines ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* ── Project header ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="grow min-w-[200px]">
            <Label htmlFor="dub-title">Project title</Label>
            <Input
              id="dub-title"
              value={proj?.title ?? ''}
              onChange={(e) => updateProject.mutate({ title: e.target.value })}
              placeholder="Episode 1 — pilot dub"
            />
          </div>
          <div className="grow min-w-[260px]">
            <Label htmlFor="dub-base">Base video URL (optional)</Label>
            <Input
              id="dub-base"
              value={proj?.baseVideoUrl ?? ''}
              onChange={(e) => updateProject.mutate({ baseVideoUrl: e.target.value || null })}
              placeholder="https://… episode mp4"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => genAll.mutate()}
              disabled={genAll.isPending || lines.length === 0}
            >
              {genAll.isPending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 size-3.5" />
              )}
              Generate all
            </Button>
            <Button
              variant="outline"
              onClick={() => composite.mutate('mux')}
              disabled={composite.isPending}
              title="Replace audio track on base video (fast)"
            >
              <Film className="mr-1.5 size-3.5" />
              Composite (mux)
            </Button>
            <Button
              variant="outline"
              onClick={() => composite.mutate('lipsync')}
              disabled={composite.isPending}
              title="Run FAL lip-sync (slower, mouth-aware)"
            >
              <Wand2 className="mr-1.5 size-3.5" />
              Lip-sync composite
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Add line ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" /> Add a line
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="md:col-span-1">
              <Label className="text-xs">Character (optional)</Label>
              <Input
                value={draftCharacter}
                onChange={(e) => setDraftCharacter(e.target.value)}
                placeholder="e.g., Mara"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Voice</Label>
              <Select value={draftVoiceId} onValueChange={setDraftVoiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a voice…" />
                </SelectTrigger>
                <SelectContent>
                  {voicePool.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No voices yet — save from Library or clone one
                    </SelectItem>
                  ) : (
                    voicePool.map((v) => (
                      <SelectItem key={v.voiceId} value={v.voiceId}>
                        {v.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Line of dialogue…"
            rows={2}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() =>
                addLine.mutate({
                  text: draftText.trim(),
                  voiceId: draftVoiceId,
                  characterName: draftCharacter.trim() || undefined,
                })
              }
              disabled={
                !draftText.trim() || !draftVoiceId || addLine.isPending || draftVoiceId === '__none'
              }
            >
              {addLine.isPending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-3.5" />
              )}
              Add line
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Lines ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> Script ({lines.length} line
            {lines.length === 1 ? '' : 's'})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lines yet. Add one above.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line, i) => (
                <LineRow
                  key={line.id}
                  index={i}
                  line={line}
                  voicePool={voicePool}
                  playing={playingLineId === line.id}
                  onPlay={() => playLine(line)}
                  onUpdate={(patch) => updateLine.mutate({ lineId: line.id, patch })}
                  onRemove={() => removeLine.mutate(line.id)}
                  onGenerate={() => genLine.mutate(line.id)}
                  busy={genLine.isPending && genLine.variables === line.id}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Result ────────────────────────────────────────────────────── */}
      {proj?.finalVideoUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Final composite</CardTitle>
          </CardHeader>
          <CardContent>
            <video controls src={proj.finalVideoUrl} className="w-full rounded" />
          </CardContent>
        </Card>
      ) : proj?.mergedAudioUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Merged dialogue track</CardTitle>
          </CardHeader>
          <CardContent>
            <audio controls src={proj.mergedAudioUrl} className="w-full" />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function LineRow({
  index,
  line,
  voicePool,
  playing,
  onPlay,
  onUpdate,
  onRemove,
  onGenerate,
  busy,
}: {
  index: number;
  line: ScriptLine;
  voicePool: Array<{ voiceId: string; name: string }>;
  playing: boolean;
  onPlay: () => void;
  onUpdate: (patch: Partial<ScriptLine>) => void;
  onRemove: () => void;
  onGenerate: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(line.text);
  // Local knob shadows — committed on blur / Generate / model change so we
  // don't write to Firestore on every slider tick.
  const [stabilityLocal, setStabilityLocal] = useState(line.stability ?? 0.5);
  const [styleLocal, setStyleLocal] = useState(line.style ?? 0);
  useEffect(() => setText(line.text), [line.text]);
  useEffect(() => setStabilityLocal(line.stability ?? 0.5), [line.stability]);
  useEffect(() => setStyleLocal(line.style ?? 0), [line.style]);
  function commitKnobs() {
    const patch: Partial<ScriptLine> = {};
    if (stabilityLocal !== (line.stability ?? 0.5)) patch.stability = stabilityLocal;
    if (styleLocal !== (line.style ?? 0)) patch.style = styleLocal;
    if (Object.keys(patch).length > 0) onUpdate(patch);
  }

  return (
    <li className="rounded border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="w-7 shrink-0 pt-1 text-xs text-muted-foreground">{index + 1}</div>
        <div className="grow">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            {line.characterName ? <Badge variant="secondary">{line.characterName}</Badge> : null}
            <Badge variant="outline" className="font-mono">
              {voicePool.find((v) => v.voiceId === line.voiceId)?.name ?? line.voiceId.slice(0, 8)}
            </Badge>
            <StatusBadge status={line.status} />
            {line.error ? <span className="text-[10px] text-destructive">{line.error}</span> : null}
          </div>
          {editing ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (text !== line.text) onUpdate({ text });
              }}
              autoFocus
              rows={2}
              className="text-sm"
            />
          ) : (
            <p
              className="cursor-text text-sm"
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {line.text}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex gap-1">
            {line.audioUrl ? (
              <Button size="icon" variant="ghost" onClick={onPlay} className="size-7">
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              onClick={onGenerate}
              disabled={busy}
              className="size-7"
              title={line.audioUrl ? 'Regenerate' : 'Generate'}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : line.audioUrl ? (
                <RefreshCcw className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
            </Button>
            <Button size="icon" variant="ghost" onClick={onRemove} className="size-7">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Select value={line.voiceId} onValueChange={(v) => onUpdate({ voiceId: v })}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
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
      </div>

      {/* Per-line TTS knobs */}
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div>
          <Label className="text-[10px] text-muted-foreground">Model</Label>
          <Select
            value={line.model ?? 'eleven_flash_v2_5'}
            onValueChange={(v) => onUpdate({ model: v as ElevenLabsVoiceModelId })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div onPointerUp={commitKnobs}>
          <Label className="text-[10px] text-muted-foreground">
            Stability: {stabilityLocal.toFixed(2)}
          </Label>
          <Slider
            value={[stabilityLocal]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={(v) => setStabilityLocal(v[0])}
          />
        </div>
        <div onPointerUp={commitKnobs}>
          <Label className="text-[10px] text-muted-foreground">
            Style: {styleLocal.toFixed(2)}
          </Label>
          <Slider
            value={[styleLocal]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={(v) => setStyleLocal(v[0])}
          />
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: ScriptLine['status'] }) {
  switch (status) {
    case 'ready':
      return (
        <Badge variant="outline" className="gap-1 text-[10px] text-emerald-500">
          <CheckCircle2 className="size-3" /> ready
        </Badge>
      );
    case 'generating':
      return (
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Loader2 className="size-3 animate-spin" /> generating
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="gap-1 text-[10px] text-destructive">
          <AlertCircle className="size-3" /> failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px]">
          pending
        </Badge>
      );
  }
}
