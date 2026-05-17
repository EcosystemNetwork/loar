/**
 * Voice Studio — Captions tab.
 *
 * Custom caption pipeline:
 *   1. Paste an audio/video URL (or a Voice Studio output URL).
 *   2. Run transcription (FAL Whisper) → editable timestamped segments.
 *   3. Edit segments inline: retime, reword, label speakers, split, merge, delete.
 *   4. Apply style options (max chars/line, max lines/cue, merge-gap, speaker labels).
 *   5. Preview shaped cues + export SRT/VTT/JSON, save the project for later.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Captions,
  Loader2,
  Plus,
  Trash2,
  Split,
  Merge,
  Save,
  Download,
  FileText,
  Wand2,
  Cpu,
  Lock,
  ExternalLink,
  Users,
  Type,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';

interface CaptionsPanelProps {
  episodeId?: string;
}

interface CaptionWord {
  start: number;
  end: number;
  text: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  words?: CaptionWord[];
}

interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  shortDescription: string;
  capabilities: {
    wordTimings: boolean;
    diarize: boolean;
    translate: boolean;
  };
  priceTier: string;
  speedTier: string;
  qualityTier: string;
  creditCostPerMinute: number;
  usableByMe: boolean;
  unusableReason: string | null;
  sourceOnDispatch: 'byok' | 'server' | null;
}

const DEFAULT_MODEL_ID = 'whisper-fal';

interface StyleState {
  maxCharsPerLine: number;
  maxLinesPerCue: number;
  mergeGapSeconds: number;
  includeSpeakerLabels: boolean;
}

const DEFAULT_STYLE: StyleState = {
  maxCharsPerLine: 42,
  maxLinesPerCue: 2,
  mergeGapSeconds: 0,
  includeSpeakerLabels: false,
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function parseTime(input: string, fallback: number): number {
  // Accept "ss.mmm", "mm:ss.mmm", or "mm:ss,mmm" (SRT-style).
  const cleaned = input.trim().replace(',', '.');
  if (!cleaned) return fallback;
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return fallback;
    return minutes * 60 + seconds;
  }
  const num = Number(cleaned);
  return Number.isNaN(num) ? fallback : num;
}

export function CaptionsPanel({ episodeId }: CaptionsPanelProps) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('Untitled captions');
  const [sourceUrl, setSourceUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [style, setStyle] = useState<StyleState>(DEFAULT_STYLE);
  const [dirty, setDirty] = useState(false);
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [expectedMinutes, setExpectedMinutes] = useState<number>(1);
  const [wantWordTimings, setWantWordTimings] = useState(false);
  const [wantDiarize, setWantDiarize] = useState(false);
  const [numSpeakers, setNumSpeakers] = useState<number | ''>('');
  const [targetLangs, setTargetLangs] = useState<string[]>([]);
  const [exportLang, setExportLang] = useState<string>('');

  // ── Server queries ────────────────────────────────────────────────

  const modelsQuery = useQuery({
    queryKey: ['providers', 'listModels'],
    queryFn: () => trpcClient.providers.listModels.query(),
    staleTime: 5 * 60_000,
  });

  const supportedLangsQuery = useQuery({
    queryKey: ['captions', 'listSupportedLanguages'],
    queryFn: () => trpcClient.captions.listSupportedLanguages.query(),
    staleTime: 60 * 60_000,
  });

  const projectsQuery = useQuery({
    queryKey: ['captions', 'list', episodeId],
    queryFn: () => trpcClient.captions.list.query({ limit: 50, episodeId }),
  });

  const loadedQuery = useQuery({
    queryKey: ['captions', 'get', projectId],
    queryFn: () =>
      projectId
        ? trpcClient.captions.get.query({ captionProjectId: projectId })
        : Promise.resolve(null),
    enabled: !!projectId,
  });

  useEffect(() => {
    const p = loadedQuery.data;
    if (!p) return;
    setTitle(p.title ?? 'Untitled captions');
    setSourceUrl(p.sourceUrl ?? '');
    setLanguage(p.language ?? 'en');
    setSegments((p.segments as Segment[]) ?? []);
    if (p.style && typeof p.style === 'object') {
      setStyle({ ...DEFAULT_STYLE, ...(p.style as Partial<StyleState>) });
    }
    setDirty(false);
  }, [loadedQuery.data]);

  // ── Mutations ─────────────────────────────────────────────────────

  const transcribe = useMutation({
    mutationFn: () => {
      const selected = (modelsQuery.data ?? []).find((m) => m.id === modelId);
      return trpcClient.captions.transcribe.mutate({
        sourceUrl: sourceUrl.trim(),
        language: language || undefined,
        title,
        episodeId,
        modelId,
        expectedMinutes: expectedMinutes > 0 ? expectedMinutes : undefined,
        wordTimings: wantWordTimings && (selected?.capabilities.wordTimings ?? false),
        diarize: wantDiarize && (selected?.capabilities.diarize ?? false),
        numSpeakers:
          wantDiarize && typeof numSpeakers === 'number' && numSpeakers > 0
            ? numSpeakers
            : undefined,
      });
    },
    onSuccess: (res) => {
      setProjectId(res.captionProjectId);
      setSegments(res.segments as Segment[]);
      setDirty(false);
      const byokTag = res.byok ? ' · BYOK' : '';
      toast.success(
        `Transcribed ${res.segments.length} segment(s) · ${res.creditsCharged} credits${byokTag}`
      );
      queryClient.invalidateQueries({ queryKey: ['captions', 'list'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Transcription failed'),
  });

  const translate = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('Transcribe first');
      if (targetLangs.length === 0) throw new Error('Pick at least one target language');
      return trpcClient.captions.translate.mutate({
        captionProjectId: projectId,
        targetLanguages: targetLangs,
      });
    },
    onSuccess: (res) => {
      toast.success(
        `Translated to ${Object.keys(res.translations).length} language(s) · ${res.charged} credits`
      );
      queryClient.invalidateQueries({ queryKey: ['captions', 'get', projectId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Translation failed'),
  });

  const toggleTargetLang = (code: string) =>
    setTargetLangs((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const availableTranslations = useMemo(() => {
    const p = loadedQuery.data as Record<string, unknown> | null | undefined;
    return Array.isArray(p?.availableTranslations) ? (p?.availableTranslations as string[]) : [];
  }, [loadedQuery.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('No project to save — transcribe first');
      return trpcClient.captions.save.mutate({
        captionProjectId: projectId,
        segments,
        title,
        style,
      });
    },
    onSuccess: () => {
      setDirty(false);
      toast.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['captions', 'list'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const render = useMutation({
    mutationFn: (format: 'srt' | 'vtt' | 'json') =>
      trpcClient.captions.render.mutate({ segments, format, style }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => trpcClient.captions.delete.mutate({ captionProjectId: id }),
    onSuccess: () => {
      if (projectId) setProjectId(null);
      setSegments([]);
      setTitle('Untitled captions');
      setSourceUrl('');
      queryClient.invalidateQueries({ queryKey: ['captions', 'list'] });
      toast.success('Deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Segment editing ───────────────────────────────────────────────

  const mutateSegments = (next: Segment[]) => {
    setSegments(next);
    setDirty(true);
  };

  const updateSegment = (i: number, patch: Partial<Segment>) => {
    mutateSegments(segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const deleteSegment = (i: number) => mutateSegments(segments.filter((_, idx) => idx !== i));

  const splitSegment = (i: number) => {
    const seg = segments[i];
    if (!seg) return;
    const mid = (seg.start + seg.end) / 2;
    const words = seg.text.split(/\s+/);
    const half = Math.max(1, Math.floor(words.length / 2));
    const a: Segment = { ...seg, end: mid, text: words.slice(0, half).join(' ') };
    const b: Segment = { ...seg, start: mid, text: words.slice(half).join(' ') };
    mutateSegments([...segments.slice(0, i), a, b, ...segments.slice(i + 1)]);
  };

  const mergeWithNext = (i: number) => {
    const a = segments[i];
    const b = segments[i + 1];
    if (!a || !b) return;
    const merged: Segment = {
      start: a.start,
      end: b.end,
      text: `${a.text} ${b.text}`.trim(),
      speaker: a.speaker ?? b.speaker ?? null,
    };
    mutateSegments([...segments.slice(0, i), merged, ...segments.slice(i + 2)]);
  };

  const addSegment = () => {
    const last = segments[segments.length - 1];
    const start = last ? last.end : 0;
    mutateSegments([...segments, { start, end: start + 2, text: '', speaker: null }]);
  };

  // ── Export ────────────────────────────────────────────────────────

  async function segmentsForExport(): Promise<Segment[]> {
    if (!exportLang) return segments;
    if (!projectId) return segments;
    try {
      const tr = await trpcClient.captions.getTranslation.query({
        captionProjectId: projectId,
        targetLanguage: exportLang,
      });
      return tr.segments as Segment[];
    } catch {
      toast.error('No translation for this language yet — run Translate first');
      return segments;
    }
  }

  const downloadAs = async (format: 'srt' | 'vtt' | 'json') => {
    if (segments.length === 0) {
      toast.error('Nothing to export — add segments first');
      return;
    }
    try {
      const segs = await segmentsForExport();
      const res = await trpcClient.captions.render.mutate({ segments: segs, format, style });
      const mime = format === 'json' ? 'application/json' : 'text/plain';
      const blob = new Blob([res.rendered], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const langSuffix = exportLang ? `.${exportLang}` : '';
      const safeTitle = title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'captions';
      a.download = `${safeTitle}${langSuffix}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Render failed');
    }
  };

  // ── Computed ──────────────────────────────────────────────────────

  const totalChars = useMemo(() => segments.reduce((n, s) => n + s.text.length, 0), [segments]);
  const totalDuration = useMemo(() => {
    if (segments.length === 0) return 0;
    return segments[segments.length - 1].end - segments[0].start;
  }, [segments]);

  const selectedModel: ModelInfo | undefined = useMemo(
    () => (modelsQuery.data ?? []).find((m) => m.id === modelId) as ModelInfo | undefined,
    [modelsQuery.data, modelId]
  );

  const isByokDispatch = selectedModel?.sourceOnDispatch === 'byok';

  const estimatedCredits = useMemo(() => {
    if (!selectedModel) return null;
    if (isByokDispatch) return 1;
    const mins = Math.max(1, expectedMinutes || 1);
    return Math.ceil(selectedModel.creditCostPerMinute * mins);
  }, [selectedModel, isByokDispatch, expectedMinutes]);

  const transcribeButtonLabel =
    estimatedCredits === null
      ? 'Transcribe'
      : isByokDispatch
        ? `Transcribe (${estimatedCredits} credit · BYOK)`
        : `Transcribe (~${estimatedCredits} credits)`;

  const canTranscribe =
    sourceUrl.trim().length > 0 &&
    !transcribe.isPending &&
    !!selectedModel &&
    selectedModel.usableByMe;

  // Capability auto-disable
  useEffect(() => {
    if (!selectedModel) return;
    if (wantWordTimings && !selectedModel.capabilities.wordTimings) setWantWordTimings(false);
    if (wantDiarize && !selectedModel.capabilities.diarize) setWantDiarize(false);
  }, [selectedModel, wantWordTimings, wantDiarize]);

  return (
    <div className="space-y-5">
      {/* ── Source + load existing ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Captions className="size-4 text-sky-400" /> Custom Caption Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="caption-title">Project title</Label>
              <Input
                id="caption-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                placeholder="Episode 3 — final pass"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="caption-load">Load existing</Label>
              <select
                id="caption-load"
                className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
                value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value || null)}
              >
                <option value="">— New project —</option>
                {(projectsQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.segmentCount} cues · {p.status})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="caption-source">Audio or video URL</Label>
              <Input
                id="caption-source"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://… (mp3, wav, mp4)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="caption-lang">Language</Label>
              <Input
                id="caption-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="en"
                maxLength={10}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="opacity-0">.</Label>
              <Button onClick={() => transcribe.mutate()} disabled={!canTranscribe}>
                {transcribe.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 size-4" />
                )}
                {transcribeButtonLabel}
              </Button>
            </div>
          </div>

          {projectId && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{projectId.slice(0, 8)}</Badge>
              <span>·</span>
              <span>{segments.length} cues</span>
              <span>·</span>
              <span>{totalChars.toLocaleString()} chars</span>
              <span>·</span>
              <span>{formatTime(totalDuration)} total</span>
              {dirty && <Badge variant="secondary">unsaved</Badge>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={!dirty}>
                  {save.isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => projectId && remove.mutate(projectId)}
                >
                  <Trash2 className="mr-2 size-4" /> Delete
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Model picker ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="size-4 text-violet-400" /> Model
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[2fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="caption-model">Transcription model</Label>
              <select
                id="caption-model"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={modelsQuery.isPending}
              >
                {(modelsQuery.data ?? []).map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.usableByMe}>
                    {m.displayName}
                    {m.usableByMe ? '' : ' · API key required'}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expected-minutes">Expected length (min)</Label>
              <Input
                id="expected-minutes"
                type="number"
                min={1}
                max={240}
                value={expectedMinutes}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setExpectedMinutes(Number.isFinite(v) && v > 0 ? Math.min(240, v) : 1);
                }}
              />
            </div>
          </div>

          {selectedModel && (
            <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {selectedModel.provider}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {selectedModel.qualityTier}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {selectedModel.speedTier}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {selectedModel.priceTier} price
                </Badge>
                {selectedModel.capabilities.wordTimings && (
                  <Badge variant="secondary">
                    <Type className="mr-1 size-3" /> word timings
                  </Badge>
                )}
                {selectedModel.capabilities.diarize && (
                  <Badge variant="secondary">
                    <Users className="mr-1 size-3" /> diarization
                  </Badge>
                )}
                {isByokDispatch && (
                  <Badge variant="secondary">
                    <Lock className="mr-1 size-3" /> using your key
                  </Badge>
                )}
                <span className="ml-auto text-muted-foreground">
                  {selectedModel.creditCostPerMinute} credits / min
                </span>
              </div>
              <p className="text-muted-foreground">{selectedModel.shortDescription}</p>
              {!selectedModel.usableByMe && (
                <p className="flex items-center gap-1 text-amber-500">
                  {selectedModel.unusableReason}
                  <a
                    href="/settings/api-keys"
                    className="ml-1 inline-flex items-center gap-1 underline"
                  >
                    Add key <ExternalLink className="size-3" />
                  </a>
                </p>
              )}
            </div>
          )}

          {selectedModel?.capabilities.wordTimings && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="want-word-timings"
                checked={wantWordTimings}
                onCheckedChange={(v) => setWantWordTimings(v === true)}
              />
              <Label htmlFor="want-word-timings" className="text-xs">
                Word-level timings (karaoke-style highlight in VTT)
              </Label>
            </div>
          )}
          {selectedModel?.capabilities.diarize && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="want-diarize"
                  checked={wantDiarize}
                  onCheckedChange={(v) => setWantDiarize(v === true)}
                />
                <Label htmlFor="want-diarize" className="text-xs">
                  Detect speakers
                </Label>
              </div>
              {wantDiarize && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="num-speakers" className="text-xs text-muted-foreground">
                    Hint: # of speakers
                  </Label>
                  <Input
                    id="num-speakers"
                    type="number"
                    min={1}
                    max={20}
                    value={numSpeakers}
                    onChange={(e) =>
                      setNumSpeakers(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="h-7 w-20 text-xs"
                    placeholder="auto"
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Style controls ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cue style</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-xs">
              Max chars / line · <span className="font-mono">{style.maxCharsPerLine}</span>
            </Label>
            <Slider
              min={20}
              max={80}
              step={1}
              value={[style.maxCharsPerLine]}
              onValueChange={([v]) => {
                setStyle({ ...style, maxCharsPerLine: v });
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">
              Max lines / cue · <span className="font-mono">{style.maxLinesPerCue}</span>
            </Label>
            <Slider
              min={1}
              max={4}
              step={1}
              value={[style.maxLinesPerCue]}
              onValueChange={([v]) => {
                setStyle({ ...style, maxLinesPerCue: v });
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">
              Merge gap (s) · <span className="font-mono">{style.mergeGapSeconds.toFixed(2)}</span>
            </Label>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[style.mergeGapSeconds]}
              onValueChange={([v]) => {
                setStyle({ ...style, mergeGapSeconds: v });
                setDirty(true);
              }}
            />
          </div>
          <div className="flex items-end gap-2">
            <Checkbox
              id="speaker-labels"
              checked={style.includeSpeakerLabels}
              onCheckedChange={(v) => {
                setStyle({ ...style, includeSpeakerLabels: v === true });
                setDirty(true);
              }}
            />
            <Label htmlFor="speaker-labels" className="text-xs">
              Inline speaker labels
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* ── Segment editor ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Segments</CardTitle>
          <Button size="sm" variant="outline" onClick={addSegment}>
            <Plus className="mr-1 size-3.5" /> Add cue
          </Button>
        </CardHeader>
        <CardContent>
          {segments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No segments yet. Paste a source URL and transcribe, or add a cue manually.
            </p>
          ) : (
            <div className="space-y-2">
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-md border border-border/60 p-2 md:grid-cols-[90px_90px_140px_1fr_auto]"
                >
                  <Input
                    aria-label="Start"
                    value={formatTime(seg.start)}
                    onChange={(e) =>
                      updateSegment(i, { start: parseTime(e.target.value, seg.start) })
                    }
                    className="h-9 font-mono text-xs"
                  />
                  <Input
                    aria-label="End"
                    value={formatTime(seg.end)}
                    onChange={(e) => updateSegment(i, { end: parseTime(e.target.value, seg.end) })}
                    className="h-9 font-mono text-xs"
                  />
                  <Input
                    aria-label="Speaker"
                    value={seg.speaker ?? ''}
                    onChange={(e) => updateSegment(i, { speaker: e.target.value || null })}
                    placeholder="Speaker"
                    className="h-9 text-xs"
                  />
                  <Textarea
                    value={seg.text}
                    onChange={(e) => updateSegment(i, { text: e.target.value })}
                    rows={2}
                    className="min-h-[36px] text-sm"
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Split at midpoint"
                      onClick={() => splitSegment(i)}
                    >
                      <Split className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Merge with next"
                      disabled={i === segments.length - 1}
                      onClick={() => mergeWithNext(i)}
                    >
                      <Merge className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Delete cue"
                      onClick={() => deleteSegment(i)}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Translation ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Captions className="size-4 text-emerald-400" /> Translate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!projectId ? (
            <p className="text-xs text-muted-foreground">
              Transcribe first, then pick target languages to add translated tracks.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {(supportedLangsQuery.data ?? []).map((code) => {
                  const isSelected = targetLangs.includes(code);
                  const isAvailable = availableTranslations.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleTargetLang(code)}
                      className={
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ' +
                        (isSelected
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                          : 'border-border/60 hover:bg-muted')
                      }
                    >
                      {code}
                      {isAvailable && <Badge variant="outline">ready</Badge>}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => translate.mutate()}
                  disabled={!projectId || translate.isPending || targetLangs.length === 0}
                >
                  {translate.isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 size-4" />
                  )}
                  Translate ({targetLangs.length * 2} credits)
                </Button>
                <p className="text-xs text-muted-foreground">
                  2 credits per target language · Gemini · timing preserved, word arrays dropped
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Export ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="size-4" /> Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {availableTranslations.length > 0 && (
            <div className="flex items-center gap-2">
              <Label htmlFor="export-lang" className="text-xs">
                Language
              </Label>
              <select
                id="export-lang"
                value={exportLang}
                onChange={(e) => setExportLang(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Source</option>
                {availableTranslations.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => downloadAs('srt')} disabled={segments.length === 0}>
              <Download className="mr-2 size-4" /> SRT
            </Button>
            <Button onClick={() => downloadAs('vtt')} disabled={segments.length === 0}>
              <Download className="mr-2 size-4" /> WebVTT
            </Button>
            <Button onClick={() => downloadAs('json')} disabled={segments.length === 0}>
              <Download className="mr-2 size-4" /> JSON
            </Button>
            <p className="ml-auto text-xs text-muted-foreground self-center">
              Style settings shape the export before download.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
