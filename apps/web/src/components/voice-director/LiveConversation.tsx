/**
 * Live, hands-free conversation with the Voice Director or a character:
 * click Start once, then just talk — the bot answers in real time and you can
 * interrupt it by speaking. Backed by the Pipecat pipeline (see
 * apps/voice-pipeline); falls back to push-to-talk when the server has no
 * pipeline configured.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Mic, MicOff, Square, Hand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLiveVoice } from '@/hooks/useLiveVoice';
import { stepLabel } from '@/lib/voice/voiceState';

interface Props {
  universeId: string;
  mode: 'director' | 'character';
  entityId?: string;
  /** Name shown in front of the bot's lines. */
  speakerLabel: string;
  /** Called when the server reports live voice isn't configured. */
  onUnavailable: () => void;
}

export function LiveConversation({
  universeId,
  mode,
  entityId,
  speakerLabel,
  onUnavailable,
}: Props) {
  const queryClient = useQueryClient();
  const { state, micLevel, muted, start, stop, interrupt, toggleMute } = useLiveVoice();
  const scrollRef = useRef<HTMLDivElement>(null);

  // A tool changed the story: refetch the graph so the new/edited node appears.
  useEffect(() => {
    if (state.storyChanges > 0) queryClient.invalidateQueries({ queryKey: ['offChainNodes'] });
  }, [state.storyChanges, queryClient]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.transcript]);

  const active = state.status === 'connecting' || state.status === 'live';

  const handleStart = async () => {
    const result = await start({ universeId, mode, entityId });
    if (result === 'unavailable') {
      toast.info('Live voice isn’t set up on this server — using push-to-talk instead.');
      onUnavailable();
    }
  };

  let statusText = 'Not connected';
  let statusTone = 'text-zinc-500';
  if (state.status === 'connecting') statusText = 'Connecting…';
  else if (state.status === 'live') {
    if (state.botSpeaking) {
      statusText = `${speakerLabel} is speaking…`;
      statusTone = 'text-amber-400';
    } else if (state.userSpeaking) {
      statusText = '● Listening…';
      statusTone = 'text-red-400';
    } else {
      statusText = muted ? 'Muted' : 'Ready — just start talking';
      statusTone = 'text-emerald-400';
    }
  } else if (state.status === 'error') {
    statusText = state.error ?? 'Something went wrong';
    statusTone = 'text-red-400';
  } else if (state.status === 'closed') {
    statusText = state.error ?? 'Conversation ended';
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center justify-between text-xs">
        <span className={statusTone}>{statusText}</span>
        {state.status === 'live' && (
          <span className="h-1.5 w-20 overflow-hidden rounded bg-zinc-800" aria-hidden>
            <span
              className="block h-full bg-amber-400 transition-[width] duration-100"
              style={{ width: `${Math.min(100, micLevel * 400)}%` }}
            />
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex max-h-56 min-h-24 flex-col gap-2 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50 p-3 text-sm"
      >
        {state.transcript.length === 0 ? (
          <p className="text-zinc-500">
            {mode === 'director'
              ? 'Try: “What does Kira currently know about the memory archive?”'
              : 'Ask this character something.'}
          </p>
        ) : (
          state.transcript.map((entry) => (
            <p
              key={entry.id}
              className={
                entry.role === 'user'
                  ? `text-zinc-300 ${entry.final ? '' : 'opacity-60'}`
                  : 'text-amber-300'
              }
            >
              <span className="font-medium">
                {entry.role === 'user' ? 'You: ' : `${speakerLabel}: `}
              </span>
              {entry.text}
            </p>
          ))
        )}
      </div>

      {state.steps.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-zinc-400" aria-label="Actions">
          {state.steps.map((step) => (
            <span key={step.id} className="flex items-center gap-1.5">
              {step.done ? (
                <Check className="size-3 text-emerald-400" />
              ) : step.cancelled ? (
                <Square className="size-3 text-zinc-500" />
              ) : (
                <Loader2 className="size-3 animate-spin" />
              )}
              {stepLabel(step)}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-2 pt-1">
        {active ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={toggleMute}
              disabled={state.status !== 'live'}
              aria-pressed={muted}
            >
              {muted ? <MicOff className="mr-1.5 size-3.5" /> : <Mic className="mr-1.5 size-3.5" />}
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button size="sm" variant="outline" onClick={interrupt} disabled={!state.botSpeaking}>
              <Hand className="mr-1.5 size-3.5" /> Interrupt
            </Button>
            <Button size="sm" variant="destructive" onClick={stop}>
              <Square className="mr-1.5 size-3.5" /> Stop
            </Button>
          </>
        ) : (
          <Button className="bg-amber-500 text-black hover:bg-amber-600" onClick={handleStart}>
            <Mic className="mr-1.5 size-4" />
            {state.status === 'idle' ? 'Start live conversation' : 'Start a new conversation'}
          </Button>
        )}
      </div>
      <p className="text-center text-xs text-zinc-600">
        Headphones work best — speak any time to interrupt.
      </p>
    </div>
  );
}
