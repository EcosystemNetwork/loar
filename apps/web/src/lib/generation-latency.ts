/**
 * Per-model generation latency history, kept in localStorage.
 *
 * Generation calls are one long blocking request, so there is no server
 * progress to show. Instead we remember how long each model actually took on
 * this device (a ring buffer of recent samples) and use its p50/p90 to draw an
 * honest progress bar + ETA. With no history we return null and the UI falls
 * back to a plain spinner rather than inventing a number.
 */

const STORAGE_KEY = 'loar:gen-latency:v1';
export const MAX_SAMPLES = 200;
/** Ignore instant failures / stuck tabs so they don't skew the percentiles. */
const MIN_VALID_MS = 500;
const MAX_VALID_MS = 30 * 60_000;
/** Below this many samples a percentile is noise — show no ETA. */
export const MIN_SAMPLES_FOR_ETA = 3;

export type LatencyHistory = Record<string, number[]>;

export interface LatencyStats {
  p50: number;
  p90: number;
  samples: number;
}

export interface Progress {
  /** 0..1, never reaches 1 while the job is still running. */
  fraction: number;
  /** Milliseconds left by the p50 estimate; 0 once past it. */
  etaMs: number;
  /** True once the job has outlived the p90 — the ETA is no longer reliable. */
  overdue: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(storage: StorageLike | null = defaultStorage()): LatencyHistory {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: LatencyHistory = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((n): n is number => Number.isFinite(n));
    }
    return out;
  } catch {
    return {};
  }
}

/** Records one completed run. Returns false when the sample was rejected. */
export function recordLatency(
  key: string,
  ms: number,
  storage: StorageLike | null = defaultStorage()
): boolean {
  if (!storage || !Number.isFinite(ms) || ms < MIN_VALID_MS || ms > MAX_VALID_MS) return false;
  try {
    const history = loadHistory(storage);
    history[key] = [...(history[key] ?? []), Math.round(ms)].slice(-MAX_SAMPLES);
    storage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function getLatencyStats(
  key: string,
  storage: StorageLike | null = defaultStorage()
): LatencyStats | null {
  const samples = loadHistory(storage)[key];
  if (!samples || samples.length < MIN_SAMPLES_FOR_ETA) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), samples: sorted.length };
}

/**
 * Maps elapsed time onto the model's typical duration. The bar reaches ~90% at
 * p50, then crawls toward 98% by p90 and holds — it must never claim "done"
 * before the job actually finishes.
 */
export function estimateProgress(elapsedMs: number, stats: LatencyStats): Progress {
  const elapsed = Math.max(0, elapsedMs);
  const { p50, p90 } = stats;
  let fraction: number;
  if (elapsed <= p50) {
    fraction = 0.9 * (elapsed / p50);
  } else if (elapsed < p90 && p90 > p50) {
    fraction = 0.9 + 0.08 * ((elapsed - p50) / (p90 - p50));
  } else {
    fraction = 0.98;
  }
  return {
    fraction: Math.min(0.98, fraction),
    etaMs: Math.max(0, p50 - elapsed),
    overdue: elapsed >= p90,
  };
}

/** Stable key for a generation: what ran, at the settings that drive its cost in time. */
export function latencyKey(gen: {
  kind: string;
  videoModel?: string;
  imageModel?: string;
  videoDurationSec?: number;
  videoResolution?: string;
}): string {
  if (gen.kind === 'video') {
    return `video:${gen.videoModel ?? 'default'}:${gen.videoDurationSec ?? 5}s:${gen.videoResolution ?? '720p'}`;
  }
  if (gen.kind === 'image') return `image:${gen.imageModel || 'auto'}`;
  return gen.kind;
}

export function formatEta(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
