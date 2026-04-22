export const STYLE_PRESETS = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    suffix: 'cinematic lighting, 35mm film, shallow depth of field, color graded',
  },
  {
    id: 'photoreal',
    label: 'Photoreal',
    suffix: 'hyperrealistic, sharp focus, natural lighting, DSLR photo, 8k',
  },
  {
    id: 'anime',
    label: 'Anime',
    suffix: 'anime style, vibrant colors, cel-shaded, expressive eyes, Studio Ghibli inspired',
  },
  {
    id: 'manga',
    label: 'Manga',
    suffix: 'black and white manga panel, ink lines, screentone shading, dynamic composition',
  },
  {
    id: 'comic',
    label: 'Comic',
    suffix: 'western comic book art, bold ink outlines, halftone dots, dramatic shading',
  },
  {
    id: 'pixar',
    label: '3D Render',
    suffix:
      'pixar-style 3D render, soft global illumination, subsurface scattering, expressive character',
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    suffix: 'soft watercolor painting, paper texture, bleeding edges, pastel palette',
  },
  {
    id: 'oil',
    label: 'Oil Painting',
    suffix: 'classical oil painting, visible brushstrokes, rich impasto, chiaroscuro lighting',
  },
  {
    id: 'pixel',
    label: 'Pixel Art',
    suffix: '16-bit pixel art, limited palette, crisp pixels, retro game sprite',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    suffix: 'cyberpunk neon, rain-slick streets, holographic signs, cinematic rim lighting',
  },
  {
    id: 'noir',
    label: 'Film Noir',
    suffix: 'black and white film noir, harsh shadows, venetian blind lighting, 1940s mood',
  },
  {
    id: 'fantasy',
    label: 'High Fantasy',
    suffix: 'epic fantasy concept art, painterly style, golden hour, mythic scale',
  },
  {
    id: 'studio',
    label: 'Studio Portrait',
    suffix: 'studio portrait photography, softbox lighting, plain backdrop, sharp eyes',
  },
  {
    id: 'lowpoly',
    label: 'Low Poly',
    suffix: 'low poly 3D, flat shading, geometric facets, minimal palette',
  },
  {
    id: 'isometric',
    label: 'Isometric',
    suffix: 'isometric illustration, clean vector shapes, soft shadows, game asset',
  },
  {
    id: 'vaporwave',
    label: 'Vaporwave',
    suffix: 'vaporwave aesthetic, pastel pink and cyan, retro grid, 1990s VHS feel',
  },
] as const;

export const RESTYLE_MODELS = [
  { id: 'restyle-wan-v2v', label: 'WAN v2v' },
  { id: 'restyle-kling-v2v', label: 'Kling v2v (premium)' },
] as const;

export const INTERPOLATE_MULTIPLIERS = [2, 4, 8] as const;
export const VIDEO_DURATIONS = [3, 5, 8, 10] as const;
export const VIDEO_RESOLUTIONS = ['720p', '1080p'] as const;

export const CAMERA_PRESET_OPTIONS = [
  { id: '', label: 'No motion preset' },
  { id: 'locked', label: 'Locked' },
  { id: 'handheld_subtle', label: 'Handheld' },
  { id: 'dolly_in_slow', label: 'Dolly In (slow)' },
  { id: 'dolly_in_fast', label: 'Dolly In (fast)' },
  { id: 'dolly_out_slow', label: 'Dolly Out (slow)' },
  { id: 'dolly_out_fast', label: 'Dolly Out (fast)' },
  { id: 'pan_left', label: 'Pan Left' },
  { id: 'pan_right', label: 'Pan Right' },
  { id: 'tilt_up', label: 'Tilt Up' },
  { id: 'tilt_down', label: 'Tilt Down' },
  { id: 'orbit_left_slow', label: 'Orbit Left' },
  { id: 'orbit_right_slow', label: 'Orbit Right' },
  { id: 'orbit_right_fast', label: 'Orbit Right (fast)' },
  { id: 'crane_up', label: 'Crane Up' },
  { id: 'crane_down', label: 'Crane Down' },
  { id: 'whip_pan_right', label: 'Whip Pan' },
  { id: 'crash_zoom', label: 'Crash Zoom' },
  { id: 'walk_up', label: 'Walk Up (POV)' },
] as const;

export const QUICK_RELIGHT_PRESETS = [
  { id: 'golden-hour', label: 'Golden Hour' },
  { id: 'neon-night', label: 'Neon Night' },
  { id: 'moonlit-alley', label: 'Moonlit Alley' },
  { id: 'stage-interview', label: 'Studio' },
  { id: 'warm-tavern', label: 'Warm Tavern' },
  { id: 'cold-wasteland', label: 'Cold Wasteland' },
  { id: 'cinematic-noir', label: 'Noir' },
  { id: 'volumetric-cathedral', label: 'God Rays' },
] as const;

export const OUTPAINT_ASPECTS = ['1:1', '4:5', '16:9', '9:16', '21:9'] as const;

import type { VideoModel } from '@/types/sandbox.types';
export const VIDEO_MODELS: { value: VideoModel; label: string; badge?: string }[] = [
  { value: 'seedance', label: 'Seedance 2.0', badge: 'Free' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', badge: 'Free' },
  { value: 'fal-kling', label: 'Kling 2.5' },
  { value: 'fal-wan25', label: 'Wan 2.5' },
  { value: 'fal-veo3', label: 'Veo 3' },
];

export const VALID_VIDEO_MODELS = new Set<VideoModel>(VIDEO_MODELS.map((m) => m.value));
export const SEEDANCE_MODELS = new Set<VideoModel>(['seedance', 'seedance-fast']);

export const IMAGE_SIZES = [
  { value: 'landscape_16_9', label: '16:9 Landscape' },
  { value: 'portrait_16_9', label: '9:16 Portrait' },
  { value: 'square_hd', label: '1:1 Square' },
] as const;

export const MODEL_REGISTRY_MAP: Record<VideoModel, { t2v: string; i2v: string }> = {
  seedance: { t2v: 'seedance2-t2v', i2v: 'seedance2-i2v' },
  'seedance-fast': { t2v: 'seedance2-fast-t2v', i2v: 'seedance2-fast-i2v' },
  'fal-kling': { t2v: 'kling-t2v', i2v: 'kling-i2v' },
  'fal-wan25': { t2v: 'wan25-t2v', i2v: 'wan25-i2v' },
  'fal-veo3': { t2v: 'veo31-t2v', i2v: 'veo31-i2v' },
};

export type EditOp =
  | 'upscale'
  | 'remove-bg'
  | 'relight'
  | 'outpaint'
  | 'restyle'
  | 'extend'
  | 'interpolate';
export const EDIT_OP_LABELS: Record<EditOp, string> = {
  upscale: '4× Upscale',
  'remove-bg': 'Remove BG',
  relight: 'Relight',
  outpaint: 'Outpaint',
  restyle: 'Restyle',
  extend: 'Extend',
  interpolate: 'Smooth Motion',
};

export const MAX_CONCURRENT_GENS = 12;
export const MAX_RETRIES_PER_GEN = 2;
export const QUEUE_STORAGE_KEY = 'loar:sandbox:queue:v1';
export const QUEUE_MAX_PERSISTED = 50;
export const SANDBOX_TABS: { id: any; label: string; hint: string }[] = [
  { id: 'image', label: 'Image', hint: 'text→image, image→image, edits' },
  { id: 'video', label: 'Video', hint: 'text→video, image→video, v2v, extend' },
  { id: 'voice', label: 'Voice', hint: 'TTS + sound effects' },
  { id: 'audio', label: 'Audio', hint: 'music + ambient (text→music)' },
  { id: '3d', label: '3D', hint: 'text→3D and image→3D' },
  { id: 'talking', label: 'Talking', hint: 'image + dialogue → lip-synced clip' },
];
export const VARIATION_OPTIONS = [1, 2, 4, 10] as const;
