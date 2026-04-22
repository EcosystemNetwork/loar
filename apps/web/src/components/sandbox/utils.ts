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
