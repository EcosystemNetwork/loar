/**
 * LOAR Director — routes a voice/text utterance to either a canon lookup
 * or a story-mutating action.
 *
 *   VOICE → LOAR DIRECTOR → { CANON QUERY | STORY ACTION } → LOAR WORLD
 *
 * This module owns the classification step plus the canon-query leaf
 * (answered directly from universe/entity data). Story actions are only
 * *planned* here — kind, extracted parameters, and a spoken acknowledgement
 * — and executed by the existing dedicated routers (offChainNodes.create,
 * universeEvents.create, generation.*), so ownership/credit checks never
 * get bypassed by a voice shortcut.
 */
import { randomUUID } from 'crypto';
import { db } from '../lib/firebase';
import { routeLlmModel } from './llm-models/router';
import { dispatchLlm } from './llm-models/dispatch';
import { buildGenerationContext } from './wiki-context';
import { humeService } from './hume';
import { getStorageManager } from './storage';

export type DirectorIntent = 'canon_query' | 'story_action';
export type StoryActionKind = 'create_node' | 'branch_story' | 'generate_scene';

export interface DirectorClassification {
  intent: DirectorIntent;
  confidence: number;
}

export interface CanonQueryResult {
  answer: string;
  hasContext: boolean;
}

export interface StoryActionPlan {
  kind: StoryActionKind;
  summary: string;
  params: Record<string, string>;
  spokenAck: string;
}

const MAX_SPOKEN_CHARS = 600;

/** Trim to a spoken-friendly length without cutting mid-sentence when avoidable. */
function toSpokenLength(text: string, max = MAX_SPOKEN_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

function pickModel(json: boolean): string {
  return routeLlmModel({
    requires: json ? { chat: true, json_mode: true } : { chat: true },
    costBudget: 'low',
  }).chosenModelId;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Classify an utterance as a canon lookup ("who is X", "what happened in
 * episode 3") vs a story-mutating action ("create a scene where...",
 * "branch the story here", "generate a shot of..."). Defaults to
 * `canon_query` on any failure — the safer of the two paths, since it never
 * mutates the universe.
 */
export async function classifyDirectorIntent(opts: {
  utterance: string;
  userId?: string | null;
}): Promise<DirectorClassification> {
  let modelId: string;
  try {
    modelId = pickModel(true);
  } catch {
    return { intent: 'canon_query', confidence: 0 };
  }

  const prompt = `You are the intent router for LOAR, a collaborative story-universe platform. A user spoke or typed the line below to the story director. Decide whether it is:

- "canon_query": asking about existing characters, relationships, lore, places, or previous events (read-only).
- "story_action": asking to create or change something in the story — a new node/scene, a branch off an existing point, or a generated shot/clip.

Line: """${opts.utterance}"""

Respond with strict JSON only: {"intent": "canon_query" | "story_action", "confidence": number between 0 and 1}`;

  const result = await dispatchLlm({
    modelId,
    userId: opts.userId ?? undefined,
    maxTokens: 100,
    jsonMode: true,
    messages: [{ role: 'user', content: prompt }],
  }).catch(() => null);

  if (!result) return { intent: 'canon_query', confidence: 0 };

  const parsed = parseJsonObject(result.text);
  const intent = parsed?.intent === 'story_action' ? 'story_action' : 'canon_query';
  const confidenceRaw = typeof parsed?.confidence === 'number' ? parsed.confidence : 0.5;
  const confidence = Math.max(0, Math.min(1, confidenceRaw));

  return { intent, confidence };
}

/**
 * Answer a canon query grounded in the universe's (and optionally a single
 * entity's) recorded lore. Never invents canon that isn't in the context —
 * when there's nothing on record it says so instead of guessing.
 */
export async function answerCanonQuery(opts: {
  utterance: string;
  universeId: string;
  entityId?: string;
  userId?: string | null;
}): Promise<CanonQueryResult> {
  const context = await buildGenerationContext({
    universeId: opts.universeId,
    entityId: opts.entityId,
  }).catch(() => null);

  if (!context) {
    return {
      answer: "There's nothing on record for that yet in this universe's canon.",
      hasContext: false,
    };
  }

  let modelId: string;
  try {
    modelId = pickModel(false);
  } catch {
    return { answer: "I couldn't reach the canon lookup right now.", hasContext: true };
  }

  const prompt = `You are LOAR's story director, answering a canon question from the established universe lore below. Answer only from this context — if the answer isn't in it, say the canon doesn't cover that yet. Keep the answer to 2-3 spoken sentences.

${context}

Question: """${opts.utterance}"""`;

  const result = await dispatchLlm({
    modelId,
    userId: opts.userId ?? undefined,
    maxTokens: 300,
    messages: [{ role: 'user', content: prompt }],
  }).catch(() => null);

  if (!result) {
    return { answer: "I couldn't reach the canon lookup right now.", hasContext: true };
  }

  return { answer: toSpokenLength(result.text), hasContext: true };
}

export interface CharacterVoiceResult {
  audioUrl: string | null;
}

/**
 * Voice a director/character response through Hume (Character Voice → HUME).
 * Best-effort: when Hume isn't configured or the call fails, degrades to
 * `audioUrl: null` so the caller falls back to text — never blocks the
 * response the way `canon-check`'s vision call degrades to `null`.
 */
export async function synthesizeCharacterVoice(opts: {
  text: string;
  humeVoiceId?: string;
  humeVoiceName?: string;
  description?: string;
}): Promise<CharacterVoiceResult> {
  if (!humeService.isConfigured()) return { audioUrl: null };

  try {
    const result = await humeService.textToSpeech({
      text: opts.text,
      voiceId: opts.humeVoiceId,
      voiceName: opts.humeVoiceName,
      description: opts.description,
    });
    const manifest = await getStorageManager().upload(
      result.audioBuffer,
      `director-voice-${randomUUID()}.mp3`,
      result.contentType
    );
    return { audioUrl: manifest.uploads[0]?.url ?? null };
  } catch (err) {
    console.warn(
      '[loar-director] Hume synthesis failed:',
      err instanceof Error ? err.message : err
    );
    return { audioUrl: null };
  }
}

interface EntityVoiceProfile {
  humeVoiceId?: string;
  humeVoiceName?: string;
  description?: string;
}

/**
 * Per-character voice mapping: reads `metadata.humeVoiceId` /
 * `metadata.humeVoiceName` / `metadata.humeVoiceDescription` off a
 * character (or any) entity — the same loosely-typed metadata bag other
 * entity fields already live in (see `USEFUL_METADATA` in
 * `wiki-context.ts`). Set via the existing `entities.update` mutation;
 * no new write path needed. Returns null when the entity has no voice
 * assigned, so callers can fall back to text-only.
 */
async function resolveEntityVoiceProfile(entityId: string): Promise<EntityVoiceProfile | null> {
  if (!db) return null;
  try {
    const doc = await db.collection('entities').doc(entityId).get();
    if (!doc.exists) return null;
    const metadata = (doc.data()?.metadata ?? {}) as Record<string, unknown>;
    const humeVoiceId =
      typeof metadata.humeVoiceId === 'string' && metadata.humeVoiceId
        ? metadata.humeVoiceId
        : undefined;
    const humeVoiceName =
      typeof metadata.humeVoiceName === 'string' && metadata.humeVoiceName
        ? metadata.humeVoiceName
        : undefined;
    if (!humeVoiceId && !humeVoiceName) return null;
    const description =
      typeof metadata.humeVoiceDescription === 'string' ? metadata.humeVoiceDescription : undefined;
    return { humeVoiceId, humeVoiceName, description };
  } catch {
    return null;
  }
}

/**
 * Resolve which voice to speak with — an explicit override first, else the
 * target entity's assigned voice — then synthesize through Hume. Returns
 * `audioUrl: null` (never throws) when nothing is resolvable or the call
 * fails, so a character without a voice assigned just stays text-only.
 */
export async function resolveAndSynthesizeCharacterVoice(opts: {
  text: string;
  entityId?: string;
  override?: { humeVoiceId?: string; humeVoiceName?: string; description?: string };
}): Promise<CharacterVoiceResult> {
  let profile: EntityVoiceProfile | null = null;
  if (opts.override?.humeVoiceId || opts.override?.humeVoiceName) {
    profile = opts.override;
  } else if (opts.entityId) {
    profile = await resolveEntityVoiceProfile(opts.entityId);
  }
  if (!profile) return { audioUrl: null };

  return synthesizeCharacterVoice({
    text: opts.text,
    humeVoiceId: profile.humeVoiceId,
    humeVoiceName: profile.humeVoiceName,
    description: opts.override?.description ?? profile.description,
  });
}

const STORY_ACTION_LABELS: Record<StoryActionKind, string> = {
  create_node: 'creating a new story node',
  branch_story: 'branching the story here',
  generate_scene: 'generating a new scene',
};

/**
 * Turn a story-action utterance into a structured plan: which of the three
 * action kinds it is, the extracted parameters, and a short spoken
 * acknowledgement. This does not execute anything — the client (or a
 * follow-up call) hands the plan to the real mutation (offChainNodes.create,
 * universeEvents.create, generation.*) which enforces ownership + credits.
 */
export async function planStoryAction(opts: {
  utterance: string;
  universeId: string;
  userId?: string | null;
}): Promise<StoryActionPlan> {
  const fallback: StoryActionPlan = {
    kind: 'create_node',
    summary: opts.utterance,
    params: { description: opts.utterance },
    spokenAck: "Got it — I'll set that up.",
  };

  let modelId: string;
  try {
    modelId = pickModel(true);
  } catch {
    return fallback;
  }

  const prompt = `You are LOAR's story director. The user asked for a story action. Classify it into exactly one kind:

- "create_node": continue the timeline with a new scene/node.
- "branch_story": start an alternate branch from an existing point in the story.
- "generate_scene": generate a specific shot/clip (a visual, not a plot beat).

Also extract a short "title" (<=80 chars) and a "description" (<=400 chars) capturing what they asked for, in your own words.

Line: """${opts.utterance}"""

Respond with strict JSON only: {"kind": "create_node" | "branch_story" | "generate_scene", "title": string, "description": string}`;

  const result = await dispatchLlm({
    modelId,
    userId: opts.userId ?? undefined,
    maxTokens: 250,
    jsonMode: true,
    messages: [{ role: 'user', content: prompt }],
  }).catch(() => null);

  if (!result) return fallback;

  const parsed = parseJsonObject(result.text);
  const kind: StoryActionKind =
    parsed?.kind === 'branch_story' || parsed?.kind === 'generate_scene'
      ? parsed.kind
      : 'create_node';
  const title = typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title : '';
  const description =
    typeof parsed?.description === 'string' && parsed.description.trim()
      ? parsed.description
      : opts.utterance;

  return {
    kind,
    summary: title ? `${title} — ${description}` : description,
    params: { title, description },
    spokenAck: `On it — ${STORY_ACTION_LABELS[kind]}: ${title || description.slice(0, 60)}`,
  };
}
