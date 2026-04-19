/**
 * Prompt library for the VLM subsystem.
 *
 * Every prompt enforces strict JSON output, versioned via PROMPT_VERSION so
 * extraction caches can invalidate cleanly when we iterate on wording.
 */

export const PROMPT_VERSION = 'v1.0.0';

const EXTRACTION_SCHEMA_BLOCK = `{
  "summary": "1–2 sentence factual gist of what happens",
  "durationSec": 0,
  "scenes": [
    {
      "index": 0,
      "startSec": 0.0,
      "endSec": 0.0,
      "shotType": "wide | medium | close | insert | aerial | POV | tracking",
      "description": "What happens in this shot, factual only",
      "location": "Visible setting",
      "mood": "Tone of the shot",
      "subjects": ["character or object names as visible"],
      "actions": ["what subjects do"]
    }
  ],
  "entities": [
    {
      "kind": "person | place | thing | faction | event | lore | species | vehicle | technology | organization",
      "name": "Proper name if stated/implied; otherwise descriptive stable ID",
      "description": "2–4 sentence encyclopedic description grounded in visible evidence",
      "firstSeenAtSec": 0.0,
      "evidenceSceneIndexes": [0],
      "metadata": { "role": "...", "appearance": "..." }
    }
  ],
  "relationships": [
    {
      "sourceName": "Entity A",
      "targetName": "Entity B",
      "type": "allied_with | enemy_of | member_of | located_in | created_by | owns | related_to | appears_in | rules | uses",
      "evidenceSceneIndex": 0,
      "description": "Why this relationship is inferred"
    }
  ],
  "timelineEvents": [
    {
      "name": "Short event name",
      "description": "What happened",
      "atSec": 0.0,
      "confidence": 0.0
    }
  ],
  "chapterMarkers": [
    { "title": "Act title", "startSec": 0.0, "summary": "..." }
  ],
  "risks": [
    {
      "kind": "nsfw | violence | copyright_logo | copyright_character | watermark | ocr_credits | franchise_lookalike",
      "score": 0.0,
      "evidence": "What was observed",
      "sceneIndex": 0
    }
  ]
}`;

export function buildExtractionPrompt(input: {
  universeName?: string;
  priorEntities?: Array<{ name: string; kind: string; description: string }>;
  userNotes?: string;
}): string {
  const prior = input.priorEntities?.length
    ? `\n\nEXISTING CANON ENTITIES (prefer reusing these names when you recognize them):\n${input.priorEntities
        .slice(0, 40)
        .map((e) => `- ${e.name} (${e.kind}): ${e.description.slice(0, 160)}`)
        .join('\n')}`
    : '';
  const universe = input.universeName ? `\nUNIVERSE: ${input.universeName}` : '';
  const notes = input.userNotes ? `\nCREATOR NOTES: ${input.userNotes}` : '';

  return `You are a structured video/image analyst for a worldbuilding platform.
Your job is to watch the asset and produce strict JSON — no prose, no markdown.
${universe}${notes}${prior}

RULES:
- Describe ONLY what is visible or audible. Never invent names, dialogue, or events.
- Timestamps must reflect what you actually observe.
- If the asset is a still image, treat it as one scene with startSec=0, endSec=0.
- When an entity resembles one in EXISTING CANON, reuse that exact name.
- Risk scores must be calibrated: 0 = absent, 1 = clearly present.
- Output MUST be valid JSON matching the schema below, with no extra keys.

SCHEMA:
${EXTRACTION_SCHEMA_BLOCK}

Output JSON only.`;
}

export function buildCanonCheckPrompt(input: {
  extractionSummary: string;
  scenes: Array<{ index: number; description: string }>;
  entities: Array<{ name: string; kind: string; description: string }>;
  universeBible: string;
  recentBeats: string[];
}): string {
  const sceneBlock = input.scenes
    .slice(0, 30)
    .map((s) => `#${s.index} — ${s.description}`)
    .join('\n');
  const entityBlock = input.entities
    .slice(0, 40)
    .map((e) => `- ${e.name} (${e.kind}): ${e.description.slice(0, 280)}`)
    .join('\n');
  const beats = input.recentBeats.length
    ? `RECENT CANONICAL BEATS (do not repeat):\n${input.recentBeats.slice(0, 20).join('\n')}`
    : '';

  return `You are a canon compliance checker for a governed narrative universe.
Compare the proposed new content against the universe bible and flag conflicts.

UNIVERSE BIBLE:
${input.universeBible.slice(0, 6000)}

CANON ENTITIES:
${entityBlock}

${beats}

NEW CONTENT SUMMARY:
${input.extractionSummary}

NEW CONTENT SCENES:
${sceneBlock}

RULES:
- severity=block for rights_mismatch, timeline_impossible, or explicit character_out_of_lore
- severity=warn for costume_drift, location_layout, faction_insignia
- severity=info for duplicate_beat when the beat is structurally similar but not identical
- Only flag things grounded in the provided text. Do NOT invent contradictions.
- If there are no conflicts, return {"conflicts": []}.

Output JSON with this exact shape:
{
  "conflicts": [
    {
      "severity": "info | warn | block",
      "rule": "costume_drift | timeline_impossible | character_out_of_lore | location_layout | faction_insignia | duplicate_beat | rights_mismatch",
      "message": "human-readable explanation",
      "evidence": "quote from the new content",
      "sceneIndex": 0,
      "relatedEntityNames": ["Entity A"]
    }
  ]
}

Output JSON only.`;
}

export function buildSceneIndexPrompt(): string {
  return `You are building a searchable index over a video by scene.
For each scene you detect, output compact tags, objects, and a caption.

RULES:
- tags must be lowercase, single or two-word tokens ("red sigil", "desert", "sunset", "betrayal", "void engine")
- objects are concrete visible nouns ("sword", "spaceship hull", "crown")
- faces are proper names if you can identify them, else empty
- mood is a single descriptor ("tense", "melancholy", "triumphant")
- captions are 1 sentence max

Output JSON with this exact shape:
{
  "scenes": [
    {
      "sceneIndex": 0,
      "caption": "...",
      "tags": ["..."],
      "objects": ["..."],
      "faces": ["..."],
      "mood": "...",
      "startSec": 0.0,
      "endSec": 0.0
    }
  ]
}

Output JSON only.`;
}

export function buildRecapPrompt(input: { targetDurationSec?: number; audience?: string }): string {
  const audience = input.audience ? `\nTARGET AUDIENCE: ${input.audience}` : '';
  const duration = input.targetDurationSec
    ? `\nTARGET TRAILER DURATION: ${input.targetDurationSec}s`
    : '';
  return `You are a trailer editor + social content strategist.
Watch the video and produce packaging assets.${audience}${duration}

RULES:
- chapters: 3–7 act-level markers.
- trailerBeats: 4–10 moments that would make a compelling teaser, in the order they should appear.
- socialCuts: short clips suitable for TikTok / Reels / Shorts / Twitter.
- title: punchy, <80 chars.
- seoDescription: factual, 1–2 paragraphs, no spoilers beyond premise.
- previouslyOn: a "previously on..." paragraph as if this were an episode.
- thumbnailSuggestions: 3–5 candidate frames, ORDERED BEST-FIRST. The first
  entry MUST be the single strongest hero frame (clear subject, readable at
  thumbnail size, no motion blur, composed for poster use).

Output JSON with this exact shape:
{
  "chapters": [ { "title": "...", "startSec": 0, "summary": "..." } ],
  "trailerBeats": [ { "order": 0, "startSec": 0, "endSec": 0, "reason": "..." } ],
  "recapText": "...",
  "previouslyOn": "...",
  "socialCuts": [ { "platform": "tiktok", "startSec": 0, "endSec": 0, "caption": "..." } ],
  "title": "...",
  "seoDescription": "...",
  "thumbnailSuggestions": [ { "startSec": 0, "reason": "..." } ]
}

Output JSON only.`;
}

export function buildGovernanceDraftPrompt(input: {
  universeName: string;
  extractionSummary: string;
  scenes: Array<{ index: number; description: string; startSec: number }>;
  existingLore: string[];
  affectedEntities: Array<{ name: string; kind: string }>;
}): string {
  const sceneBlock = input.scenes
    .slice(0, 20)
    .map((s) => {
      const mm = Math.floor(s.startSec / 60)
        .toString()
        .padStart(2, '0');
      const ss = Math.floor(s.startSec % 60)
        .toString()
        .padStart(2, '0');
      return `#${s.index} @ ${mm}:${ss} — ${s.description}`;
    })
    .join('\n');
  const entityBlock = input.affectedEntities.map((e) => `- ${e.name} (${e.kind})`).join('\n');
  const loreBlock = input.existingLore.slice(0, 20).join('\n');
  return `You are drafting a canon proposal for a token-governed narrative universe: ${input.universeName}.
This proposal will be shown to voters who decide whether to ratify the change.

EXISTING LORE RULES:
${loreBlock || '(none yet)'}

AFFECTED ENTITIES:
${entityBlock || '(none)'}

NEW MEDIA SUMMARY:
${input.extractionSummary}

NEW MEDIA SCENES (timestamped):
${sceneBlock}

RULES:
- Title is a neutral summary voters can scan.
- proChange and conChange must each be honest, 2–4 sentences.
- continuityConflicts lists concrete frictions with existing lore (empty if none).
- evidence must reference scene indexes and timestamps from the scenes above.
- Do NOT decide the outcome. Frame for voters.

Output JSON with this exact shape:
{
  "title": "...",
  "summary": "...",
  "affectedEntityNames": ["..."],
  "affectedLore": ["..."],
  "continuityConflicts": ["..."],
  "proChange": "...",
  "conChange": "...",
  "evidence": [ { "sceneIndex": 0, "timestamp": "00:12", "note": "..." } ]
}

Output JSON only.`;
}

export function buildPromptImprovementPrompt(input: {
  userPrompt: string;
  referenceDescriptions: string[];
  referenceStyle?: string;
}): string {
  const refs = input.referenceDescriptions.map((d, i) => `Reference ${i + 1}: ${d}`).join('\n');
  const style = input.referenceStyle ? `\nHOUSE STYLE: ${input.referenceStyle}` : '';
  return `You are an image-prompt coach. Turn the user's short idea + reference descriptions into a detailed, single-frame generation prompt.

USER IDEA: ${input.userPrompt}
${refs}${style}

RULES:
- Output a single paragraph (2–4 sentences).
- Include framing (wide/medium/close), lighting, setting, mood, palette.
- Preserve named characters from references exactly.
- No markdown, no code fences, no JSON. Output the prompt text only.`;
}

export function buildStyleBiblePrompt(): string {
  return `You are extracting a reusable style bible from a moodboard of reference images.
Output JSON with a stylePrompt that can be prepended to future generations, a negativePrompt that lists things to avoid, and structured style descriptors.

Output JSON with this exact shape:
{
  "basePreset": "anime | gritty-scifi | graphic-novel | clay | painterly | vhs | ... (free form if none apply)",
  "stylePrompt": "concrete visual fragment to prepend",
  "negativePrompt": "things to avoid",
  "styleKeywords": ["ink lines", "rim light"],
  "palette": ["#... or named colors"],
  "cameraLanguage": "shot preferences observed",
  "lightingLanguage": "lighting preferences observed",
  "defaultStrength": 0.7
}

Output JSON only.`;
}

export function buildCopilotScorePrompt(input: {
  requestedIntent: string;
  requestedPrompt: string;
  referenceDescriptions: string[];
}): string {
  const refs = input.referenceDescriptions.map((d, i) => `Reference ${i + 1}: ${d}`).join('\n');
  return `You are a generation-output evaluator. Score how well the provided image/video matches the creator's intent and references.

REQUESTED INTENT: ${input.requestedIntent}
REQUESTED PROMPT: ${input.requestedPrompt}
${refs}

RULES:
- Scores are 0.0 to 1.0 floats.
- "issues" should be concrete, observable problems.
- "rerollPrompt" is a concrete revised prompt the user could paste back in.

Output JSON with this exact shape:
{
  "matchesIntent": 0.0,
  "identityPreserved": 0.0,
  "compositionMatch": 0.0,
  "styleMatch": 0.0,
  "issues": ["..."],
  "suggestions": ["..."],
  "rerollPrompt": "..."
}

Output JSON only.`;
}
