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

  // PRD 8 motion presets
  crash_zoom: {
    label: 'Crash Zoom',
    category: 'dolly',
    description: 'Aggressive snap-zoom toward subject — comedic / shock framing',
  },
  walk_up: {
    label: 'Walk Up',
    category: 'dolly',
    description: 'Camera walks toward subject at human pace — POV approach',
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
  // ── Cinematic / Film Era ─────────────────────────────────────────
  cinematic: {
    label: 'Cinematic',
    category: 'cinematic',
    promptPrefix: 'Cinematic, anamorphic lens, shallow depth of field, film grain,',
    promptSuffix: 'Hollywood blockbuster look, dramatic composition, 2.39:1 framing feel',
    color: '#2c3e50',
  },
  noir: {
    label: 'Film Noir',
    category: 'cinematic',
    promptPrefix:
      'Film noir style, high contrast black and white, dramatic shadows, moody lighting,',
    promptSuffix: 'dramatic chiaroscuro, venetian blinds shadows, smoky atmosphere',
    color: '#1a1a2e',
  },
  neo_noir: {
    label: 'Neo-Noir',
    category: 'cinematic',
    promptPrefix: 'Neo-noir, saturated nighttime colors, rain-slicked streets, neon reflections,',
    promptSuffix: 'Blade Runner influence, smoky air, deep shadows, low-key cyan and amber',
    color: '#0d3b66',
  },
  wes_anderson: {
    label: 'Wes Anderson',
    category: 'cinematic',
    promptPrefix:
      'Wes Anderson aesthetic, perfectly symmetric framing, pastel palette, planimetric composition,',
    promptSuffix: 'whimsical, retro-mid-century props, deadpan staging, soft directional light',
    color: '#f4c2a1',
  },
  kubrick: {
    label: 'Kubrick',
    category: 'cinematic',
    promptPrefix: 'Kubrick-style one-point perspective, wide-angle, geometric symmetry,',
    promptSuffix: 'cold detached gaze, hyperreal lighting, monumental architecture',
    color: '#1d1f2b',
  },
  deakins: {
    label: 'Deakins',
    category: 'cinematic',
    promptPrefix:
      'Roger Deakins-style cinematography, painterly silhouettes, single-source backlight,',
    promptSuffix: 'massive negative space, naturalistic but elevated, immaculate composition',
    color: '#3a4a5b',
  },
  fincher: {
    label: 'Fincher',
    category: 'cinematic',
    promptPrefix:
      'David Fincher aesthetic, desaturated greens and yellows, surgical precision framing,',
    promptSuffix: 'clinical mood, perfect symmetry, motivated key light, oppressive cleanliness',
    color: '#4a5d3c',
  },
  silent_film: {
    label: 'Silent Film',
    category: 'cinematic',
    promptPrefix: 'Silent film era, black and white, soft vignette, theatrical staging,',
    promptSuffix: '1920s motion picture, slight flicker, halation around bright sources',
    color: '#2a2a2a',
  },
  giallo: {
    label: 'Giallo',
    category: 'cinematic',
    promptPrefix: 'Italian giallo, saturated red and amber, expressive theatrical lighting,',
    promptSuffix: 'Argento influence, surreal violence, ornate interiors, lurid mood',
    color: '#a8001f',
  },

  // ── Genre ──────────────────────────────────────────────────────
  cyberpunk: {
    label: 'Cyberpunk',
    category: 'genre',
    promptPrefix: 'Cyberpunk aesthetic, neon-lit, rain-soaked streets, holographic displays,',
    promptSuffix: 'dystopian future, electric blue and magenta lighting, high-tech low-life',
    color: '#00fff5',
  },
  solarpunk: {
    label: 'Solarpunk',
    category: 'genre',
    promptPrefix:
      'Solarpunk aesthetic, lush greenery integrated with architecture, golden sunlight, art-nouveau curves,',
    promptSuffix: 'hopeful future, soft pastels, vines climbing solar panels, abundant nature',
    color: '#7cc576',
  },
  dieselpunk: {
    label: 'Dieselpunk',
    category: 'genre',
    promptPrefix:
      'Dieselpunk, 1940s industrial machinery, riveted steel, art-deco ornamentation, smoky atmosphere,',
    promptSuffix: 'sepia-and-bronze palette, propaganda-poster grandeur, oppressive scale',
    color: '#7a5c3b',
  },
  fantasy: {
    label: 'High Fantasy',
    category: 'genre',
    promptPrefix: 'Epic fantasy style, magical atmosphere, ethereal lighting, rich golden tones,',
    promptSuffix: 'enchanted, mystical, otherworldly glow, detailed ornate textures',
    color: '#ffd700',
  },
  dark_fantasy: {
    label: 'Dark Fantasy',
    category: 'genre',
    promptPrefix:
      'Dark fantasy, grimdark atmosphere, weathered armor, oppressive overcast sky, baroque detail,',
    promptSuffix: 'Frazetta meets Soulsborne, blood-rust palette, monumental ruins',
    color: '#3d2018',
  },
  horror: {
    label: 'Horror',
    category: 'genre',
    promptPrefix: 'Horror film aesthetic, desaturated, eerie green tint, unsettling atmosphere,',
    promptSuffix: 'darkness encroaching, barely visible details, sense of dread',
    color: '#2d0a0a',
  },
  cosmic_horror: {
    label: 'Cosmic Horror',
    category: 'genre',
    promptPrefix:
      'Lovecraftian cosmic horror, impossible geometry, deep oceanic blacks, sickly bioluminescence,',
    promptSuffix: 'tentacular silhouettes, eldritch scale, paranoid mood',
    color: '#0a1b1f',
  },
  western: {
    label: 'Spaghetti Western',
    category: 'genre',
    promptPrefix:
      'Spaghetti western, sun-bleached desert, long shadows, dusty sepia palette, Leone-style extreme close-ups,',
    promptSuffix: 'high noon heat haze, leather and gunmetal, lonely vistas',
    color: '#c89060',
  },
  sci_fi_70s: {
    label: '70s Sci-Fi',
    category: 'genre',
    promptPrefix:
      '1970s sci-fi paperback aesthetic, airbrushed planets, chrome and glass, Syd Mead influence,',
    promptSuffix: 'optimistic retro-future, soft synth-color gradients, monumental megastructures',
    color: '#ff8c5a',
  },

  // ── Animation ──────────────────────────────────────────────────
  anime: {
    label: 'Anime',
    category: 'animation',
    promptPrefix: 'Anime style, cel-shaded, vibrant colors, detailed line art,',
    promptSuffix: 'Japanese animation aesthetic, expressive eyes, dynamic composition',
    color: '#c44dff',
  },
  ghibli: {
    label: 'Studio Ghibli',
    category: 'animation',
    promptPrefix:
      'Studio Ghibli watercolor aesthetic, hand-painted backgrounds, gentle golden light, lush nature,',
    promptSuffix: 'Miyazaki warmth, cumulus clouds, soft pastoral wonder',
    color: '#aed9e0',
  },
  pixar: {
    label: 'Pixar 3D',
    category: 'animation',
    promptPrefix:
      'Pixar 3D animation, soft global illumination, expressive subsurface scattering, polished surfaces,',
    promptSuffix: 'warm cinematic lighting, big-eyed appeal, family-film charm',
    color: '#ffb84a',
  },
  comic_book: {
    label: 'Comic Book',
    category: 'animation',
    promptPrefix: 'Comic book style, bold outlines, halftone dots, saturated primary colors,',
    promptSuffix: 'pop art influence, dynamic action lines, graphic novel aesthetic',
    color: '#ff4444',
  },
  manga_bw: {
    label: 'Manga (B&W)',
    category: 'animation',
    promptPrefix:
      'Black and white manga, screentone shading, sharp ink lines, dramatic motion lines,',
    promptSuffix: 'Otomo / Inio Asano influence, dense detail, monochrome only',
    color: '#1a1a1a',
  },
  rotoscope: {
    label: 'Rotoscope',
    category: 'animation',
    promptPrefix:
      'Rotoscoped animation, painted-over live action, wavering line work, posterized fills,',
    promptSuffix: 'A Scanner Darkly / Linklater feel, hand-quivering edges',
    color: '#d4a373',
  },
  claymation: {
    label: 'Claymation',
    category: 'animation',
    promptPrefix:
      'Claymation stop-motion, visible fingerprints in plasticine, slight handmade lopsidedness,',
    promptSuffix: 'Aardman warmth, soft tungsten lighting, miniature-set scale cues',
    color: '#e8a87c',
  },

  // ── Art / Illustration ─────────────────────────────────────────
  watercolor: {
    label: 'Watercolor',
    category: 'art',
    promptPrefix: 'Watercolor painting style, soft edges, flowing colors, artistic brush strokes,',
    promptSuffix: 'delicate washes, transparent layers, paper texture visible',
    color: '#a8d8ea',
  },
  oil_painting: {
    label: 'Oil Painting',
    category: 'art',
    promptPrefix:
      'Oil painting on canvas, thick impasto strokes, rich pigment, Old Master lighting,',
    promptSuffix: 'Rembrandt chiaroscuro, varnished glow, visible weave of canvas',
    color: '#8b5a2b',
  },
  charcoal: {
    label: 'Charcoal Sketch',
    category: 'art',
    promptPrefix:
      'Charcoal drawing, smudged graphite shadows, expressive hatching, paper grain showing through,',
    promptSuffix: 'monochrome, gestural, unfinished edges',
    color: '#3a3a3a',
  },
  ink_wash: {
    label: 'Ink Wash',
    category: 'art',
    promptPrefix:
      'Sumi-e ink wash painting, sparse confident brushwork, vast white negative space,',
    promptSuffix: 'East Asian minimalism, single calligraphic gesture',
    color: '#262626',
  },
  pixel_art: {
    label: 'Pixel Art',
    category: 'art',
    promptPrefix: '16-bit pixel art, limited palette, crisp dithering, clean pixel edges,',
    promptSuffix: 'SNES-era game look, tile-based composition',
    color: '#ff6ec7',
  },
  low_poly: {
    label: 'Low Poly',
    category: 'art',
    promptPrefix:
      'Low-poly 3D illustration, faceted flat-shaded geometry, pastel gradient lighting,',
    promptSuffix: 'PS1-era charm but modernized, minimal palette',
    color: '#7fc8f8',
  },
  isometric: {
    label: 'Isometric',
    category: 'art',
    promptPrefix:
      'Isometric illustration, 30-degree axonometric projection, clean vector shapes, tidy diorama composition,',
    promptSuffix: 'soft long shadows, infographic clarity, no perspective foreshortening',
    color: '#5eb3b3',
  },
  vector_flat: {
    label: 'Vector Flat',
    category: 'art',
    promptPrefix:
      'Flat vector illustration, bold geometric shapes, no gradients, limited high-contrast palette,',
    promptSuffix: 'editorial-poster clarity, minimalist iconography',
    color: '#ef476f',
  },
  surreal: {
    label: 'Surrealist',
    category: 'art',
    promptPrefix: 'Surrealist style, dreamlike, impossible geometry, melting forms,',
    promptSuffix: 'Salvador Dali inspired, subconscious imagery, bizarre juxtapositions',
    color: '#9b59b6',
  },

  // ── Photography ────────────────────────────────────────────────
  polaroid_70s: {
    label: '70s Polaroid',
    category: 'photo',
    promptPrefix:
      '1970s Polaroid photograph, washed pastel colors, slight light leak, soft focus edges,',
    promptSuffix: 'square frame feel, nostalgic warmth, faded chemical tones',
    color: '#e2b48b',
  },
  lomo: {
    label: 'Lomography',
    category: 'photo',
    promptPrefix:
      'Lomography aesthetic, oversaturated colors, heavy vignette, cross-processed greens and blues,',
    promptSuffix: 'plastic-lens softness, fisheye distortion hint',
    color: '#3d8b40',
  },
  infrared: {
    label: 'Infrared',
    category: 'photo',
    promptPrefix: 'Color infrared photography, white foliage, magenta skies, alien landscape feel,',
    promptSuffix: 'Aerochrome look, dreamlike spectral inversion',
    color: '#ff4dd2',
  },
  tilt_shift: {
    label: 'Tilt-Shift',
    category: 'photo',
    promptPrefix:
      'Tilt-shift photography, miniature-effect selective focus, narrow plane of sharpness,',
    promptSuffix: 'toy-diorama scale illusion, saturated colors',
    color: '#6fc3df',
  },
  golden_hour: {
    label: 'Golden Hour',
    category: 'photo',
    promptPrefix:
      'Golden-hour photography, low warm directional sun, long soft shadows, glowing rim light,',
    promptSuffix: 'honey-amber tonality, magic-hour mood',
    color: '#f5a31a',
  },
  blue_hour: {
    label: 'Blue Hour',
    category: 'photo',
    promptPrefix: 'Blue-hour photography, deep cyan twilight sky, warm artificial light pockets,',
    promptSuffix: 'glowing windows, calm post-sunset mood',
    color: '#2a4d8f',
  },
  overcast: {
    label: 'Overcast',
    category: 'photo',
    promptPrefix:
      'Overcast diffuse natural light, soft wraparound shadows, muted desaturated palette,',
    promptSuffix: 'Nordic gloom, even gray sky as giant softbox',
    color: '#9aa3a8',
  },

  // ── Era / Process ──────────────────────────────────────────────
  vhs_80s: {
    label: "'80s VHS",
    category: 'era',
    promptPrefix:
      '1980s VHS aesthetic, retro scan lines, warm color grading, slight tracking artifacts,',
    promptSuffix: 'vintage television look, neon glow, synth-wave atmosphere',
    color: '#ff6b9d',
  },
  super_8: {
    label: 'Super 8',
    category: 'era',
    promptPrefix: 'Super 8 home movie, heavy film grain, warm faded colors, slight frame jitter,',
    promptSuffix: '8mm gate edges, nostalgic 1970s family-camera feel',
    color: '#d97a4a',
  },
  daguerreotype: {
    label: 'Daguerreotype',
    category: 'era',
    promptPrefix:
      'Daguerreotype, silvery monochrome, mirror-like reflective plate, long-exposure stillness,',
    promptSuffix: '1850s photographic look, edge tarnish, ghostly motion blur',
    color: '#a8a59f',
  },
  early_color: {
    label: 'Autochrome',
    category: 'era',
    promptPrefix:
      'Early autochrome color photograph, pointillist starch-grain texture, muted period palette,',
    promptSuffix: '1910s color process, soft painterly quality',
    color: '#c69b7b',
  },
  techni_50s: {
    label: 'Technicolor 50s',
    category: 'era',
    promptPrefix:
      '1950s three-strip Technicolor, hyper-saturated primaries, sound-stage lighting, slight halation,',
    promptSuffix: 'classic-Hollywood musical look, painted backdrops',
    color: '#e63946',
  },

  // ── Material / Aesthetic ───────────────────────────────────────
  steampunk: {
    label: 'Steampunk',
    category: 'material',
    promptPrefix: 'Steampunk aesthetic, brass and copper tones, Victorian-era machinery,',
    promptSuffix: 'gears and steam, ornate mechanical details, sepia-tinted',
    color: '#b87333',
  },
  art_deco: {
    label: 'Art Deco',
    category: 'material',
    promptPrefix:
      'Art deco design, symmetrical geometric ornament, gold-on-black, sunburst motifs,',
    promptSuffix: '1920s Manhattan elegance, polished marble, chrome accents',
    color: '#d4af37',
  },
  brutalist: {
    label: 'Brutalist',
    category: 'material',
    promptPrefix:
      'Brutalist architecture, raw exposed concrete, monumental geometric forms, harsh overcast light,',
    promptSuffix: 'monolithic scale, cold gray palette, oppressive presence',
    color: '#6b6b6b',
  },
  vaporwave: {
    label: 'Vaporwave',
    category: 'material',
    promptPrefix:
      'Vaporwave aesthetic, pastel pink and cyan, Roman-bust statuary, retro Windows 95 UI motifs,',
    promptSuffix: 'CRT glow, 80s-mall nostalgia, dreamy hypnagogic feel',
    color: '#ff71ce',
  },

  // ── Documentary ────────────────────────────────────────────────
  documentary: {
    label: 'Documentary',
    category: 'doc',
    promptPrefix: 'Documentary style, naturalistic lighting, handheld camera feel,',
    promptSuffix: 'authentic, raw footage look, observational, unfiltered',
    color: '#8b7355',
  },
  reportage: {
    label: 'Reportage',
    category: 'doc',
    promptPrefix:
      'Photojournalism, Magnum-style street reportage, 35mm grain, candid decisive-moment framing,',
    promptSuffix: 'black-and-white, available light only, unposed humanity',
    color: '#3f3f3f',
  },
} as const;

export type StylePresetId = keyof typeof STYLE_PRESETS;

export type StylePresetCategory =
  | 'cinematic'
  | 'genre'
  | 'animation'
  | 'art'
  | 'photo'
  | 'era'
  | 'material'
  | 'doc';

export interface StylePresetConfig {
  label: string;
  category: StylePresetCategory;
  promptPrefix: string;
  promptSuffix: string;
  color: string;
}

export const STYLE_CATEGORY_LABELS: Record<StylePresetCategory, string> = {
  cinematic: 'Cinematic',
  genre: 'Genre',
  animation: 'Animation',
  art: 'Art & Illustration',
  photo: 'Photography',
  era: 'Era & Process',
  material: 'Material & Aesthetic',
  doc: 'Documentary',
};

// ── Shot-Grammar Presets (framing / angle / lens / focus) ────────────
// Independent of camera motion (CAMERA_PRESETS). A scene typically picks
// one framing + one angle + optionally a lens / focus, plus a motion preset.

export const SHOT_PRESETS = {
  // Framing — how much of the subject is in frame
  ecu: {
    label: 'Extreme Close-Up',
    category: 'framing',
    promptPrefix: 'Extreme close-up shot, only the eyes or a small detail filling the frame,',
    promptSuffix: 'shallow focus on micro-detail, intimate, intense',
  },
  cu: {
    label: 'Close-Up',
    category: 'framing',
    promptPrefix: "Close-up shot, framed on the subject's face, head fills the frame,",
    promptSuffix: 'emotional intimacy, clear facial detail',
  },
  mcu: {
    label: 'Medium Close-Up',
    category: 'framing',
    promptPrefix: 'Medium close-up shot, framed from the chest up,',
    promptSuffix: 'dialogue framing, includes shoulders and expression',
  },
  ms: {
    label: 'Medium Shot',
    category: 'framing',
    promptPrefix: 'Medium shot, framed from the waist up,',
    promptSuffix: 'shows gesture and upper body, classic conversational framing',
  },
  mls: {
    label: 'Medium Long Shot',
    category: 'framing',
    promptPrefix: 'Medium long shot, framed from the knees up,',
    promptSuffix: 'cowboy framing, full-body context but still personal',
  },
  ls: {
    label: 'Long / Full Shot',
    category: 'framing',
    promptPrefix: 'Full shot, entire body from head to feet visible,',
    promptSuffix: 'subject in their environment, room around them in frame',
  },
  ws: {
    label: 'Wide Shot',
    category: 'framing',
    promptPrefix: 'Wide shot, subject small in frame, lots of environment,',
    promptSuffix: 'establishing context, location reads clearly',
  },
  ews: {
    label: 'Extreme Wide',
    category: 'framing',
    promptPrefix: 'Extreme wide shot, subject tiny in vast landscape,',
    promptSuffix: 'epic scale, scenery dominates, lonely or grand mood',
  },

  // Angle / perspective
  eye_level: {
    label: 'Eye Level',
    category: 'angle',
    promptPrefix: "Camera at subject's eye level,",
    promptSuffix: 'neutral, equal-footing perspective',
  },
  low_angle: {
    label: 'Low Angle',
    category: 'angle',
    promptPrefix: 'Low-angle shot, camera looking up at the subject,',
    promptSuffix: 'subject appears powerful, heroic, imposing',
  },
  high_angle: {
    label: 'High Angle',
    category: 'angle',
    promptPrefix: 'High-angle shot, camera looking down on the subject,',
    promptSuffix: 'subject appears small, vulnerable, diminished',
  },
  worms_eye: {
    label: "Worm's Eye",
    category: 'angle',
    promptPrefix: 'Extreme worm-eye view from ground level looking straight up,',
    promptSuffix: 'monumental scale, vertiginous perspective',
  },
  birds_eye: {
    label: "Bird's Eye",
    category: 'angle',
    promptPrefix: 'Top-down bird-eye view looking straight down,',
    promptSuffix: 'geometric pattern visible, omniscient detached perspective',
  },
  dutch_tilt: {
    label: 'Dutch Tilt',
    category: 'angle',
    promptPrefix: 'Dutch-angle shot, camera canted ~20 degrees off horizontal,',
    promptSuffix: 'unease, disorientation, psychological tension',
  },
  ots: {
    label: 'Over-the-Shoulder',
    category: 'angle',
    promptPrefix:
      "Over-the-shoulder shot, foreground figure's shoulder and back of head blurred, main subject in mid-ground,",
    promptSuffix: 'classic dialogue framing, depth via foreground occlusion',
  },
  pov: {
    label: 'POV',
    category: 'angle',
    promptPrefix: "First-person POV shot, camera is the subject's eyes,",
    promptSuffix: 'immersive, hands or weapon may be visible in lower frame',
  },
  two_shot: {
    label: 'Two-Shot',
    category: 'angle',
    promptPrefix: 'Two-shot framing, two subjects sharing the frame at equal weight,',
    promptSuffix: 'relational composition, conversational balance',
  },

  // Lens choice
  ultra_wide: {
    label: 'Ultra Wide (14mm)',
    category: 'lens',
    promptPrefix: 'Shot on ultra-wide 14mm lens, strong barrel distortion at edges,',
    promptSuffix: 'expansive field of view, exaggerated foreground',
  },
  wide_lens: {
    label: 'Wide (24mm)',
    category: 'lens',
    promptPrefix: 'Shot on 24mm wide lens, broad field of view, mild edge distortion,',
    promptSuffix: 'environmental context emphasized',
  },
  normal_lens: {
    label: 'Normal (35mm)',
    category: 'lens',
    promptPrefix: 'Shot on 35mm lens, natural perspective close to human vision,',
    promptSuffix: 'documentary-feeling neutral framing',
  },
  standard_lens: {
    label: 'Standard (50mm)',
    category: 'lens',
    promptPrefix: 'Shot on 50mm lens, neutral perspective, no distortion,',
    promptSuffix: 'classic photographic look, natural compression',
  },
  portrait_lens: {
    label: 'Portrait (85mm)',
    category: 'lens',
    promptPrefix: 'Shot on 85mm portrait lens, flattering facial compression, creamy bokeh,',
    promptSuffix: 'background falls away into smooth blur',
  },
  telephoto: {
    label: 'Telephoto (135mm)',
    category: 'lens',
    promptPrefix: 'Shot on 135mm telephoto lens, strong background compression,',
    promptSuffix: 'distant subject feels close, layers stacked flat',
  },
  macro: {
    label: 'Macro',
    category: 'lens',
    promptPrefix: 'Macro lens shot, extreme magnification, razor-thin focus plane,',
    promptSuffix: 'tactile micro-detail, abstract texture',
  },

  // Focus / depth of field
  deep_focus: {
    label: 'Deep Focus',
    category: 'focus',
    promptPrefix: 'Deep focus, everything from foreground to background sharply in focus,',
    promptSuffix: 'Citizen Kane look, narrow aperture, all planes readable',
  },
  shallow_focus: {
    label: 'Shallow Focus',
    category: 'focus',
    promptPrefix: 'Shallow depth of field, subject sharp, background melting into bokeh,',
    promptSuffix: 'creamy out-of-focus highlights, isolated subject',
  },
  rack_focus: {
    label: 'Rack Focus',
    category: 'focus',
    promptPrefix:
      'Rack-focus composition, foreground subject sharp and background subject visible but soft,',
    promptSuffix: 'mid-shot focus transition feel',
  },
  split_diopter: {
    label: 'Split Diopter',
    category: 'focus',
    promptPrefix:
      'Split-diopter shot, near subject on one side and far subject on the other both in focus,',
    promptSuffix: 'De Palma-style dual sharpness with soft band in middle',
  },
} as const;

export type ShotPresetId = keyof typeof SHOT_PRESETS;

export type ShotPresetCategory = 'framing' | 'angle' | 'lens' | 'focus';

export interface ShotPresetConfig {
  label: string;
  category: ShotPresetCategory;
  promptPrefix: string;
  promptSuffix: string;
}

export const SHOT_CATEGORY_LABELS: Record<ShotPresetCategory, string> = {
  framing: 'Framing',
  angle: 'Angle',
  lens: 'Lens',
  focus: 'Focus',
};

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

  // Shot grammar — framing / angle / lens / focus
  shotPreset: ShotPresetId | null;
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
  shotPreset: null,
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
