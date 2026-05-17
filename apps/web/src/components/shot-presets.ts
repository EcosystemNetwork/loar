/**
 * Shot-grammar presets — web mirror of apps/server/src/services/scene-controls/types.ts SHOT_PRESETS.
 * Source of truth lives on the server; mirror the IDs and labels here so the picker
 * doesn't need a tRPC round-trip to render.
 */

export type ShotPresetCategory = 'framing' | 'angle' | 'lens' | 'focus';

export type ShotPresetId =
  | 'ecu'
  | 'cu'
  | 'mcu'
  | 'ms'
  | 'mls'
  | 'ls'
  | 'ws'
  | 'ews'
  | 'eye_level'
  | 'low_angle'
  | 'high_angle'
  | 'worms_eye'
  | 'birds_eye'
  | 'dutch_tilt'
  | 'ots'
  | 'pov'
  | 'two_shot'
  | 'ultra_wide'
  | 'wide_lens'
  | 'normal_lens'
  | 'standard_lens'
  | 'portrait_lens'
  | 'telephoto'
  | 'macro'
  | 'deep_focus'
  | 'shallow_focus'
  | 'rack_focus'
  | 'split_diopter';

export interface ShotPresetDisplay {
  id: ShotPresetId;
  label: string;
  category: ShotPresetCategory;
  /** One-line cinematographer's note for the tooltip. */
  hint: string;
}

export const SHOT_PRESETS: ShotPresetDisplay[] = [
  // Framing
  {
    id: 'ecu',
    label: 'Extreme Close-Up',
    category: 'framing',
    hint: 'Eyes or detail fill the frame',
  },
  { id: 'cu', label: 'Close-Up', category: 'framing', hint: 'Head fills the frame' },
  { id: 'mcu', label: 'Medium Close-Up', category: 'framing', hint: 'Chest up — classic dialogue' },
  { id: 'ms', label: 'Medium Shot', category: 'framing', hint: 'Waist up' },
  { id: 'mls', label: 'Medium Long', category: 'framing', hint: 'Knees up — cowboy framing' },
  { id: 'ls', label: 'Full Shot', category: 'framing', hint: 'Whole body in environment' },
  { id: 'ws', label: 'Wide Shot', category: 'framing', hint: 'Subject small, location reads' },
  { id: 'ews', label: 'Extreme Wide', category: 'framing', hint: 'Subject tiny in vast scene' },

  // Angle
  { id: 'eye_level', label: 'Eye Level', category: 'angle', hint: 'Neutral, equal footing' },
  { id: 'low_angle', label: 'Low Angle', category: 'angle', hint: 'Looking up — heroic' },
  { id: 'high_angle', label: 'High Angle', category: 'angle', hint: 'Looking down — diminished' },
  { id: 'worms_eye', label: "Worm's Eye", category: 'angle', hint: 'Straight up from ground' },
  { id: 'birds_eye', label: "Bird's Eye", category: 'angle', hint: 'Straight down — top-down' },
  { id: 'dutch_tilt', label: 'Dutch Tilt', category: 'angle', hint: 'Canted ~20° — unease' },
  { id: 'ots', label: 'Over-the-Shoulder', category: 'angle', hint: 'Classic dialogue framing' },
  { id: 'pov', label: 'POV', category: 'angle', hint: "First-person — subject's eyes" },
  { id: 'two_shot', label: 'Two-Shot', category: 'angle', hint: 'Two subjects, equal weight' },

  // Lens
  {
    id: 'ultra_wide',
    label: 'Ultra Wide 14mm',
    category: 'lens',
    hint: 'Strong barrel distortion',
  },
  { id: 'wide_lens', label: 'Wide 24mm', category: 'lens', hint: 'Broad FOV, environmental' },
  { id: 'normal_lens', label: 'Normal 35mm', category: 'lens', hint: 'Documentary-natural' },
  { id: 'standard_lens', label: 'Standard 50mm', category: 'lens', hint: 'Classic, no distortion' },
  { id: 'portrait_lens', label: 'Portrait 85mm', category: 'lens', hint: 'Creamy bokeh' },
  { id: 'telephoto', label: 'Telephoto 135mm', category: 'lens', hint: 'Background compression' },
  { id: 'macro', label: 'Macro', category: 'lens', hint: 'Extreme magnification' },

  // Focus
  { id: 'deep_focus', label: 'Deep Focus', category: 'focus', hint: 'Everything sharp' },
  {
    id: 'shallow_focus',
    label: 'Shallow Focus',
    category: 'focus',
    hint: 'Subject isolated in bokeh',
  },
  { id: 'rack_focus', label: 'Rack Focus', category: 'focus', hint: 'Foreground sharp, far soft' },
  {
    id: 'split_diopter',
    label: 'Split Diopter',
    category: 'focus',
    hint: 'Near & far both in focus',
  },
];

export const SHOT_CATEGORY_LABELS: Record<ShotPresetCategory, string> = {
  framing: 'Framing',
  angle: 'Angle',
  lens: 'Lens',
  focus: 'Focus',
};
