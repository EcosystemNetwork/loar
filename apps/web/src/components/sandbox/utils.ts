import { STYLE_PRESETS } from './constants';

export function applyStylePreset(prompt: string, presetId: string | null): string {
  if (!presetId) return prompt;
  const preset = STYLE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return prompt;
  if (prompt.toLowerCase().includes(preset.suffix.toLowerCase().slice(0, 20))) return prompt;
  const trimmed = prompt.trim();
  if (!trimmed) return preset.suffix;
  const sep = /[.!?]$/.test(trimmed) ? ' ' : '. ';
  return `${trimmed}${sep}${preset.suffix}`;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export function isSubmitShortcut(e: any): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey);
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

import type { OutpaintAspect, ImageSize, AspectRatio } from '@/types/sandbox.types';

export function aspectToImageSize(aspect: OutpaintAspect): ImageSize {
  if (aspect === '9:16') return 'portrait_16_9';
  if (aspect === '1:1') return 'square_hd';
  return 'landscape_16_9';
}

export function aspectFromSize(size: ImageSize): AspectRatio {
  if (size === 'portrait_16_9') return '9:16';
  if (size === 'square_hd') return '1:1';
  return '16:9';
}

/** Namespaces a localStorage key by wallet so a shared browser never shows one
 *  user's queue / results to the next. Anonymous sessions share an 'anon' bucket. */
export function scopedStorageKey(base: string, address?: string | null): string {
  return `${base}:${(address ?? 'anon').toLowerCase()}`;
}

/** Only plain image/video runs can be replayed faithfully by `retryGen`. */
export function isRetryableGen(g: { kind: string; retryable?: boolean }): boolean {
  return !!g.retryable && (g.kind === 'image' || g.kind === 'video');
}

/**
 * Puts dismissed cards back (undo). Merges by id — a card that reappeared in
 * the meantime isn't duplicated — and keeps the list newest-first.
 */
export function restoreGenerations<T extends { id: string; createdAt: number }>(
  current: T[],
  removed: T[]
): T[] {
  const have = new Set(current.map((g) => g.id));
  const back = removed.filter((g) => !have.has(g.id));
  if (back.length === 0) return current;
  return [...current, ...back].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * A card that was mid-render when the page closed and can be picked back up:
 * a queued video job keeps running on the server and is polled by its id. Every
 * other kind of in-flight work (inline runs, 3D, edits) died with the page.
 */
export function isResumableGen(g: {
  kind: string;
  status: string;
  pollGenerationId?: string;
}): boolean {
  return g.status === 'generating' && g.kind === 'video' && !!g.pollGenerationId;
}
