/**
 * LOAR Voice Director — talk to a universe and have the director act on it.
 *
 * Two modes:
 *   - Director: classify → canon answer (immediate) or story-action plan
 *     (shown for explicit confirm before it mutates anything / spends
 *     credits), wired to director.dispatch + director.executeStoryAction.
 *   - Talk to Character: pick a character, ask them something, they answer
 *     in character through their own Hume voice — director.talkToCharacter.
 *
 * Voice I/O here is record → upload → transcribe (batch), not a live
 * streaming session, so "Stop" cancels an in-flight recording or silences
 * playback rather than interrupting mid-generation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mic, Square, Loader2, Check, Sparkles, Users2 } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

type StoryActionKind = 'create_node' | 'branch_story' | 'update_node' | 'generate_scene';

interface StoryActionPlan {
  kind: StoryActionKind;
  summary: string;
  params: { title?: string; description?: string };
  spokenAck: string;
}

interface LogEntry {
  id: string;
  role: 'user' | 'director' | 'character';
  text: string;
}

interface StatusStep {
  id: string;
  label: string;
  done: boolean;
}

const ACTION_VERB: Record<StoryActionKind, string> = {
  create_node: 'Created story node',
  branch_story: 'Created branch',
  update_node: 'Updated scene',
  generate_scene: 'Queued scene generation',
};

// ── Mic recording ──────────────────────────────────────────────────────

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(
    (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
  );
}

function useMicRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    setIsRecording(true);
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') return resolve(null);
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        resolve(
          chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType }) : null
        );
      };
      recorder.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
    }
    chunksRef.current = [];
    setIsRecording(false);
  }, []);

  return { isRecording, start, stop, cancel };
}

async function uploadAudioBlob(blob: Blob): Promise<string> {
  const meRes = await fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' });
  if (!meRes.ok || !(await meRes.json())?.authenticated) {
    throw new Error('Session expired — please sign in again');
  }
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  const file = new File([blob], `voice-director-${Date.now()}.${ext}`, {
    type: blob.type || 'audio/webm',
  });
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${SERVER_URL}/api/upload`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || `Upload failed (${res.status})`);
  }
  const json = await res.json();
  const url: string | undefined = json?.manifest?.uploads?.[0]?.url;
  if (!url) throw new Error('Upload returned no URL');
  return url;
}

function playAudio(url: string | null | undefined, audioElRef: React.RefObject<HTMLAudioElement>) {
  if (!url || !audioElRef.current) return;
  audioElRef.current.src = url;
  audioElRef.current.play().catch(() => {});
}

// ── Panel ────────────────────────────────────────────────────────────

export function VoiceDirectorPanel({
  universeId,
  open,
  onOpenChange,
}: {
  universeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400">
            <Mic className="size-4" /> LOAR Voice Director
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Talk to this universe — ask about canon, or tell it what to create.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="director">
          <TabsList className="grid w-full grid-cols-2 bg-zinc-900">
            <TabsTrigger value="director" className="gap-1.5">
              <Sparkles className="size-3.5" /> Director
            </TabsTrigger>
            <TabsTrigger value="character" className="gap-1.5">
              <Users2 className="size-3.5" /> Talk to Character
            </TabsTrigger>
          </TabsList>
          <TabsContent value="director">
            <DirectorTab universeId={universeId} />
          </TabsContent>
          <TabsContent value="character">
            <CharacterTab universeId={universeId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Director tab ─────────────────────────────────────────────────────

function DirectorTab({ universeId }: { universeId: string }) {
  const { isRecording, start, stop, cancel } = useMicRecorder();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [steps, setSteps] = useState<StatusStep[]>([]);
  const [pendingAction, setPendingAction] = useState<StoryActionPlan | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);

  const addLog = (role: LogEntry['role'], text: string) =>
    setLog((l) => [...l, { id: `${Date.now()}-${role}`, role, text }]);

  const setStep = (id: string, label: string, done: boolean) =>
    setSteps((s) => {
      const rest = s.filter((x) => x.id !== id);
      return [...rest, { id, label, done }];
    });

  const handleStop = () => {
    if (isRecording) {
      cancel();
      return;
    }
    audioElRef.current?.pause();
  };

  const handleRecord = async () => {
    if (isRecording) {
      setBusy(true);
      setSteps([]);
      setPendingAction(null);
      try {
        const blob = await stop();
        if (!blob) throw new Error('No audio captured');
        setStep('upload', 'Uploaded recording', false);
        const audioUrl = await uploadAudioBlob(blob);
        setStep('upload', 'Uploaded recording', true);

        const result = await trpcClient.director.dispatch.mutate({
          universeId,
          audioUrl,
          hasActiveNode: !!lastEventIdRef.current,
          voice: {},
        });

        if (result.transcript) addLog('user', result.transcript);
        setStep('understand', 'Understood request', true);

        if (result.intent === 'canon_query') {
          setStep('canon', 'Checked canon', true);
          addLog('director', result.spokenResponse);
          playAudio(result.audioUrl, audioElRef);
        } else if (result.intent === 'story_action' && result.storyAction) {
          setStep(
            'classify',
            `Classified action: ${result.storyAction.kind.replace('_', ' ')}`,
            true
          );
          addLog('director', result.storyAction.spokenAck);
          playAudio(result.audioUrl, audioElRef);
          setPendingAction(result.storyAction);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Voice request failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      await start();
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const executeAction = async () => {
    if (!pendingAction) return;
    setBusy(true);
    try {
      const kind = pendingAction.kind;
      const description = pendingAction.params.description || pendingAction.summary;
      const title = pendingAction.params.title;

      if (kind === 'branch_story' && !lastEventIdRef.current) {
        toast.error('Nothing to branch from yet — create a node first.');
        return;
      }
      if (kind === 'update_node' && !lastEventIdRef.current) {
        toast.error('Nothing to update yet — create a node first.');
        return;
      }

      const result = await trpcClient.director.executeStoryAction.mutate({
        universeId,
        kind,
        title,
        description,
        previousEventId: kind === 'branch_story' ? lastEventIdRef.current! : undefined,
        eventId: kind === 'update_node' ? lastEventIdRef.current! : undefined,
      });

      if ('eventId' in result && result.eventId) {
        lastEventIdRef.current = result.eventId;
      }
      setStep('execute', ACTION_VERB[kind], true);
      toast.success(ACTION_VERB[kind]);
      setPendingAction(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-2">
      <audio ref={audioElRef} className="hidden" />

      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
        {log.length === 0 ? (
          <p className="text-zinc-500">
            {isRecording ? '● Listening…' : 'Press the mic and talk to this universe.'}
          </p>
        ) : (
          log.map((entry) => (
            <p
              key={entry.id}
              className={entry.role === 'user' ? 'text-zinc-300' : 'text-amber-300'}
            >
              <span className="font-medium">{entry.role === 'user' ? 'You: ' : 'Director: '}</span>
              {entry.text}
            </p>
          ))
        )}
      </div>

      {steps.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-zinc-400">
          {steps.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5">
              {s.done ? (
                <Check className="size-3 text-emerald-400" />
              ) : (
                <Loader2 className="size-3 animate-spin" />
              )}
              {s.label}
            </span>
          ))}
        </div>
      )}

      {pendingAction && (
        <div className="flex flex-col gap-2 rounded border border-amber-900/50 bg-amber-950/20 p-3">
          <p className="text-xs text-amber-300">
            <Badge variant="outline" className="mr-1.5 border-amber-700 text-amber-400">
              {pendingAction.kind.replace('_', ' ')}
            </Badge>
            {pendingAction.summary}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={executeAction} disabled={busy}>
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingAction(null)}
              disabled={busy}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3 pt-1">
        <Button
          size="icon"
          className={`size-12 rounded-full ${isRecording ? 'animate-pulse bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}
          onClick={handleRecord}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleStop}
          disabled={!isRecording && !audioElRef.current?.duration}
        >
          <Square className="mr-1.5 size-3.5" /> Stop
        </Button>
      </div>
      <p className="text-center text-xs text-zinc-600">
        {isRecording ? 'Recording — press mic again to send' : 'Tap to record, tap again to send'}
      </p>
    </div>
  );
}

// ── Character tab ────────────────────────────────────────────────────

function CharacterTab({ universeId }: { universeId: string }) {
  const { isRecording, start, stop, cancel } = useMicRecorder();
  const [busy, setBusy] = useState(false);
  const [characterId, setCharacterId] = useState<string>('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const audioElRef = useRef<HTMLAudioElement>(null);

  const { data: characters } = useQuery({
    queryKey: ['voice-director-characters', universeId],
    queryFn: () =>
      trpcClient.entities.list.query({ universeAddress: universeId, kind: 'person', limit: 40 }),
    enabled: !!universeId,
  });

  useEffect(() => {
    if (!characterId && characters?.entities?.length) {
      setCharacterId(characters.entities[0].id);
    }
  }, [characters, characterId]);

  const addLog = (role: LogEntry['role'], text: string) =>
    setLog((l) => [...l, { id: `${Date.now()}-${role}`, role, text }]);

  const handleStop = () => {
    if (isRecording) {
      cancel();
      return;
    }
    audioElRef.current?.pause();
  };

  const handleRecord = async () => {
    if (isRecording) {
      if (!characterId) {
        toast.error('Pick a character first');
        cancel();
        return;
      }
      setBusy(true);
      try {
        const blob = await stop();
        if (!blob) throw new Error('No audio captured');
        const audioUrl = await uploadAudioBlob(blob);
        const result = await trpcClient.director.talkToCharacter.mutate({
          universeId,
          entityId: characterId,
          audioUrl,
        });
        if (result.transcript) addLog('user', result.transcript);
        addLog('character', result.spokenResponse);
        playAudio(result.audioUrl, audioElRef);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Voice request failed');
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      await start();
    } catch {
      toast.error('Microphone access denied');
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-2">
      <audio ref={audioElRef} className="hidden" />

      <Select value={characterId} onValueChange={setCharacterId}>
        <SelectTrigger className="border-zinc-800 bg-zinc-900">
          <SelectValue placeholder="Pick a character" />
        </SelectTrigger>
        <SelectContent>
          {(characters?.entities ?? []).map((c: any) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
        {log.length === 0 ? (
          <p className="text-zinc-500">Ask this character something.</p>
        ) : (
          log.map((entry) => (
            <p
              key={entry.id}
              className={entry.role === 'user' ? 'text-zinc-300' : 'text-amber-300'}
            >
              <span className="font-medium">{entry.role === 'user' ? 'You: ' : ''}</span>
              {entry.text}
            </p>
          ))
        )}
      </div>

      <div className="flex items-center justify-center gap-3 pt-1">
        <Button
          size="icon"
          className={`size-12 rounded-full ${isRecording ? 'animate-pulse bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}
          onClick={handleRecord}
          disabled={busy || !characterId}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
        </Button>
        <Button size="sm" variant="outline" onClick={handleStop} disabled={!isRecording}>
          <Square className="mr-1.5 size-3.5" /> Stop
        </Button>
      </div>
    </div>
  );
}
