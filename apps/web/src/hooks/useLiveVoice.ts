/**
 * React binding for a live voice conversation: mints a session from LOAR,
 * connects the browser to the Pipecat pipeline, and exposes the conversation
 * state (transcript, tool checklist, who's speaking) plus controls.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { LiveVoiceSession } from '@/lib/voice/LiveVoiceSession';
import { initialVoiceState, voiceReducer, type VoiceState } from '@/lib/voice/voiceState';

export type LiveVoiceStart = 'started' | 'unavailable' | 'failed';

export interface LiveVoiceOptions {
  universeId: string;
  mode: 'director' | 'character';
  entityId?: string;
}

export function describeStartError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError') return 'Microphone access was denied.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (err instanceof Error && err.message) return err.message;
  return 'Could not start the voice session.';
}

export function useLiveVoice(): {
  state: VoiceState;
  micLevel: number;
  muted: boolean;
  start: (options: LiveVoiceOptions) => Promise<LiveVoiceStart>;
  stop: () => void;
  interrupt: () => void;
  toggleMute: () => void;
} {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const sessionRef = useRef<LiveVoiceSession | null>(null);

  const teardown = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setMicLevel(0);
    setMuted(false);
  }, []);

  const stop = useCallback(() => {
    teardown();
    dispatch({ type: 'closed' });
  }, [teardown]);

  const start = useCallback(
    async (options: LiveVoiceOptions): Promise<LiveVoiceStart> => {
      teardown();
      dispatch({ type: 'connecting' });
      try {
        const { wsUrl } = await trpcClient.director.createVoiceSession.mutate(options);
        const session = new LiveVoiceSession(wsUrl, {
          onRtvi: (message) => dispatch({ type: 'rtvi', message }),
          onMicLevel: setMicLevel,
          onStatus: (status, detail) => {
            if (status === 'failed') {
              dispatch({ type: 'failed', message: detail ?? 'Voice connection failed.' });
              teardown();
            } else if (status === 'closed') {
              sessionRef.current = null;
              setMicLevel(0);
              dispatch({ type: 'closed', reason: detail });
            }
          },
        });
        sessionRef.current = session;
        await session.start();
        return 'started';
      } catch (err) {
        teardown();
        if ((err as { data?: { code?: string } } | null)?.data?.code === 'SERVICE_UNAVAILABLE') {
          dispatch({ type: 'closed' });
          return 'unavailable';
        }
        dispatch({ type: 'failed', message: describeStartError(err) });
        return 'failed';
      }
    },
    [teardown]
  );

  const interrupt = useCallback(() => sessionRef.current?.interrupt(), []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      sessionRef.current?.setMuted(!current);
      return !current;
    });
  }, []);

  useEffect(() => teardown, [teardown]);

  return { state, micLevel, muted, start, stop, interrupt, toggleMute };
}
