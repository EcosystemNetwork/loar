/**
 * Decoded-audio cache for the mix preview and the timeline waveforms.
 *
 * Each distinct URL is fetched and decoded once, shared by every clip that
 * uses it, and its waveform peaks are computed at the same time. Fetching
 * tries the URL directly (media.loar.fun / IPFS gateways send CORS headers)
 * and falls back to the server's authenticated download proxy.
 *
 * Preview only: export never depends on this, so a file that can't be decoded
 * here (too big, blocked, unsupported codec) still mixes down on the server —
 * the lane just shows it without a waveform and the preview leaves it silent.
 */
import { computePeaks } from './audioMix';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';
import { SERVER_URL } from '@/utils/trpc';

/** Decoded PCM is ~10× the file size; refuse to hold anything bigger than this for preview. */
export const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;

export type AudioStatus = 'loading' | 'ready' | 'unavailable' | 'too-large';

export interface LoadedAudio {
  buffer: AudioBuffer;
  /** Max-abs peaks, `PEAKS_PER_SEC` per second. */
  peaks: Float32Array;
  duration: number;
}

export class TooLargeError extends Error {
  constructor() {
    super('audio file too large to preview');
  }
}

type Fetcher = (url: string) => Promise<ArrayBuffer>;

async function readCapped(res: Response): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_PREVIEW_BYTES) throw new TooLargeError();
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new TooLargeError();
  return bytes;
}

/** Direct CORS fetch first; if the host blocks it, the authenticated server proxy. */
export const fetchAudioBytes: Fetcher = async (url) => {
  const resolved = resolveIpfsUrlPreferred(url);
  try {
    const res = await fetch(resolved, { mode: 'cors' });
    if (res.ok) return await readCapped(res);
  } catch (err) {
    if (err instanceof TooLargeError) throw err;
    // CORS / network failure → try the proxy
  }
  const proxied = `${SERVER_URL}/api/clips/download?${new URLSearchParams({ url, filename: 'audio' })}`;
  const res = await fetch(proxied, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readCapped(res);
};

export class AudioBufferStore {
  private items = new Map<string, LoadedAudio>();
  private states = new Map<string, AudioStatus>();
  private inflight = new Map<string, Promise<LoadedAudio | null>>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly getContext: () => BaseAudioContext,
    private readonly fetchBytes: Fetcher
  ) {}

  status(url: string): AudioStatus | undefined {
    return this.states.get(url);
  }

  get(url: string): LoadedAudio | undefined {
    return this.items.get(url);
  }

  /** Bumps whenever any entry changes — the snapshot for useSyncExternalStore. */
  snapshot = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(url: string, status: AudioStatus) {
    this.states.set(url, status);
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  load(url: string): Promise<LoadedAudio | null> {
    const done = this.items.get(url);
    if (done) return Promise.resolve(done);
    const pending = this.inflight.get(url);
    if (pending) return pending;
    // A failed URL stays failed for the session — retrying on every render would hammer the host.
    const state = this.states.get(url);
    if (state === 'unavailable' || state === 'too-large') return Promise.resolve(null);

    this.set(url, 'loading');
    const p = (async () => {
      try {
        const bytes = await this.fetchBytes(url);
        const buffer = await this.getContext().decodeAudioData(bytes);
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i)
        );
        const loaded: LoadedAudio = {
          buffer,
          peaks: computePeaks(channels, buffer.sampleRate),
          duration: buffer.duration,
        };
        this.items.set(url, loaded);
        this.set(url, 'ready');
        return loaded;
      } catch (err) {
        this.set(url, err instanceof TooLargeError ? 'too-large' : 'unavailable');
        return null;
      } finally {
        this.inflight.delete(url);
      }
    })();
    this.inflight.set(url, p);
    return p;
  }
}

// ── Shared browser instance ─────────────────────────────────────────────

let sharedContext: AudioContext | null = null;

/** One AudioContext for decoding and playback (browsers cap how many can exist). */
export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

export const audioBuffers = new AudioBufferStore(getAudioContext, fetchAudioBytes);
