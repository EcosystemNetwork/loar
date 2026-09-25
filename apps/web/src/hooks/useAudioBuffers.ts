import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { audioBuffers, type AudioStatus, type LoadedAudio } from '@/lib/audioBuffers';

/**
 * Loads (once, shared) the audio behind every URL and re-renders as each one
 * lands. `getBuffer` is what `MixEngine` reads at play time; `get`/`status`
 * drive the lane waveforms and their "unavailable" markers.
 */
export function useAudioBuffers(urls: string[]) {
  // Re-render on any store change; only the URLs we asked about matter to callers.
  useSyncExternalStore(audioBuffers.subscribe, audioBuffers.snapshot, audioBuffers.snapshot);

  const key = useMemo(() => [...new Set(urls.filter(Boolean))].sort().join('\n'), [urls]);
  useEffect(() => {
    for (const url of key ? key.split('\n') : []) void audioBuffers.load(url);
  }, [key]);

  const get = useCallback((url: string): LoadedAudio | undefined => audioBuffers.get(url), []);
  const getBuffer = useCallback((url: string) => audioBuffers.get(url)?.buffer, []);
  const status = useCallback(
    (url: string): AudioStatus | undefined => audioBuffers.status(url),
    []
  );
  return { get, getBuffer, status };
}
