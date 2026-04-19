/**
 * Controlled Generation — Types & Prompt Wrappers
 *
 * Shared types for PRD 7: Pose, Composition, Angle, and Scene Control.
 * Used by the image router, the shotTemplates router, and the scene-controls
 * service. Keeps the prompt-engineering logic in one place so the frontend,
 * router, and service agree on the wording sent to the model.
 */

// ── Control types ───────────────────────────────────────────────────

export const CONTROL_TYPES = [
  'subject',
  'style',
  'scribble',
  'pose',
  'depth',
  'canny',
  'shot_reference',
] as const;

export type ControlType = (typeof CONTROL_TYPES)[number];

export const CONTROL_TYPE_LABELS: Record<ControlType, string> = {
  subject: 'Subject / Character',
  style: 'Style Reference',
  scribble: 'Sketch / Scribble',
  pose: 'Pose Guide',
  depth: 'Depth Layout',
  canny: 'Edge / Line Art',
  shot_reference: 'Previous Shot',
};

// ── Shot angle presets (still-image camera angles) ──────────────────
// Kept separate from scene-controls CAMERA_PRESETS (which are motion
// presets for video). These are composition-only descriptors suitable
// for still image generation.

export const SHOT_ANGLE_PRESETS = {
  low_angle: {
    label: 'Low Angle',
    promptPrefix: 'Shot from a low angle looking up at the subject',
  },
  high_angle: {
    label: 'High Angle',
    promptPrefix: 'Shot from a high angle looking down at the subject',
  },
  close_up: {
    label: 'Close-Up',
    promptPrefix: 'Close-up framing, tight on the subject',
  },
  extreme_close_up: {
    label: 'Extreme Close-Up',
    promptPrefix: 'Extreme close-up, filling the frame with a single feature',
  },
  medium_shot: {
    label: 'Medium Shot',
    promptPrefix: 'Medium shot framing from the waist up',
  },
  wide_establishing: {
    label: 'Wide Establishing',
    promptPrefix: 'Wide establishing shot showing the full environment',
  },
  over_shoulder: {
    label: 'Over the Shoulder',
    promptPrefix: 'Over-the-shoulder framing with a figure in the near foreground',
  },
  dutch_tilt: {
    label: 'Dutch Tilt',
    promptPrefix: 'Dutch-tilted camera, canted horizon line',
  },
  birds_eye: {
    label: "Bird's Eye",
    promptPrefix: "Bird's-eye overhead view looking straight down",
  },
  worms_eye: {
    label: "Worm's Eye",
    promptPrefix: "Worm's-eye view from the ground looking up",
  },
  two_shot: {
    label: 'Two Shot',
    promptPrefix: 'Two-shot framing showing two subjects in dialogue',
  },
} as const;

export type ShotAnglePresetId = keyof typeof SHOT_ANGLE_PRESETS;

// ── Strength → phrase mapping ────────────────────────────────────────
// Gemini image models don't accept a numeric ControlNet weight, so we
// convert the 0–1 slider to a verbal modifier that the model actually
// responds to.

export function strengthToPhrase(strength: number): string {
  if (strength < 0.2) return 'loosely inspired by';
  if (strength < 0.45) return 'taking general cues from';
  if (strength < 0.65) return 'following closely';
  if (strength < 0.85) return 'matching tightly';
  return 'strictly replicating';
}

// ── Per-control prompt wrappers ─────────────────────────────────────

const CONTROL_WRAPPERS: Record<ControlType, (phrase: string) => string> = {
  subject: (p) => `Reference image for the main subject's identity — ${p} the character shown.`,
  style: (p) => `Reference image for visual style — ${p} the style of the reference.`,
  scribble: (p) => `Reference image is a rough compositional sketch — ${p} the sketch layout.`,
  pose: (p) => `Reference image shows the target pose — ${p} the pose of the figure.`,
  depth: (p) => `Reference image is a depth-layout guide — ${p} the depth arrangement.`,
  canny: (p) => `Reference image is an edge/line-art guide — ${p} the line structure.`,
  shot_reference: (p) =>
    `Reference image is a previous shot for continuity — ${p} the framing, camera, and lighting of the previous shot.`,
};

export interface ControlInput {
  controlType: ControlType;
  /** Resolved URL of the guide image (will be fetched & inlined) */
  guideImageUrl: string;
  /** 0.0–1.0 */
  strength: number;
}

/**
 * Build the natural-language system preamble that describes the set
 * of reference images the model will receive. Indexed 1-based to match
 * how a reader would read a list of references.
 */
export function buildControlPreamble(controls: ControlInput[]): string {
  if (controls.length === 0) return '';

  const lines = controls.map((c, i) => {
    const wrapper = CONTROL_WRAPPERS[c.controlType];
    const phrase = strengthToPhrase(c.strength);
    return `Reference ${i + 1}: ${wrapper(phrase)}`;
  });

  return lines.join('\n');
}

/**
 * Apply angle preset as a prompt prefix. Returns the original prompt
 * if the preset is null/unknown.
 */
export function applyAnglePreset(prompt: string, presetId: string | null | undefined): string {
  if (!presetId) return prompt;
  const preset = (SHOT_ANGLE_PRESETS as Record<string, { promptPrefix: string }>)[presetId];
  if (!preset) return prompt;
  return `${preset.promptPrefix}. ${prompt}`;
}
