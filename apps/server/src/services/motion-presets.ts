/**
 * PRD 8 Motion Presets
 *
 * Curated subset of `scene-controls/camera` presets surfaced to users in the
 * editor's "Animate Image" flow. Keeps UX tight — five named motions instead
 * of the full 18-preset camera registry.
 *
 * Each motion maps to one or more (cameraPresetId, intensity) tuples; the
 * resolver picks the tuple based on the user's intensity choice.
 */
import type { CameraPresetId, CameraIntensity } from './scene-controls/types';

export type MotionPresetId = 'push_in' | 'orbit' | 'crash_zoom' | 'dolly' | 'walk_up';

export interface MotionPreset {
  id: MotionPresetId;
  label: string;
  description: string;
  /** Default underlying camera preset + intensity. */
  default: { cameraPreset: CameraPresetId; cameraIntensity: CameraIntensity };
  /** Map user intensity → underlying camera tuple. */
  byIntensity: Record<
    CameraIntensity,
    { cameraPreset: CameraPresetId; cameraIntensity: CameraIntensity }
  >;
}

export const MOTION_PRESETS: Record<MotionPresetId, MotionPreset> = {
  push_in: {
    id: 'push_in',
    label: 'Push In',
    description: 'Slow steady push toward the subject — builds intensity',
    default: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'standard' },
    byIntensity: {
      subtle: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'pronounced' },
    },
  },
  orbit: {
    id: 'orbit',
    label: 'Orbit',
    description: 'Camera circles the subject — reveals depth and 3D form',
    default: { cameraPreset: 'orbit_right_slow', cameraIntensity: 'standard' },
    byIntensity: {
      subtle: { cameraPreset: 'orbit_right_slow', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'orbit_right_slow', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'orbit_right_fast', cameraIntensity: 'standard' },
    },
  },
  crash_zoom: {
    id: 'crash_zoom',
    label: 'Crash Zoom',
    description: 'Aggressive snap-zoom — comedic or shock reveal',
    default: { cameraPreset: 'crash_zoom', cameraIntensity: 'standard' },
    byIntensity: {
      subtle: { cameraPreset: 'crash_zoom', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'crash_zoom', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'crash_zoom', cameraIntensity: 'pronounced' },
    },
  },
  dolly: {
    id: 'dolly',
    label: 'Dolly Out',
    description: 'Camera pulls back to reveal the wider scene',
    default: { cameraPreset: 'dolly_out_slow', cameraIntensity: 'standard' },
    byIntensity: {
      subtle: { cameraPreset: 'dolly_out_slow', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'dolly_out_slow', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'dolly_out_fast', cameraIntensity: 'standard' },
    },
  },
  walk_up: {
    id: 'walk_up',
    label: 'Walk Up',
    description: 'POV approach — human-paced footsteps toward the subject',
    default: { cameraPreset: 'walk_up', cameraIntensity: 'standard' },
    byIntensity: {
      subtle: { cameraPreset: 'walk_up', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'walk_up', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'walk_up', cameraIntensity: 'pronounced' },
    },
  },
};

export const MOTION_PRESET_IDS: MotionPresetId[] = [
  'push_in',
  'orbit',
  'crash_zoom',
  'dolly',
  'walk_up',
];

export function resolveMotionPreset(
  id: MotionPresetId,
  intensity: CameraIntensity = 'standard'
): { cameraPreset: CameraPresetId; cameraIntensity: CameraIntensity } {
  const preset = MOTION_PRESETS[id];
  if (!preset) throw new Error(`Unknown motion preset: ${id}`);
  return preset.byIntensity[intensity] || preset.default;
}
