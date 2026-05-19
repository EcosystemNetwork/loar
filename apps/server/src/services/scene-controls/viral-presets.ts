/**
 * Viral Presets — Named, branded combinations of camera + style + shot + VFX.
 *
 * Each preset is a single-click "vibe" the creator picks; we resolve it into
 * the four primitives the generation pipeline already accepts
 * (cameraPreset, stylePreset, shotPreset, vfxPresets) and feed it through
 * `applyStyleToPrompt` / `applyShotToPrompt` / `translateCameraPreset` /
 * `buildVfxFilterChain` exactly like a manual pick would.
 *
 * This file is pure data — no runtime dependencies on other services.
 */

import type {
  CameraPresetId,
  CameraIntensity,
  StylePresetId,
  ShotPresetId,
  VfxPresetId,
} from './types';
import { CAMERA_PRESETS, STYLE_PRESETS, SHOT_PRESETS, VFX_PRESETS } from './types';

export type ViralPresetCategory =
  | 'action'
  | 'cinematic'
  | 'social'
  | 'noir'
  | 'fantasy'
  | 'horror'
  | 'retro'
  | 'documentary';

export interface ViralPreset {
  id: string;
  label: string;
  tagline: string;
  category: ViralPresetCategory;
  camera: CameraPresetId;
  cameraIntensity: CameraIntensity;
  style: StylePresetId;
  shot: ShotPresetId;
  vfx: VfxPresetId[];
  /** Optional prompt seed appended after style/shot expansion. Use sparingly. */
  promptHint?: string;
}

export const VIRAL_PRESETS: ViralPreset[] = [
  {
    id: 'neon_pulse',
    label: 'Neon Pulse',
    tagline: 'Rain-slick streets, electric blues, fast push toward the subject',
    category: 'action',
    camera: 'dolly_in_fast',
    cameraIntensity: 'pronounced',
    style: 'cyberpunk',
    shot: 'dutch_tilt',
    vfx: ['lens_flare', 'film_grain'],
  },
  {
    id: 'cctv_heist',
    label: 'CCTV Heist',
    tagline: 'Security-cam grain, locked frame, vignette darkness',
    category: 'documentary',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'documentary',
    shot: 'low_angle',
    vfx: ['vhs_effect', 'vignette'],
    promptHint: 'shot on a ceiling-mounted surveillance camera, fisheye distortion',
  },
  {
    id: 'race_pole',
    label: 'Race Pole',
    tagline: 'Crash zoom, motion blur, victory in the rear-view',
    category: 'action',
    camera: 'crash_zoom',
    cameraIntensity: 'pronounced',
    style: 'cinematic',
    shot: 'ots',
    vfx: ['speed_ramp', 'lens_flare'],
  },
  {
    id: 'red_carpet_flash',
    label: 'Red Carpet Flash',
    tagline: 'Whip-pan, paparazzi strobes, hot lights',
    category: 'social',
    camera: 'whip_pan_right',
    cameraIntensity: 'pronounced',
    style: 'reportage',
    shot: 'mcu',
    vfx: ['light_leak', 'lens_flare'],
    promptHint: 'paparazzi flashes firing, crowd noise',
  },
  {
    id: 'tuscan_reverie',
    label: 'Tuscan Reverie',
    tagline: 'Golden-hour crane down, soft warm light, summer haze',
    category: 'cinematic',
    camera: 'crane_down',
    cameraIntensity: 'standard',
    style: 'golden_hour',
    shot: 'ms',
    vfx: ['film_grain', 'light_leak'],
  },
  {
    id: 'dragon_coil',
    label: "Dragon's Coil",
    tagline: 'Orbiting low-angle reveal, dust motes, mythic scale',
    category: 'fantasy',
    camera: 'orbit_right_fast',
    cameraIntensity: 'pronounced',
    style: 'dark_fantasy',
    shot: 'low_angle',
    vfx: ['dust_motes', 'film_grain'],
  },
  {
    id: 'night_patrol',
    label: 'Night Patrol',
    tagline: 'Locked frame, rain in the lens, neon reflections',
    category: 'noir',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'neo_noir',
    shot: 'ws',
    vfx: ['rain_overlay', 'noir_grade'],
  },
  {
    id: 'vapor_trail',
    label: 'Vapor Trail',
    tagline: 'Slow pull-out, 80s glow, magenta sunset',
    category: 'retro',
    camera: 'dolly_out_slow',
    cameraIntensity: 'standard',
    style: 'vaporwave',
    shot: 'ws',
    vfx: ['light_leak', 'sunset_grade'],
  },
  {
    id: 'found_footage',
    label: 'Found Footage',
    tagline: 'Handheld approach, VHS tracking lines, time-stamp burn-in',
    category: 'horror',
    camera: 'walk_up',
    cameraIntensity: 'pronounced',
    style: 'documentary',
    shot: 'mcu',
    vfx: ['vhs_effect', 'film_grain'],
    promptHint: 'shaky home-camcorder framing, breathing audible',
  },
  {
    id: 'slow_surrender',
    label: 'Slow Surrender',
    tagline: 'Kubrickian push-in on a single face, ECU intensity',
    category: 'cinematic',
    camera: 'dolly_in_slow',
    cameraIntensity: 'pronounced',
    style: 'kubrick',
    shot: 'ecu',
    vfx: ['bleach_bypass', 'film_grain'],
  },
  {
    id: 'apex_stalk',
    label: 'Apex Stalk',
    tagline: 'Over-the-shoulder pursuit, Fincher palette, teal/orange',
    category: 'cinematic',
    camera: 'handheld_subtle',
    cameraIntensity: 'standard',
    style: 'fincher',
    shot: 'ots',
    vfx: ['teal_orange', 'film_grain'],
  },
  {
    id: 'soul_brawl',
    label: 'Soul Brawl',
    tagline: 'Anime crash-zoom, low-angle hero, snap impact',
    category: 'action',
    camera: 'crash_zoom',
    cameraIntensity: 'pronounced',
    style: 'anime',
    shot: 'low_angle',
    vfx: ['speed_ramp', 'lens_flare'],
  },
  {
    id: 'first_light',
    label: 'First Light',
    tagline: 'Crane-up over a waking world, golden glow, ethereal',
    category: 'cinematic',
    camera: 'crane_up',
    cameraIntensity: 'standard',
    style: 'golden_hour',
    shot: 'ews',
    vfx: ['light_leak', 'film_grain'],
  },
  {
    id: 'midnight_confession',
    label: 'Midnight Confession',
    tagline: 'Locked ECU, neon-noir face, smoke and shadow',
    category: 'noir',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'neo_noir',
    shot: 'ecu',
    vfx: ['sunset_grade', 'film_grain'],
  },
  {
    id: 'hyperdrive',
    label: 'Hyperdrive',
    tagline: 'Fast dolly-in, speed ramp, lens flare streak',
    category: 'action',
    camera: 'dolly_in_fast',
    cameraIntensity: 'pronounced',
    style: 'cyberpunk',
    shot: 'mcu',
    vfx: ['speed_ramp', 'lens_flare'],
  },
  {
    id: 'dust_storm',
    label: 'Dust Storm',
    tagline: 'Western pan across the horizon, dust motes, sun-baked',
    category: 'cinematic',
    camera: 'pan_right',
    cameraIntensity: 'standard',
    style: 'western',
    shot: 'ws',
    vfx: ['dust_motes', 'sunset_grade'],
  },
  {
    id: 'reverie_lift',
    label: 'Reverie Lift',
    tagline: "Tilt-shift miniature world, crane-up reveal, bird's-eye dream",
    category: 'cinematic',
    camera: 'crane_up',
    cameraIntensity: 'standard',
    style: 'tilt_shift',
    shot: 'birds_eye',
    vfx: ['bleach_bypass', 'light_leak'],
  },
  {
    id: 'glitch_frame',
    label: 'Glitch in the Frame',
    tagline: 'Crash zoom into a face, digital tear, VHS bleed',
    category: 'horror',
    camera: 'crash_zoom',
    cameraIntensity: 'pronounced',
    style: 'cyberpunk',
    shot: 'cu',
    vfx: ['glitch', 'vhs_effect'],
  },
  {
    id: 'black_box',
    label: 'Black Box',
    tagline: 'Locked CU, deep noir grade, single key light',
    category: 'noir',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'noir',
    shot: 'cu',
    vfx: ['noir_grade', 'film_grain'],
  },
  {
    id: 'festival_haze',
    label: 'Festival Haze',
    tagline: 'Slow pan, golden-hour glow, light leaks',
    category: 'social',
    camera: 'pan_left',
    cameraIntensity: 'standard',
    style: 'golden_hour',
    shot: 'ms',
    vfx: ['light_leak', 'film_grain'],
  },
  {
    id: 'cathedral_drop',
    label: 'Cathedral Drop',
    tagline: 'Crane-down into cosmic dread, low angle, heavy vignette',
    category: 'horror',
    camera: 'crane_down',
    cameraIntensity: 'pronounced',
    style: 'cosmic_horror',
    shot: 'low_angle',
    vfx: ['vignette', 'noir_grade'],
  },
  {
    id: 'race_day',
    label: 'Race Day',
    tagline: 'OTS handheld, crash zoom, speed ramp finish',
    category: 'action',
    camera: 'crash_zoom',
    cameraIntensity: 'pronounced',
    style: 'reportage',
    shot: 'ots',
    vfx: ['speed_ramp', 'lens_flare'],
  },
  {
    id: 'cold_open',
    label: 'Cold Open',
    tagline: 'Fincher locked WS, teal/orange, surgical mood',
    category: 'cinematic',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'fincher',
    shot: 'ws',
    vfx: ['teal_orange', 'film_grain'],
  },
  {
    id: 'studio_confessional',
    label: 'Studio Confessional',
    tagline: 'Locked CU interview, soft vignette, documentary lighting',
    category: 'documentary',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'documentary',
    shot: 'cu',
    vfx: ['vignette', 'film_grain'],
  },
];

/**
 * Throws at module load if any preset references a non-existent primitive id.
 * Catches drift if someone deletes a preset id from types.ts without updating
 * this file. Cheap — runs once on import.
 */
function validateViralPresets(): void {
  for (const p of VIRAL_PRESETS) {
    if (!(p.camera in CAMERA_PRESETS)) {
      throw new Error(`Viral preset '${p.id}' references unknown camera '${p.camera}'`);
    }
    if (!(p.style in STYLE_PRESETS)) {
      throw new Error(`Viral preset '${p.id}' references unknown style '${p.style}'`);
    }
    if (!(p.shot in SHOT_PRESETS)) {
      throw new Error(`Viral preset '${p.id}' references unknown shot '${p.shot}'`);
    }
    for (const v of p.vfx) {
      if (!(v in VFX_PRESETS)) {
        throw new Error(`Viral preset '${p.id}' references unknown vfx '${v}'`);
      }
    }
  }
}
validateViralPresets();

export function getViralPreset(id: string): ViralPreset | null {
  return VIRAL_PRESETS.find((p) => p.id === id) ?? null;
}

export function listViralPresets(): Array<
  Pick<ViralPreset, 'id' | 'label' | 'tagline' | 'category'> & {
    cameraLabel: string;
    styleLabel: string;
    shotLabel: string;
    vfxLabels: string[];
  }
> {
  return VIRAL_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    tagline: p.tagline,
    category: p.category,
    cameraLabel: CAMERA_PRESETS[p.camera].label,
    styleLabel: STYLE_PRESETS[p.style].label,
    shotLabel: SHOT_PRESETS[p.shot].label,
    vfxLabels: p.vfx.map((v) => VFX_PRESETS[v].label),
  }));
}
