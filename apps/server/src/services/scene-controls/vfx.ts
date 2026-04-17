/**
 * VFX Preset Processing Service
 *
 * Applies post-generation video effects using ffmpeg filter chains.
 * Effects are compositing-only (no AI regen), running in <10 seconds.
 * Each composite is stored separately so toggling presets doesn't require regen.
 */

import { VFX_PRESETS, type VfxPresetId } from './types';

/**
 * Build the complete ffmpeg filter chain for a list of VFX presets.
 * Presets are applied in order (first in the array = applied first).
 */
export function buildVfxFilterChain(presetIds: VfxPresetId[]): string {
  if (presetIds.length === 0) return '';

  const filters: string[] = [];

  for (const presetId of presetIds) {
    const preset = VFX_PRESETS[presetId];
    if (preset?.ffmpegFilters) {
      filters.push(preset.ffmpegFilters);
    }
  }

  return filters.join(',');
}

/**
 * Build a complete ffmpeg command for applying VFX to a video.
 *
 * @param inputPath - Path to the source video
 * @param outputPath - Path for the composited output
 * @param presetIds - Ordered list of VFX presets to apply
 * @returns The ffmpeg command string, or null if no presets
 */
export function buildVfxCommand(
  inputPath: string,
  outputPath: string,
  presetIds: VfxPresetId[]
): string | null {
  const filterChain = buildVfxFilterChain(presetIds);
  if (!filterChain) return null;

  // Use -y to overwrite, copy audio, apply video filters
  return [
    'ffmpeg',
    '-y',
    '-i',
    JSON.stringify(inputPath),
    '-vf',
    JSON.stringify(filterChain),
    '-c:a',
    'copy',
    '-preset',
    'fast',
    outputPath,
  ].join(' ');
}

/**
 * List all available VFX presets grouped by category.
 */
export function listVfxPresets() {
  const grouped: Record<
    string,
    Array<{ id: VfxPresetId; label: string; description: string }>
  > = {};

  for (const [id, config] of Object.entries(VFX_PRESETS)) {
    if (!grouped[config.category]) {
      grouped[config.category] = [];
    }
    grouped[config.category].push({
      id: id as VfxPresetId,
      label: config.label,
      description: config.description,
    });
  }

  return grouped;
}

/**
 * Get details for a single VFX preset.
 */
export function getVfxPreset(id: VfxPresetId) {
  return VFX_PRESETS[id] || null;
}
