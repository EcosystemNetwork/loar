/**
 * Camera Preset Translation
 *
 * Translates camera presets into provider-specific parameters.
 * - ByteDance/Seedance 2: Uses native camera_control parameters
 * - FAL (Kling, Wan2.5, etc.): Appends prompt fragments
 */

import type { CameraPresetId, CameraIntensity } from './types';
import { CAMERA_PRESETS } from './types';

// ── Prompt-based camera translation (for providers without structured control) ──

const CAMERA_PROMPT_FRAGMENTS: Record<CameraPresetId, Record<CameraIntensity, string>> = {
  locked: {
    subtle: 'static camera, no movement',
    standard: 'completely still camera, locked tripod shot',
    pronounced: 'completely locked camera, zero movement, perfectly static tripod',
  },
  handheld_subtle: {
    subtle: 'very slight handheld camera movement',
    standard: 'subtle handheld camera shake, natural movement',
    pronounced: 'noticeable handheld camera movement, documentary style',
  },
  dolly_in_slow: {
    subtle: 'gentle dolly in',
    standard: 'slow dolly in toward subject',
    pronounced: 'dramatic slow dolly in toward subject, intensifying',
  },
  dolly_in_fast: {
    subtle: 'dolly in toward subject',
    standard: 'fast dolly in, camera pushing forward quickly',
    pronounced: 'very fast dolly in, aggressive camera push toward subject',
  },
  dolly_out_slow: {
    subtle: 'gentle dolly out',
    standard: 'slow dolly out, camera pulling back from subject',
    pronounced: 'dramatic slow dolly out revealing the scene, pulling away',
  },
  dolly_out_fast: {
    subtle: 'dolly out from subject',
    standard: 'fast dolly out, camera pulling back quickly',
    pronounced: 'very fast dolly out, dramatic rapid reveal pulling back',
  },
  pan_left: {
    subtle: 'gentle camera pan to the left',
    standard: 'camera panning left, horizontal sweep',
    pronounced: 'dramatic wide pan to the left, sweeping horizontal movement',
  },
  pan_right: {
    subtle: 'gentle camera pan to the right',
    standard: 'camera panning right, horizontal sweep',
    pronounced: 'dramatic wide pan to the right, sweeping horizontal movement',
  },
  tilt_up: {
    subtle: 'slight camera tilt upward',
    standard: 'camera tilting up, vertical pan upward',
    pronounced: 'dramatic camera tilt upward, revealing the sky',
  },
  tilt_down: {
    subtle: 'slight camera tilt downward',
    standard: 'camera tilting down, vertical pan downward',
    pronounced: 'dramatic camera tilt downward, descending view',
  },
  orbit_left_slow: {
    subtle: 'gentle camera orbit left around subject',
    standard: 'slow orbital camera movement to the left around the subject',
    pronounced: 'dramatic slow orbit left, circling the subject majestically',
  },
  orbit_right_slow: {
    subtle: 'gentle camera orbit right around subject',
    standard: 'slow orbital camera movement to the right around the subject',
    pronounced: 'dramatic slow orbit right, circling the subject majestically',
  },
  orbit_right_fast: {
    subtle: 'camera orbiting right around subject',
    standard: 'fast orbit right, camera circling the subject quickly',
    pronounced: 'very fast orbit right, dynamic spinning camera around subject',
  },
  crane_up: {
    subtle: 'gentle crane shot upward',
    standard: 'crane shot rising up, ascending camera',
    pronounced: 'dramatic crane shot soaring upward, epic ascending reveal',
  },
  crane_down: {
    subtle: 'gentle crane shot downward',
    standard: 'crane shot descending, camera moving down',
    pronounced: 'dramatic crane shot descending, epic lowering reveal',
  },
  whip_pan_right: {
    subtle: 'quick pan right',
    standard: 'whip pan to the right, fast horizontal sweep',
    pronounced: 'extreme whip pan right, blur-speed horizontal camera sweep',
  },
  crash_zoom: {
    subtle: 'quick zoom in toward subject',
    standard: 'crash zoom into subject, sudden aggressive zoom',
    pronounced: 'extreme crash zoom, snap-zoom slamming toward subject',
  },
  walk_up: {
    subtle: 'camera approaching subject on foot',
    standard: 'POV walking forward toward subject, steady human-paced approach',
    pronounced: 'urgent walk-up to subject, hurried POV approach with natural footstep cadence',
  },
};

/**
 * Get a prompt fragment describing the camera motion.
 * Used for providers without structured camera control.
 */
export function getCameraPromptFragment(
  preset: CameraPresetId,
  intensity: CameraIntensity = 'standard'
): string {
  return CAMERA_PROMPT_FRAGMENTS[preset]?.[intensity] || '';
}

// ── ByteDance native camera parameters ──

interface ByteDanceCameraParams {
  camera_control?: string;
  camera_speed?: number; // 0-1
}

const BD_CAMERA_MAP: Record<CameraPresetId, { control: string; baseSpeed: number }> = {
  locked: { control: 'static', baseSpeed: 0 },
  handheld_subtle: { control: 'handheld', baseSpeed: 0.2 },
  dolly_in_slow: { control: 'dolly_in', baseSpeed: 0.3 },
  dolly_in_fast: { control: 'dolly_in', baseSpeed: 0.8 },
  dolly_out_slow: { control: 'dolly_out', baseSpeed: 0.3 },
  dolly_out_fast: { control: 'dolly_out', baseSpeed: 0.8 },
  pan_left: { control: 'pan_left', baseSpeed: 0.5 },
  pan_right: { control: 'pan_right', baseSpeed: 0.5 },
  tilt_up: { control: 'tilt_up', baseSpeed: 0.5 },
  tilt_down: { control: 'tilt_down', baseSpeed: 0.5 },
  orbit_left_slow: { control: 'orbit_left', baseSpeed: 0.3 },
  orbit_right_slow: { control: 'orbit_right', baseSpeed: 0.3 },
  orbit_right_fast: { control: 'orbit_right', baseSpeed: 0.8 },
  crane_up: { control: 'crane_up', baseSpeed: 0.5 },
  crane_down: { control: 'crane_down', baseSpeed: 0.5 },
  whip_pan_right: { control: 'whip_pan_right', baseSpeed: 0.9 },
  crash_zoom: { control: 'dolly_in', baseSpeed: 0.95 },
  walk_up: { control: 'dolly_in', baseSpeed: 0.45 },
};

const INTENSITY_MULTIPLIER: Record<CameraIntensity, number> = {
  subtle: 0.5,
  standard: 1.0,
  pronounced: 1.5,
};

/**
 * Translate camera preset to ByteDance-specific camera parameters.
 */
export function getByteDanceCameraParams(
  preset: CameraPresetId,
  intensity: CameraIntensity = 'standard'
): ByteDanceCameraParams {
  const mapping = BD_CAMERA_MAP[preset];
  if (!mapping) return {};

  const speed = Math.min(1, mapping.baseSpeed * INTENSITY_MULTIPLIER[intensity]);

  return {
    camera_control: mapping.control,
    camera_speed: speed,
  };
}

/**
 * Apply camera preset to a generation request.
 * Returns modified prompt (for prompt-based providers) or extra params (for structured providers).
 */
export function translateCameraPreset(
  provider: string,
  preset: CameraPresetId,
  intensity: CameraIntensity = 'standard'
): {
  promptSuffix: string;
  providerParams: Record<string, any>;
} {
  if (provider === 'bytedance') {
    // ByteDance supports structured camera control
    return {
      promptSuffix: '', // No prompt modification needed
      providerParams: getByteDanceCameraParams(preset, intensity),
    };
  }

  // All other providers: prompt-based
  return {
    promptSuffix: getCameraPromptFragment(preset, intensity),
    providerParams: {},
  };
}
