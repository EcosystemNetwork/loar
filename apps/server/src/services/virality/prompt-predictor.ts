/**
 * Pre-Generation Virality Predictor — heuristic score over a prompt string.
 *
 * Higgsfield ships a prompt-only "virality predictor" as a black box.
 * Ours is transparent and explainable: six measurable signals, each
 * scored deterministically, blended into a 0–100 estimate with concrete
 * suggestions when a signal scores low.
 *
 * The heuristics are deliberately conservative — they encode patterns that
 * correlate with the post-publish scores we measure in `services/virality/
 * scoring.ts`. As we accumulate ≥a few hundred (prompt → published score)
 * pairs, we can swap these rules for a tiny trained classifier and keep
 * the same `predictPromptVirality()` signature.
 */

export interface PromptViralityPrediction {
  /** 0–100 composite estimate. */
  predictedIndex: number;
  /** Per-signal breakdown — useful for UI tooltips + targeted advice. */
  signals: {
    hookStrength: number;
    specificity: number;
    cinematicCues: number;
    characterAnchor: number;
    conflictStakes: number;
    lengthFit: number;
  };
  /** Plain-English verdict. */
  verdict: string;
  /** Up to 3 concrete improvements when score < 75. Empty above that. */
  suggestions: string[];
}

const HOOK_OPENERS = [
  'when',
  'imagine',
  'watch',
  'suddenly',
  'in the moment',
  'right before',
  'a split second',
  'just as',
  'the second',
  'as soon as',
];
const HOOK_NOUN_VERBS = [
  'reveal',
  'twist',
  'confronts',
  'discovers',
  'unveils',
  'snaps',
  'shatters',
  'crashes',
  'erupts',
  'transforms',
  'awakens',
  'emerges',
  'plunges',
  'ignites',
  'collapses',
];

const CINEMATIC_TOKENS = [
  // camera moves
  'dolly',
  'crane',
  'orbit',
  'pan',
  'tilt',
  'zoom',
  'whip pan',
  'crash zoom',
  'handheld',
  'tracking shot',
  'push in',
  'pull back',
  // lighting
  'golden hour',
  'neon',
  'backlit',
  'silhouette',
  'rim light',
  'volumetric',
  'rain-slicked',
  'overcast',
  // framing
  'close-up',
  'wide shot',
  'over-the-shoulder',
  'low angle',
  'high angle',
  'dutch tilt',
  // style anchors
  'cinematic',
  'anamorphic',
  'film grain',
  'shallow depth',
  '35mm',
  '70mm',
  'imax',
];

const CONFLICT_TOKENS = [
  'fight',
  'chase',
  'escape',
  'hunt',
  'betrayal',
  'reveal',
  'twist',
  'rival',
  'duel',
  'confrontation',
  'standoff',
  'showdown',
  'breakthrough',
  'rescue',
  'survival',
  'race',
  'pursuit',
  'tension',
  'gambit',
];

const FILLER_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'it',
  'its',
  'this',
  'that',
  'there',
  'very',
  'really',
  'some',
  'any',
  'just',
  'so',
  'then',
]);

const GENERIC_SUBJECTS = new Set([
  'person',
  'people',
  'someone',
  'somebody',
  'man',
  'woman',
  'guy',
  'character',
  'figure',
  'subject',
]);

function countMatches(haystack: string, needles: string[]): number {
  let hits = 0;
  for (const n of needles) {
    if (haystack.includes(n)) hits++;
  }
  return hits;
}

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function predictPromptVirality(rawPrompt: string): PromptViralityPrediction {
  const prompt = (rawPrompt ?? '').trim();
  const lower = prompt.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Empty / too short → bottom of the scale, hard fail with directed advice.
  if (wordCount < 4) {
    return {
      predictedIndex: 5,
      signals: {
        hookStrength: 0,
        specificity: 0,
        cinematicCues: 0,
        characterAnchor: 0,
        conflictStakes: 0,
        lengthFit: 0,
      },
      verdict: 'Way too short to score',
      suggestions: [
        'Describe the scene in at least 10–20 words',
        'Name a subject',
        'Add a single action',
      ],
    };
  }

  // ── Hook strength ────────────────────────────────────────────────
  // First 6 words carry most of the weight. Look for action openers
  // and the "high-stakes" verb cluster anywhere in the prompt.
  const opener = words.slice(0, 6).join(' ');
  const openerHits = countMatches(opener, HOOK_OPENERS);
  const verbHits = countMatches(lower, HOOK_NOUN_VERBS);
  const hookStrength = clamp(openerHits * 35 + verbHits * 18 + (wordCount >= 12 ? 10 : 0));

  // ── Specificity — concrete nouns vs filler words. ────────────────
  const nonFiller = words.filter((w) => !FILLER_WORDS.has(w)).length;
  const specificityRatio = nonFiller / Math.max(1, wordCount);
  const specificity = clamp(specificityRatio * 110); // 0.7 ratio ≈ 77

  // ── Cinematic cues ───────────────────────────────────────────────
  const cinematicHits = countMatches(lower, CINEMATIC_TOKENS);
  const cinematicCues = clamp(cinematicHits * 22 + (cinematicHits >= 2 ? 15 : 0));

  // ── Character anchor — named/specific subject vs generic. ────────
  const hasGeneric = words.some((w) => GENERIC_SUBJECTS.has(w));
  const hasProperNoun = /\b[A-Z][a-z]{2,}\b/.test(prompt.slice(1)); // exclude sentence start
  const characterAnchor = clamp(
    (hasProperNoun ? 60 : 0) + (!hasGeneric ? 25 : 0) + (wordCount >= 15 ? 15 : 0)
  );

  // ── Conflict / stakes ────────────────────────────────────────────
  const conflictHits = countMatches(lower, CONFLICT_TOKENS);
  const conflictStakes = clamp(conflictHits * 30 + (conflictHits >= 1 ? 15 : 0));

  // ── Length fit — sweet spot ~20–60 words. ────────────────────────
  let lengthFit: number;
  if (wordCount < 8)
    lengthFit = wordCount * 6; // too short
  else if (wordCount <= 60) lengthFit = 95;
  else if (wordCount <= 100) lengthFit = 70;
  else lengthFit = 40; // wall of text — model loses focus

  // Composite — weights mirror the post-publish predictor where it makes
  // sense (hook drives early retention), but specificity + cinematic cues
  // get more weight here because they're the prompt-stage levers a user
  // can actually pull.
  const predictedIndex = clamp(
    hookStrength * 0.22 +
      specificity * 0.18 +
      cinematicCues * 0.22 +
      characterAnchor * 0.14 +
      conflictStakes * 0.14 +
      lengthFit * 0.1
  );

  // ── Verdict + targeted suggestions ───────────────────────────────
  const suggestions: string[] = [];
  if (predictedIndex < 75) {
    if (hookStrength < 40)
      suggestions.push('Open with a strong action — "as", "when", "suddenly" + a high-stakes verb');
    if (cinematicCues < 30)
      suggestions.push(
        'Add a camera move or lighting cue ("slow dolly in", "golden hour", "neon")'
      );
    if (characterAnchor < 35)
      suggestions.push('Name the subject specifically instead of "a person" or "someone"');
    if (conflictStakes < 25 && suggestions.length < 3)
      suggestions.push("Hint at stakes — what's at risk, who's opposing whom");
    if (specificity < 50 && suggestions.length < 3)
      suggestions.push('Replace filler with concrete nouns (locations, objects, textures)');
    if (lengthFit < 60 && suggestions.length < 3) {
      if (wordCount < 12)
        suggestions.push('Add 1–2 sentences of detail — current prompt is under-described');
      else suggestions.push('Trim — over 60 words and the model starts losing focus');
    }
  }

  let verdict: string;
  if (predictedIndex >= 80) verdict = 'High-potential prompt — generate it';
  else if (predictedIndex >= 60) verdict = 'Solid prompt — minor tweaks could push it higher';
  else if (predictedIndex >= 40)
    verdict = 'Mid-tier — apply the suggestions before spending credits';
  else if (predictedIndex >= 20)
    verdict = 'Weak signal — most viewers will bounce in the first second';
  else verdict = 'Almost nothing to grab the eye — rewrite';

  return {
    predictedIndex: Math.round(predictedIndex),
    signals: {
      hookStrength: Math.round(hookStrength),
      specificity: Math.round(specificity),
      cinematicCues: Math.round(cinematicCues),
      characterAnchor: Math.round(characterAnchor),
      conflictStakes: Math.round(conflictStakes),
      lengthFit: Math.round(lengthFit),
    },
    verdict,
    suggestions: suggestions.slice(0, 3),
  };
}
