/**
 * Visual style presets — web mirror of apps/server/src/services/scene-controls/types.ts STYLE_PRESETS.
 * Source of truth lives on the server; this list must stay in sync (IDs only — labels/colors
 * are duplicated here so the picker doesn't need a tRPC round-trip on mount).
 */

export type StylePresetCategory =
  | 'cinematic'
  | 'genre'
  | 'animation'
  | 'art'
  | 'photo'
  | 'era'
  | 'material'
  | 'doc';

export interface StylePresetDisplay {
  id: StylePresetId;
  label: string;
  category: StylePresetCategory;
  color: string;
}

export const STYLE_PRESETS: StylePresetDisplay[] = [
  // Cinematic
  { id: 'cinematic', label: 'Cinematic', category: 'cinematic', color: '#2c3e50' },
  { id: 'noir', label: 'Film Noir', category: 'cinematic', color: '#1a1a2e' },
  { id: 'neo_noir', label: 'Neo-Noir', category: 'cinematic', color: '#0d3b66' },
  { id: 'wes_anderson', label: 'Wes Anderson', category: 'cinematic', color: '#f4c2a1' },
  { id: 'kubrick', label: 'Kubrick', category: 'cinematic', color: '#1d1f2b' },
  { id: 'deakins', label: 'Deakins', category: 'cinematic', color: '#3a4a5b' },
  { id: 'fincher', label: 'Fincher', category: 'cinematic', color: '#4a5d3c' },
  { id: 'silent_film', label: 'Silent Film', category: 'cinematic', color: '#2a2a2a' },
  { id: 'giallo', label: 'Giallo', category: 'cinematic', color: '#a8001f' },

  // Genre
  { id: 'cyberpunk', label: 'Cyberpunk', category: 'genre', color: '#00fff5' },
  { id: 'solarpunk', label: 'Solarpunk', category: 'genre', color: '#7cc576' },
  { id: 'dieselpunk', label: 'Dieselpunk', category: 'genre', color: '#7a5c3b' },
  { id: 'fantasy', label: 'High Fantasy', category: 'genre', color: '#ffd700' },
  { id: 'dark_fantasy', label: 'Dark Fantasy', category: 'genre', color: '#3d2018' },
  { id: 'horror', label: 'Horror', category: 'genre', color: '#2d0a0a' },
  { id: 'cosmic_horror', label: 'Cosmic Horror', category: 'genre', color: '#0a1b1f' },
  { id: 'western', label: 'Spaghetti Western', category: 'genre', color: '#c89060' },
  { id: 'sci_fi_70s', label: '70s Sci-Fi', category: 'genre', color: '#ff8c5a' },

  // Animation
  { id: 'anime', label: 'Anime', category: 'animation', color: '#c44dff' },
  { id: 'ghibli', label: 'Studio Ghibli', category: 'animation', color: '#aed9e0' },
  { id: 'pixar', label: 'Pixar 3D', category: 'animation', color: '#ffb84a' },
  { id: 'comic_book', label: 'Comic Book', category: 'animation', color: '#ff4444' },
  { id: 'manga_bw', label: 'Manga (B&W)', category: 'animation', color: '#1a1a1a' },
  { id: 'rotoscope', label: 'Rotoscope', category: 'animation', color: '#d4a373' },
  { id: 'claymation', label: 'Claymation', category: 'animation', color: '#e8a87c' },

  // Art
  { id: 'watercolor', label: 'Watercolor', category: 'art', color: '#a8d8ea' },
  { id: 'oil_painting', label: 'Oil Painting', category: 'art', color: '#8b5a2b' },
  { id: 'charcoal', label: 'Charcoal Sketch', category: 'art', color: '#3a3a3a' },
  { id: 'ink_wash', label: 'Ink Wash', category: 'art', color: '#262626' },
  { id: 'pixel_art', label: 'Pixel Art', category: 'art', color: '#ff6ec7' },
  { id: 'low_poly', label: 'Low Poly', category: 'art', color: '#7fc8f8' },
  { id: 'isometric', label: 'Isometric', category: 'art', color: '#5eb3b3' },
  { id: 'vector_flat', label: 'Vector Flat', category: 'art', color: '#ef476f' },
  { id: 'surreal', label: 'Surrealist', category: 'art', color: '#9b59b6' },

  // Photo
  { id: 'polaroid_70s', label: '70s Polaroid', category: 'photo', color: '#e2b48b' },
  { id: 'lomo', label: 'Lomography', category: 'photo', color: '#3d8b40' },
  { id: 'infrared', label: 'Infrared', category: 'photo', color: '#ff4dd2' },
  { id: 'tilt_shift', label: 'Tilt-Shift', category: 'photo', color: '#6fc3df' },
  { id: 'golden_hour', label: 'Golden Hour', category: 'photo', color: '#f5a31a' },
  { id: 'blue_hour', label: 'Blue Hour', category: 'photo', color: '#2a4d8f' },
  { id: 'overcast', label: 'Overcast', category: 'photo', color: '#9aa3a8' },

  // Era / process
  { id: 'vhs_80s', label: "'80s VHS", category: 'era', color: '#ff6b9d' },
  { id: 'super_8', label: 'Super 8', category: 'era', color: '#d97a4a' },
  { id: 'daguerreotype', label: 'Daguerreotype', category: 'era', color: '#a8a59f' },
  { id: 'early_color', label: 'Autochrome', category: 'era', color: '#c69b7b' },
  { id: 'techni_50s', label: 'Technicolor 50s', category: 'era', color: '#e63946' },

  // Material / aesthetic
  { id: 'steampunk', label: 'Steampunk', category: 'material', color: '#b87333' },
  { id: 'art_deco', label: 'Art Deco', category: 'material', color: '#d4af37' },
  { id: 'brutalist', label: 'Brutalist', category: 'material', color: '#6b6b6b' },
  { id: 'vaporwave', label: 'Vaporwave', category: 'material', color: '#ff71ce' },

  // Documentary
  { id: 'documentary', label: 'Documentary', category: 'doc', color: '#8b7355' },
  { id: 'reportage', label: 'Reportage', category: 'doc', color: '#3f3f3f' },
];

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

export type StylePresetId =
  | 'cinematic'
  | 'noir'
  | 'neo_noir'
  | 'wes_anderson'
  | 'kubrick'
  | 'deakins'
  | 'fincher'
  | 'silent_film'
  | 'giallo'
  | 'cyberpunk'
  | 'solarpunk'
  | 'dieselpunk'
  | 'fantasy'
  | 'dark_fantasy'
  | 'horror'
  | 'cosmic_horror'
  | 'western'
  | 'sci_fi_70s'
  | 'anime'
  | 'ghibli'
  | 'pixar'
  | 'comic_book'
  | 'manga_bw'
  | 'rotoscope'
  | 'claymation'
  | 'watercolor'
  | 'oil_painting'
  | 'charcoal'
  | 'ink_wash'
  | 'pixel_art'
  | 'low_poly'
  | 'isometric'
  | 'vector_flat'
  | 'surreal'
  | 'polaroid_70s'
  | 'lomo'
  | 'infrared'
  | 'tilt_shift'
  | 'golden_hour'
  | 'blue_hour'
  | 'overcast'
  | 'vhs_80s'
  | 'super_8'
  | 'daguerreotype'
  | 'early_color'
  | 'techni_50s'
  | 'steampunk'
  | 'art_deco'
  | 'brutalist'
  | 'vaporwave'
  | 'documentary'
  | 'reportage';
