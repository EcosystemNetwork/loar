/**
 * Scene Controls — Shared Types
 *
 * Types for camera presets, VFX presets, style presets, motion masks,
 * keyframe handoff, and character identity conditioning.
 * Used across the generation pipeline, node schema, and frontend UI.
 */

// ── Camera Motion Presets ────────────────────────────────────────────

export const CAMERA_PRESETS = {
  // Static
  locked: { label: 'Locked', category: 'static', description: 'Camera is completely still' },
  handheld_subtle: {
    label: 'Handheld Subtle',
    category: 'static',
    description: 'Slight natural shake, as if held by a person',
  },

  // Dolly
  dolly_in_slow: {
    label: 'Dolly In Slow',
    category: 'dolly',
    description: 'Camera slowly moves toward the subject',
  },
  dolly_in_fast: {
    label: 'Dolly In Fast',
    category: 'dolly',
    description: 'Camera quickly pushes toward the subject',
  },
  dolly_out_slow: {
    label: 'Dolly Out Slow',
    category: 'dolly',
    description: 'Camera slowly pulls back from the subject',
  },
  dolly_out_fast: {
    label: 'Dolly Out Fast',
    category: 'dolly',
    description: 'Camera quickly pulls back from the subject',
  },

  // Pan
  pan_left: { label: 'Pan Left', category: 'pan', description: 'Camera pivots left on its axis' },
  pan_right: {
    label: 'Pan Right',
    category: 'pan',
    description: 'Camera pivots right on its axis',
  },

  // Tilt
  tilt_up: { label: 'Tilt Up', category: 'tilt', description: 'Camera tilts upward' },
  tilt_down: { label: 'Tilt Down', category: 'tilt', description: 'Camera tilts downward' },

  // Orbit
  orbit_left_slow: {
    label: 'Orbit Left Slow',
    category: 'orbit',
    description: 'Camera orbits slowly around the subject to the left',
  },
  orbit_right_slow: {
    label: 'Orbit Right Slow',
    category: 'orbit',
    description: 'Camera orbits slowly around the subject to the right',
  },
  orbit_right_fast: {
    label: 'Orbit Right Fast',
    category: 'orbit',
    description: 'Camera orbits quickly around the subject to the right',
  },

  // Crane
  crane_up: {
    label: 'Crane Up',
    category: 'crane',
    description: 'Camera rises vertically, looking down',
  },
  crane_down: {
    label: 'Crane Down',
    category: 'crane',
    description: 'Camera descends vertically, looking up',
  },

  // Push
  whip_pan_right: {
    label: 'Whip Pan Right',
    category: 'push',
    description: 'Extremely fast horizontal pan to the right',
  },
} as const;

export type CameraPresetId = keyof typeof CAMERA_PRESETS;
export type CameraIntensity = 'subtle' | 'standard' | 'pronounced';

export interface CameraPresetConfig {
  label: string;
  category: string;
  description: string;
}

// ── Style Presets ────────────────────────────────────────────────────

export const STYLE_PRESETS = {
  noir: {
    label: 'Noir',
    promptPrefix:
      'Film noir style, high contrast black and white, dramatic shadows, moody lighting,',
    promptSuffix: 'dramatic chiaroscuro, venetian blinds shadows, smoky atmosphere',
    color: '#1a1a2e',
  },
  watercolor: {
    label: 'Watercolor',
    promptPrefix: 'Watercolor painting style, soft edges, flowing colors, artistic brush strokes,',
    promptSuffix: 'delicate washes, transparent layers, paper texture visible',
    color: '#a8d8ea',
  },
  vhs_80s: {
    label: "'80s VHS",
    promptPrefix:
      '1980s VHS aesthetic, retro scan lines, warm color grading, slight tracking artifacts,',
    promptSuffix: 'vintage television look, neon glow, synth-wave atmosphere',
    color: '#ff6b9d',
  },
  anime: {
    label: 'Anime',
    promptPrefix: 'Anime style, cel-shaded, vibrant colors, detailed line art,',
    promptSuffix: 'Japanese animation aesthetic, expressive eyes, dynamic composition',
    color: '#c44dff',
  },
  cyberpunk: {
    label: 'Cyberpunk',
    promptPrefix: 'Cyberpunk aesthetic, neon-lit, rain-soaked streets, holographic displays,',
    promptSuffix: 'dystopian future, electric blue and magenta lighting, high-tech low-life',
    color: '#00fff5',
  },
  fantasy: {
    label: 'Fantasy',
    promptPrefix: 'Epic fantasy style, magical atmosphere, ethereal lighting, rich golden tones,',
    promptSuffix: 'enchanted, mystical, otherworldly glow, detailed ornate textures',
    color: '#ffd700',
  },
  horror: {
    label: 'Horror',
    promptPrefix: 'Horror film aesthetic, desaturated, eerie green tint, unsettling atmosphere,',
    promptSuffix: 'darkness encroaching, barely visible details, sense of dread',
    color: '#2d0a0a',
  },
  documentary: {
    label: 'Documentary',
    promptPrefix: 'Documentary style, naturalistic lighting, handheld camera feel,',
    promptSuffix: 'authentic, raw footage look, observational, unfiltered',
    color: '#8b7355',
  },
  comic_book: {
    label: 'Comic Book',
    promptPrefix: 'Comic book style, bold outlines, halftone dots, saturated primary colors,',
    promptSuffix: 'pop art influence, dynamic action lines, graphic novel aesthetic',
    color: '#ff4444',
  },
  cinematic: {
    label: 'Cinematic',
    promptPrefix: 'Cinematic, anamorphic lens, shallow depth of field, film grain,',
    promptSuffix: 'Hollywood blockbuster look, dramatic composition, 2.39:1 framing feel',
    color: '#2c3e50',
  },
  surreal: {
    label: 'Surreal',
    promptPrefix: 'Surrealist style, dreamlike, impossible geometry, melting forms,',
    promptSuffix: 'Salvador Dali inspired, subconscious imagery, bizarre juxtapositions',
    color: '#9b59b6',
  },
  steampunk: {
    label: 'Steampunk',
    promptPrefix: 'Steampunk aesthetic, brass and copper tones, Victorian-era machinery,',
    promptSuffix: 'gears and steam, ornate mechanical details, sepia-tinted',
    color: '#b87333',
  },
} as const;

export type StylePresetId = keyof typeof STYLE_PRESETS;

export interface StylePresetConfig {
  label: string;
  promptPrefix: string;
  promptSuffix: string;
  color: string;
}

// ── VFX Presets ──────────────────────────────────────────────────────

export const VFX_PRESETS = {
  // Color grading
  noir_grade: {
    label: 'Noir Grade',
    category: 'color',
    description: 'High contrast black & white with crushed blacks',
    ffmpegFilters: 'hue=s=0,curves=m=0/0 0.25/0.1 0.5/0.4 0.75/0.8 1/1',
  },
  sunset_grade: {
    label: 'Sunset Grade',
    category: 'color',
    description: 'Warm orange/golden color grading',
    ffmpegFilters: 'colorbalance=rs=0.15:gs=-0.05:bs=-0.15:rm=0.1:gm=0.0:bm=-0.1',
  },
  teal_orange: {
    label: 'Teal & Orange',
    category: 'color',
    description: 'Hollywood blockbuster color grading',
    ffmpegFilters: 'colorbalance=rs=0.1:gs=-0.05:bs=-0.15:rh=-0.1:gh=0.0:bh=0.15',
  },
  bleach_bypass: {
    label: 'Bleach Bypass',
    category: 'color',
    description: 'Desaturated, high-contrast silver look',
    ffmpegFilters: 'hue=s=0.5,curves=m=0/0 0.15/0.05 0.5/0.5 0.85/0.95 1/1',
  },

  // Film effects
  film_grain: {
    label: 'Film Grain',
    category: 'film',
    description: 'Adds realistic 35mm film grain',
    ffmpegFilters: 'noise=alls=20:allf=t+u',
  },
  vhs_effect: {
    label: 'VHS Effect',
    category: 'film',
    description: 'Retro VHS tape distortion',
    ffmpegFilters:
      'noise=alls=15:allf=t,hue=s=0.85,colorbalance=rs=0.05:gs=-0.02:bs=-0.05,rgbashift=rh=2:bh=-2',
  },

  // Light effects
  lens_flare: {
    label: 'Lens Flare',
    category: 'light',
    description: 'Adds an anamorphic lens flare streak',
    ffmpegFilters: 'vignette=PI/4,curves=m=0/0 0.5/0.55 1/1',
  },
  light_leak: {
    label: 'Light Leak',
    category: 'light',
    description: 'Warm light leak from the edges',
    ffmpegFilters: 'vignette=PI/5:a0=0.4,colorbalance=rh=0.08:gh=0.02:bh=-0.02',
  },

  // Speed effects
  slow_motion: {
    label: 'Slow Motion',
    category: 'speed',
    description: '50% speed with motion interpolation',
    ffmpegFilters: 'setpts=2*PTS',
  },
  speed_ramp: {
    label: 'Speed Ramp',
    category: 'speed',
    description: 'Starts slow then accelerates',
    // Approximated with a pts expression that slows the first half
    ffmpegFilters: "setpts='if(lt(N,N_FRAMES/2),2*PTS,0.5*PTS)'",
  },

  // Atmosphere
  rain_overlay: {
    label: 'Rain Overlay',
    category: 'atmosphere',
    description: 'Adds falling rain effect',
    // Simulated with noise + directional blur
    ffmpegFilters: 'noise=alls=8:allf=t,hue=s=0.9,colorbalance=rs=-0.03:gs=-0.02:bs=0.05',
  },
  dust_motes: {
    label: 'Dust Motes',
    category: 'atmosphere',
    description: 'Floating dust particles in light beams',
    ffmpegFilters: 'noise=alls=5:allf=u,curves=m=0/0 0.5/0.55 1/1',
  },

  // Distortion
  glitch: {
    label: 'Glitch',
    category: 'distortion',
    description: 'Digital glitch / data corruption effect',
    ffmpegFilters: 'rgbashift=rh=5:rv=-3:bh=-5:bv=3,noise=alls=30:allf=t',
  },
  vignette: {
    label: 'Vignette',
    category: 'distortion',
    description: 'Dark edges, focus toward center',
    ffmpegFilters: 'vignette=PI/4',
  },
} as const;

export type VfxPresetId = keyof typeof VFX_PRESETS;

export interface VfxPresetConfig {
  label: string;
  category: string;
  description: string;
  ffmpegFilters: string;
}

// ── Motion Mask ──────────────────────────────────────────────────────

export interface MotionMaskData {
  maskHash: string; // SHA-256 hash of the PNG mask stored in storage
  maskUrl?: string; // Resolved URL for the mask image
}

// ── Keyframe Handoff ─────────────────────────────────────────────────

export type StartFrameSource = string | 'first-frame-of-input' | null;
export type EndFrameTarget = string | 'free' | null;

// ── Cast / Character Identity ────────────────────────────────────────

export interface CastMember {
  id: string;
  universeId: string;
  name: string;
  description: string;
  referenceImageHashes: string[]; // SHA-256 hashes in storage
  referenceImageUrls?: string[]; // Resolved URLs (not persisted, resolved at query time)
  createdBy: string; // wallet address
  createdAt: Date;
  updatedAt: Date;
}

// ── Extended Node Data ───────────────────────────────────────────────
// These fields extend the existing TimelineNodeData interface on the frontend

export interface SceneControlFields {
  // Camera (Feature 2)
  cameraPreset: CameraPresetId | null;
  cameraIntensity: CameraIntensity;

  // Cast (Feature 3)
  castMemberIds: string[];

  // Motion mask (Feature 4)
  motionMaskHash: string | null;
  useSourceMask: boolean;

  // Keyframe handoff (Feature 5)
  startFrameFrom: StartFrameSource;
  endFrameTarget: EndFrameTarget;

  // VFX (Feature 6)
  vfxPresets: VfxPresetId[];

  // Style (Feature 7)
  stylePreset: StylePresetId | null;
  styleInherits: boolean;
}

/** Default values for all scene control fields */
export const DEFAULT_SCENE_CONTROLS: SceneControlFields = {
  cameraPreset: null,
  cameraIntensity: 'standard',
  castMemberIds: [],
  motionMaskHash: null,
  useSourceMask: false,
  startFrameFrom: null,
  endFrameTarget: null,
  vfxPresets: [],
  stylePreset: null,
  styleInherits: true,
};

// ── Provider capability flags ────────────────────────────────────────

export interface ProviderCapabilities {
  supportsStructuredCamera: boolean;
  supportsIdentityConditioning: boolean;
  supportsMotionMask: boolean;
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  supportsStyleParam: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  bytedance: {
    supportsStructuredCamera: true,
    supportsIdentityConditioning: true, // reference_to_video mode
    supportsMotionMask: false, // not yet in Seedance 2
    supportsStartFrame: true, // image_to_video with last frame
    supportsEndFrame: true, // endImageUrl parameter
    supportsStyleParam: true, // style parameter
  },
  fal: {
    supportsStructuredCamera: false, // prompt-based only
    supportsIdentityConditioning: false, // no built-in identity conditioning
    supportsMotionMask: true, // some FAL models support masks (Kling)
    supportsStartFrame: true, // image_to_video
    supportsEndFrame: false,
    supportsStyleParam: false,
  },
};
