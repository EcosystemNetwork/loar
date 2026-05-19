/**
 * Marketing Studio — Ad Format Catalog.
 *
 * 20 named ad formats covering the templates that dominate paid-social,
 * organic-social, and DTC channels. Each format is a structured recipe:
 *
 *   • aspectRatio   — channel-appropriate (9:16 for TikTok/Reels/Shorts,
 *                     1:1 for IG feed, 16:9 for YouTube pre-roll, 4:5 for
 *                     IG feed-mobile-first).
 *   • durationSec   — short-form economics. Always 5–10s.
 *   • promptScaffold — wraps the user's product/IP description with the
 *                     beat structure ("hook → product reveal → CTA frame").
 *   • cameraPreset / stylePreset / shotPreset / vfx — same primitives the
 *                     viral-presets and editor already understand, so we
 *                     plug into the existing generate pipeline with zero
 *                     new routing.
 *
 * Pure data — no runtime side-effects. Validated at module load.
 */

import type {
  CameraPresetId,
  CameraIntensity,
  StylePresetId,
  ShotPresetId,
  VfxPresetId,
} from '../scene-controls/types';
import { CAMERA_PRESETS, STYLE_PRESETS, SHOT_PRESETS, VFX_PRESETS } from '../scene-controls/types';

export type AdChannel = 'tiktok' | 'reels' | 'shorts' | 'feed' | 'preroll' | 'story';
export type AdGoal =
  | 'awareness'
  | 'conversion'
  | 'retargeting'
  | 'launch'
  | 'social_proof'
  | 'demo';

export interface AdFormat {
  id: string;
  label: string;
  tagline: string;
  channel: AdChannel;
  goal: AdGoal;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5';
  durationSec: 5 | 6 | 8 | 10;
  /** `{product}` is replaced with the user's product/IP description. */
  promptScaffold: string;
  camera: CameraPresetId;
  cameraIntensity: CameraIntensity;
  style: StylePresetId;
  shot: ShotPresetId;
  vfx: VfxPresetId[];
}

export const AD_FORMATS: AdFormat[] = [
  // ── 9:16 short-form / TikTok / Reels / Shorts ──────────────────────
  {
    id: 'product_drop',
    label: 'Product Drop',
    tagline: 'Snap-zoom reveal of the product hero-shot',
    channel: 'tiktok',
    goal: 'launch',
    aspectRatio: '9:16',
    durationSec: 5,
    promptScaffold: 'A bold reveal of {product}, snap zoom into hero shot, dramatic lighting',
    camera: 'crash_zoom',
    cameraIntensity: 'pronounced',
    style: 'cinematic',
    shot: 'mcu',
    vfx: ['lens_flare', 'film_grain'],
  },
  {
    id: 'before_after',
    label: 'Before / After',
    tagline: 'Whip-pan transition between problem and solution',
    channel: 'reels',
    goal: 'conversion',
    aspectRatio: '9:16',
    durationSec: 6,
    promptScaffold:
      'Before-state pain point shown, whip-pan transition, after-state with {product} solving it',
    camera: 'whip_pan_right',
    cameraIntensity: 'pronounced',
    style: 'reportage',
    shot: 'two_shot',
    vfx: ['speed_ramp', 'light_leak'],
  },
  {
    id: 'unboxing_pov',
    label: 'Unboxing POV',
    tagline: 'First-person hands reaching for the product',
    channel: 'tiktok',
    goal: 'launch',
    aspectRatio: '9:16',
    durationSec: 8,
    promptScaffold: 'POV hands unboxing {product}, soft natural light, tactile close-ups',
    camera: 'walk_up',
    cameraIntensity: 'standard',
    style: 'documentary',
    shot: 'pov',
    vfx: ['film_grain', 'vignette'],
  },
  {
    id: 'founder_talking_head',
    label: 'Founder Talking Head',
    tagline: 'Authentic founder pitch, locked CU, soft vignette',
    channel: 'feed',
    goal: 'awareness',
    aspectRatio: '9:16',
    durationSec: 10,
    promptScaffold: 'A founder speaking directly to camera about {product}, sincere expression',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'documentary',
    shot: 'cu',
    vfx: ['vignette', 'film_grain'],
  },
  {
    id: 'social_proof_montage',
    label: 'Social Proof Montage',
    tagline: 'Quick-cut testimonials with cinematic grade',
    channel: 'reels',
    goal: 'social_proof',
    aspectRatio: '9:16',
    durationSec: 8,
    promptScaffold:
      'Quick montage of diverse people reacting to {product}, genuine surprise and delight',
    camera: 'handheld_subtle',
    cameraIntensity: 'standard',
    style: 'cinematic',
    shot: 'ms',
    vfx: ['teal_orange', 'film_grain'],
  },
  {
    id: 'lifestyle_dolly',
    label: 'Lifestyle Dolly',
    tagline: 'Slow push through an aspirational scene',
    channel: 'reels',
    goal: 'awareness',
    aspectRatio: '9:16',
    durationSec: 8,
    promptScaffold:
      'Slow dolly through an aspirational lifestyle scene featuring {product}, warm light',
    camera: 'dolly_in_slow',
    cameraIntensity: 'standard',
    style: 'golden_hour',
    shot: 'ms',
    vfx: ['light_leak', 'film_grain'],
  },
  {
    id: 'pattern_interrupt',
    label: 'Pattern Interrupt',
    tagline: 'Glitch + crash zoom — stops the scroll',
    channel: 'tiktok',
    goal: 'awareness',
    aspectRatio: '9:16',
    durationSec: 5,
    promptScaffold:
      'Sudden glitch, crash zoom into {product} on a black background, hard-cut energy',
    camera: 'crash_zoom',
    cameraIntensity: 'pronounced',
    style: 'cyberpunk',
    shot: 'cu',
    vfx: ['glitch', 'vhs_effect'],
  },
  {
    id: 'product_orbit',
    label: 'Product Orbit',
    tagline: 'Cinematic 360° around the product',
    channel: 'feed',
    goal: 'demo',
    aspectRatio: '9:16',
    durationSec: 6,
    promptScaffold: 'Cinematic 360-degree orbit around {product}, studio lighting, hero shot',
    camera: 'orbit_right_fast',
    cameraIntensity: 'pronounced',
    style: 'cinematic',
    shot: 'mcu',
    vfx: ['lens_flare', 'teal_orange'],
  },

  // ── 1:1 IG feed ────────────────────────────────────────────────────
  {
    id: 'feed_hero',
    label: 'Feed Hero',
    tagline: 'Centered hero shot, locked frame, premium grade',
    channel: 'feed',
    goal: 'awareness',
    aspectRatio: '1:1',
    durationSec: 5,
    promptScaffold:
      '{product} centered as a hero shot, locked frame, premium product photography aesthetic',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'cinematic',
    shot: 'mcu',
    vfx: ['teal_orange', 'vignette'],
  },
  {
    id: 'feed_question',
    label: 'Question Hook',
    tagline: 'Talking head opening with a hook question',
    channel: 'feed',
    goal: 'conversion',
    aspectRatio: '1:1',
    durationSec: 8,
    promptScaffold:
      'A person asking a relatable hook question about a problem {product} solves, direct eye contact',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'documentary',
    shot: 'mcu',
    vfx: ['vignette'],
  },

  // ── 4:5 IG mobile-first ────────────────────────────────────────────
  {
    id: 'mobile_pull_back',
    label: 'Mobile Pull-Back',
    tagline: 'Slow pull-back revealing context around the product',
    channel: 'feed',
    goal: 'launch',
    aspectRatio: '4:5',
    durationSec: 6,
    promptScaffold:
      'Slow pull-back from {product} revealing the lifestyle context around it, soft daylight',
    camera: 'dolly_out_slow',
    cameraIntensity: 'standard',
    style: 'cinematic',
    shot: 'ms',
    vfx: ['film_grain'],
  },
  {
    id: 'demo_close_up',
    label: 'Demo Close-Up',
    tagline: 'Macro detail of the product in use',
    channel: 'feed',
    goal: 'demo',
    aspectRatio: '4:5',
    durationSec: 6,
    promptScaffold: 'Macro close-up demonstrating {product} in use, every detail visible',
    camera: 'dolly_in_slow',
    cameraIntensity: 'subtle',
    style: 'cinematic',
    shot: 'macro',
    vfx: ['film_grain', 'vignette'],
  },

  // ── 16:9 YouTube pre-roll ──────────────────────────────────────────
  {
    id: 'preroll_cinema',
    label: 'Pre-Roll Cinema',
    tagline: 'Cinematic crane reveal — pre-roll opening',
    channel: 'preroll',
    goal: 'awareness',
    aspectRatio: '16:9',
    durationSec: 6,
    promptScaffold:
      'Cinematic crane down revealing {product} in an aspirational location, golden hour light',
    camera: 'crane_down',
    cameraIntensity: 'standard',
    style: 'cinematic',
    shot: 'ews',
    vfx: ['teal_orange', 'film_grain'],
  },
  {
    id: 'preroll_announce',
    label: 'Pre-Roll Announcement',
    tagline: 'Locked WS title-card opening',
    channel: 'preroll',
    goal: 'launch',
    aspectRatio: '16:9',
    durationSec: 5,
    promptScaffold: 'A locked wide shot of {product} as a launch announcement, dramatic lighting',
    camera: 'locked',
    cameraIntensity: 'subtle',
    style: 'kubrick',
    shot: 'ws',
    vfx: ['bleach_bypass', 'film_grain'],
  },
  {
    id: 'preroll_chase',
    label: 'Pre-Roll Chase',
    tagline: 'Fast push + speed ramp — high-energy retarget',
    channel: 'preroll',
    goal: 'retargeting',
    aspectRatio: '16:9',
    durationSec: 5,
    promptScaffold:
      'A fast push toward {product} mid-action, kinetic energy, speed ramp to final reveal',
    camera: 'dolly_in_fast',
    cameraIntensity: 'pronounced',
    style: 'cinematic',
    shot: 'mcu',
    vfx: ['speed_ramp', 'lens_flare'],
  },

  // ── Story / 9:16 short ─────────────────────────────────────────────
  {
    id: 'story_handheld',
    label: 'Story Handheld',
    tagline: 'Documentary handheld walk-up, intimate scale',
    channel: 'story',
    goal: 'awareness',
    aspectRatio: '9:16',
    durationSec: 6,
    promptScaffold:
      'Documentary handheld walking up to {product} in an authentic setting, candid feel',
    camera: 'walk_up',
    cameraIntensity: 'standard',
    style: 'reportage',
    shot: 'mcu',
    vfx: ['film_grain', 'vignette'],
  },
  {
    id: 'story_tease',
    label: 'Story Tease',
    tagline: 'Slow tilt-up — drip-feed reveal',
    channel: 'story',
    goal: 'awareness',
    aspectRatio: '9:16',
    durationSec: 5,
    promptScaffold: 'A slow tilt up the silhouette of {product}, mysterious tease, hard backlight',
    camera: 'tilt_up',
    cameraIntensity: 'standard',
    style: 'neo_noir',
    shot: 'low_angle',
    vfx: ['noir_grade', 'lens_flare'],
  },

  // ── DTC-style ──────────────────────────────────────────────────────
  {
    id: 'dtc_problem_first',
    label: 'DTC Problem-First',
    tagline: 'Show the problem, then the product solves it',
    channel: 'feed',
    goal: 'conversion',
    aspectRatio: '9:16',
    durationSec: 10,
    promptScaffold:
      'Visualize the daily problem first, then {product} appears and solves it elegantly',
    camera: 'handheld_subtle',
    cameraIntensity: 'standard',
    style: 'documentary',
    shot: 'ms',
    vfx: ['teal_orange', 'film_grain'],
  },
  {
    id: 'dtc_review_pull',
    label: 'DTC Review Pull',
    tagline: 'Customer-review text overlay vibe + product hero shot',
    channel: 'reels',
    goal: 'social_proof',
    aspectRatio: '9:16',
    durationSec: 8,
    promptScaffold:
      'A 5-star customer review feeling layered over a beauty shot of {product}, premium quiet energy',
    camera: 'dolly_in_slow',
    cameraIntensity: 'subtle',
    style: 'cinematic',
    shot: 'cu',
    vfx: ['film_grain', 'vignette'],
  },
  {
    id: 'dtc_user_loop',
    label: 'DTC User Loop',
    tagline: 'Seamless loop of the product in daily use',
    channel: 'feed',
    goal: 'demo',
    aspectRatio: '1:1',
    durationSec: 6,
    promptScaffold:
      'A seamless loop of {product} in daily-use montage, hands and product details only',
    camera: 'handheld_subtle',
    cameraIntensity: 'subtle',
    style: 'reportage',
    shot: 'mcu',
    vfx: ['film_grain'],
  },
];

function validate(): void {
  for (const f of AD_FORMATS) {
    if (!(f.camera in CAMERA_PRESETS))
      throw new Error(`Ad format '${f.id}' references unknown camera '${f.camera}'`);
    if (!(f.style in STYLE_PRESETS))
      throw new Error(`Ad format '${f.id}' references unknown style '${f.style}'`);
    if (!(f.shot in SHOT_PRESETS))
      throw new Error(`Ad format '${f.id}' references unknown shot '${f.shot}'`);
    for (const v of f.vfx) {
      if (!(v in VFX_PRESETS)) throw new Error(`Ad format '${f.id}' references unknown vfx '${v}'`);
    }
    if (!f.promptScaffold.includes('{product}')) {
      throw new Error(`Ad format '${f.id}' scaffold missing required {product} placeholder`);
    }
  }
}
validate();

export function getAdFormat(id: string): AdFormat | null {
  return AD_FORMATS.find((f) => f.id === id) ?? null;
}

export function listAdFormats(): Array<
  Pick<
    AdFormat,
    'id' | 'label' | 'tagline' | 'channel' | 'goal' | 'aspectRatio' | 'durationSec'
  > & {
    cameraLabel: string;
    styleLabel: string;
    shotLabel: string;
  }
> {
  return AD_FORMATS.map((f) => ({
    id: f.id,
    label: f.label,
    tagline: f.tagline,
    channel: f.channel,
    goal: f.goal,
    aspectRatio: f.aspectRatio,
    durationSec: f.durationSec,
    cameraLabel: CAMERA_PRESETS[f.camera].label,
    styleLabel: STYLE_PRESETS[f.style].label,
    shotLabel: SHOT_PRESETS[f.shot].label,
  }));
}

/**
 * Compose the final generate-pipeline payload for an ad format + product
 * description. Returns the input shape expected by `generation.generate`.
 */
export function resolveAdFormat(
  formatId: string,
  productDescription: string
): {
  prompt: string;
  cameraPreset: CameraPresetId;
  cameraIntensity: CameraIntensity;
  stylePreset: StylePresetId;
  shotPreset: ShotPresetId;
  vfx: VfxPresetId[];
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5';
  durationSec: 5 | 6 | 8 | 10;
} | null {
  const f = getAdFormat(formatId);
  if (!f) return null;
  return {
    prompt: f.promptScaffold.replace('{product}', productDescription.trim()),
    cameraPreset: f.camera,
    cameraIntensity: f.cameraIntensity,
    stylePreset: f.style,
    shotPreset: f.shot,
    vfx: f.vfx,
    aspectRatio: f.aspectRatio,
    durationSec: f.durationSec,
  };
}
