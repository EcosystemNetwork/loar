/**
 * Relight Preset Library
 *
 * Catalog of canonical lighting / time-of-day / backdrop / color-mood
 * transformations that the relight pipeline composes into an edit prompt
 * for FAL nano-banana/edit. Each preset is a small, opinionated prompt
 * fragment chosen to produce a coherent shift while preserving subject
 * identity.
 *
 * Universe owners build "house looks" by stacking presets + free text in
 * `universeTonePacks` records (see universeStyle/tonePacks.routes.ts).
 */
export type RelightPresetKind = 'lighting' | 'time' | 'backdrop' | 'mood';

export interface RelightPreset {
  id: string;
  kind: RelightPresetKind;
  label: string;
  description: string;
  promptFragment: string;
  negativeFragment?: string;
}

export const LIGHTING_PRESETS: RelightPreset[] = [
  {
    id: 'golden-hour',
    kind: 'lighting',
    label: 'Golden Hour',
    description: 'Warm, low-angle sun with long shadows',
    promptFragment:
      'golden hour lighting, warm low-angle sunlight, long soft shadows, rim light on subject, hazy backlight',
  },
  {
    id: 'neon-night',
    kind: 'lighting',
    label: 'Neon Night',
    description: 'Saturated neon signage, wet pavement reflections',
    promptFragment:
      'neon night lighting, saturated cyan and magenta neon signs, wet pavement reflections, dark sky, color-bleed onto subject',
    negativeFragment: 'daylight, sunlight, washed out',
  },
  {
    id: 'moonlit-alley',
    kind: 'lighting',
    label: 'Moonlit Alley',
    description: 'Cool, low-key moonlight, hard edge shadows',
    promptFragment:
      'moonlit alley lighting, cool blue key light, single hard moonlight source, deep shadows, faint mist',
    negativeFragment: 'warm tones, bright daylight',
  },
  {
    id: 'stage-interview',
    kind: 'lighting',
    label: 'Stage Interview',
    description: 'Soft three-point studio lighting, neutral background',
    promptFragment:
      'stage-lit studio interview lighting, soft key + fill + rim three-point setup, controlled exposure, neutral seamless backdrop',
  },
  {
    id: 'warm-tavern',
    kind: 'lighting',
    label: 'Warm Tavern',
    description: 'Candle and hearth glow, amber tones',
    promptFragment:
      'warm tavern lighting, flickering candle and hearth glow, deep amber tones, soft falloff, smoky atmosphere',
  },
  {
    id: 'cold-wasteland',
    kind: 'lighting',
    label: 'Cold Wasteland',
    description: 'Overcast steel-grey daylight, low contrast',
    promptFragment:
      'cold wasteland lighting, overcast steel-grey diffuse daylight, low contrast, faint cyan cast, bleak ambient',
    negativeFragment: 'warm sunlight, vibrant colors',
  },
  {
    id: 'cinematic-noir',
    kind: 'lighting',
    label: 'Cinematic Noir',
    description: 'High-contrast venetian-blind shadows, monochrome lean',
    promptFragment:
      'film noir lighting, high contrast chiaroscuro, hard venetian-blind cast shadows, single tungsten key, deep blacks',
  },
  {
    id: 'volumetric-cathedral',
    kind: 'lighting',
    label: 'Volumetric Cathedral',
    description: 'God rays through dust through tall windows',
    promptFragment:
      'volumetric cathedral lighting, god rays through dust motes, tall stained glass shafts, atmospheric haze',
  },
];

export const TIME_OF_DAY_PRESETS: RelightPreset[] = [
  {
    id: 'dawn',
    kind: 'time',
    label: 'Dawn',
    description: 'Pre-sunrise pastels, mist on the ground',
    promptFragment: 'dawn, pre-sunrise pastel sky, soft pink and lavender, low ground mist',
  },
  {
    id: 'midday',
    kind: 'time',
    label: 'Midday',
    description: 'High overhead sun, sharp short shadows',
    promptFragment: 'midday, high overhead sun, sharp short shadows, vivid colors, clear sky',
  },
  {
    id: 'dusk',
    kind: 'time',
    label: 'Dusk',
    description: 'Magenta-orange horizon, deepening sky',
    promptFragment:
      'dusk, magenta and orange horizon glow, deepening blue sky, silhouette tendency',
  },
  {
    id: 'midnight',
    kind: 'time',
    label: 'Midnight',
    description: 'Deep blue-black sky, scarce light',
    promptFragment:
      'midnight, deep blue-black sky, scarce light, isolated practical light sources, stars visible',
  },
  {
    id: 'storm',
    kind: 'time',
    label: 'Storm',
    description: 'Heavy clouds, rain, dramatic lightning flashes',
    promptFragment:
      'storm weather, heavy dark clouds, falling rain, occasional dramatic lightning flash, wet surfaces',
  },
];

export const BACKDROP_PRESETS: RelightPreset[] = [
  {
    id: 'urban-rooftop',
    kind: 'backdrop',
    label: 'Urban Rooftop',
    description: 'City skyline behind, distant lights',
    promptFragment:
      'replace background with urban rooftop view, distant city skyline, soft bokeh of building lights',
  },
  {
    id: 'dense-forest',
    kind: 'backdrop',
    label: 'Dense Forest',
    description: 'Towering trees, dappled light through canopy',
    promptFragment:
      'replace background with dense forest, towering trees, dappled light through canopy, mossy undergrowth',
  },
  {
    id: 'desert-dune',
    kind: 'backdrop',
    label: 'Desert Dune',
    description: 'Endless sand dunes, pale sky',
    promptFragment:
      'replace background with rolling desert dunes, pale washed sky, distant heat shimmer',
  },
  {
    id: 'studio-seamless',
    kind: 'backdrop',
    label: 'Studio Seamless',
    description: 'Clean seamless paper backdrop',
    promptFragment:
      'replace background with clean seamless studio backdrop, even soft light, no distractions',
  },
  {
    id: 'void-black',
    kind: 'backdrop',
    label: 'Void Black',
    description: 'Pure black void background',
    promptFragment:
      'replace background with pure black void, only subject visible, minimal rim light separating subject',
  },
  {
    id: 'cyberpunk-street',
    kind: 'backdrop',
    label: 'Cyberpunk Street',
    description: 'Rainy neon-lit street, holographic signage',
    promptFragment:
      'replace background with rainy cyberpunk street, holographic signage, neon haze, distant figures with umbrellas',
  },
  {
    id: 'medieval-tavern-interior',
    kind: 'backdrop',
    label: 'Medieval Tavern Interior',
    description: 'Wood beams, hearth, hanging lanterns',
    promptFragment:
      'replace background with medieval tavern interior, dark wood beams, stone hearth, hanging iron lanterns, blurred patrons',
  },
];

export const MOOD_PRESETS: RelightPreset[] = [
  {
    id: 'teal-orange',
    kind: 'mood',
    label: 'Teal & Orange',
    description: 'Hollywood blockbuster grade',
    promptFragment:
      'teal and orange color grade, complementary skin tones against cyan shadows, cinematic blockbuster look',
  },
  {
    id: 'desaturated-bleach',
    kind: 'mood',
    label: 'Desaturated Bleach',
    description: 'Bleach-bypass desaturated grit',
    promptFragment:
      'bleach-bypass desaturated color grade, crushed blacks, gritty muted palette, slight green cast',
  },
  {
    id: 'sepia-vintage',
    kind: 'mood',
    label: 'Sepia Vintage',
    description: 'Old-photo sepia warmth',
    promptFragment: 'sepia vintage color grade, warm brown tonality, soft halation, slight grain',
  },
  {
    id: 'high-key-pastel',
    kind: 'mood',
    label: 'High-Key Pastel',
    description: 'Bright airy pastels, lifted blacks',
    promptFragment:
      'high-key pastel color grade, lifted blacks, bright airy palette, soft pinks and creams',
  },
  {
    id: 'monochrome-bw',
    kind: 'mood',
    label: 'Black & White',
    description: 'Classic monochrome, rich tonal range',
    promptFragment:
      'classic black and white monochrome, rich tonal range, deep blacks, lifted highlights',
    negativeFragment: 'color, saturated',
  },
  {
    id: 'infrared-dream',
    kind: 'mood',
    label: 'Infrared Dream',
    description: 'False-color infrared, magenta foliage',
    promptFragment:
      'false-color infrared photography look, magenta and white foliage, dreamy ethereal palette',
  },
];

export const ALL_RELIGHT_PRESETS: RelightPreset[] = [
  ...LIGHTING_PRESETS,
  ...TIME_OF_DAY_PRESETS,
  ...BACKDROP_PRESETS,
  ...MOOD_PRESETS,
];

export function getPresetById(id: string): RelightPreset | undefined {
  return ALL_RELIGHT_PRESETS.find((p) => p.id === id);
}

export function getPresetsByKind(kind: RelightPresetKind): RelightPreset[] {
  return ALL_RELIGHT_PRESETS.filter((p) => p.kind === kind);
}

/** Stored shape of a per-universe house-look preset. */
export interface UniverseTonePack {
  id: string;
  universeAddress: string;
  name: string;
  description?: string;
  presetIds: string[];
  customPromptFragment?: string;
  customNegativeFragment?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelightTonePackOverride {
  presetIds?: string[];
  customPromptFragment?: string;
  customNegativeFragment?: string;
}

export interface ComposeRelightPromptInput {
  presetIds?: string[];
  freeText?: string;
  tonePack?: RelightTonePackOverride | null;
  /** When true (default), prepend a strong subject-preservation directive. */
  preserveSubject?: boolean;
}

export interface ComposedRelightPrompt {
  prompt: string;
  negativePrompt: string;
  appliedPresetIds: string[];
}

/**
 * Build the final FAL nano-banana/edit prompt by stacking preset fragments,
 * tone-pack overrides, and free text. The leading clause locks subject
 * identity so the edit does not redraw the character.
 */
export function composeRelightPrompt(input: ComposeRelightPromptInput): ComposedRelightPrompt {
  const preserve = input.preserveSubject !== false;
  const ids = new Set<string>();

  if (input.tonePack?.presetIds) input.tonePack.presetIds.forEach((id) => ids.add(id));
  if (input.presetIds) input.presetIds.forEach((id) => ids.add(id));

  const presets = Array.from(ids)
    .map(getPresetById)
    .filter((p): p is RelightPreset => Boolean(p));

  const positiveParts: string[] = [];
  const negativeParts: string[] = [];

  if (preserve) {
    positiveParts.push(
      'preserve the exact subject identity, pose, framing, and composition of the source image; only change the lighting, atmosphere, and surrounding environment'
    );
  }

  for (const p of presets) {
    positiveParts.push(p.promptFragment);
    if (p.negativeFragment) negativeParts.push(p.negativeFragment);
  }

  if (input.tonePack?.customPromptFragment?.trim()) {
    positiveParts.push(input.tonePack.customPromptFragment.trim());
  }
  if (input.tonePack?.customNegativeFragment?.trim()) {
    negativeParts.push(input.tonePack.customNegativeFragment.trim());
  }

  if (input.freeText?.trim()) positiveParts.push(input.freeText.trim());

  if (preserve) {
    negativeParts.push(
      'different person, changed face, changed body, redrawn subject, deformed anatomy'
    );
  }

  return {
    prompt: positiveParts.join('. '),
    negativePrompt: negativeParts.join(', '),
    appliedPresetIds: presets.map((p) => p.id),
  };
}
