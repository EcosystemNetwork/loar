/**
 * Scene Controls — Barrel Export
 *
 * Camera presets, style transfer, VFX compositing, and shared types
 * for the node editor expansion features.
 */

// Types
export * from './types';

// Camera
export { translateCameraPreset, getCameraPromptFragment, getByteDanceCameraParams } from './camera';

// Style
export {
  resolveInheritedStyle,
  applyStyleToPrompt,
  listStylePresets,
  getStyleInfo,
} from './styles';

// VFX
export { buildVfxFilterChain, buildVfxCommand, listVfxPresets, getVfxPreset } from './vfx';
