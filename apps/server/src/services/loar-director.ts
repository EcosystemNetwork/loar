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
import { humeService, HUME_TTS_COST_PER_1K_CHARS_USD } from './hume';
import { getStorageManager } from './storage';
import { assertProviderAllowed, recordProviderCost } from './cost-tracker';

export type DirectorIntent = 'canon_query' | 'story_action';
export type StoryActionKind = 'create_node' | 'branch_story' | 'update_node' | 'generate_scene';

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

/**
 * Answer as a character, in first person, grounded in what that character
 * could plausibly know from the recorded canon — not a narrator summary.
 * When the entity's own context doesn't cover the question, the character
 * says so in-character rather than inventing knowledge it shouldn't have
 * (e.g. who's responsible for something it hasn't discovered yet).
 */
export async function answerAsCharacter(opts: {
  utterance: string;
  universeId: string;
  entityId: string;
  userId?: string | null;
}): Promise<CanonQueryResult> {
  const context = await buildGenerationContext({
    universeId: opts.universeId,
    entityId: opts.entityId,
  }).catch(() => null);

  if (!context) {
    return { answer: "I don't have anything to say about that.", hasContext: false };
  }

  let modelId: string;
  try {
    modelId = pickModel(false);
  } catch {
    return { answer: "I can't find the words right now.", hasContext: true };
  }

  const prompt = `You are voicing a character inside a LOAR story universe, speaking in first person AS them — not as a narrator describing them. Stay strictly within what this character would plausibly know from the context below. If asked about something they have no way of knowing yet (a secret not yet discovered, another character's private motive, an event that hasn't happened to them), say so in character — deflect, express uncertainty, or say they don't know — rather than revealing it. Keep it to 2-4 spoken sentences in their voice.

${context}

They are asked: """${opts.utterance}"""

Respond with only what the character says — no quotation marks, no stage directions, no "As [name],".`;

  const result = await dispatchLlm({
    modelId,
    userId: opts.userId ?? undefined,
    maxTokens: 300,
    messages: [{ role: 'user', content: prompt }],
  }).catch(() => null);

  if (!result) {
    return { answer: "I can't find the words right now.", hasContext: true };
  }

  return { answer: toSpokenLength(result.text), hasContext: true };
}

export interface CharacterVoiceResult {
  audioUrl: string | null;
}

/**
 * Voice a director/character response through Hume (Character Voice → HUME).
 * Best-effort: when Hume isn't configured, the admin kill-switch/cost caps
 * reject it, or the call fails, degrades to `audioUrl: null` so the caller
 * falls back to text — never blocks the response the way `canon-check`'s
 * vision call degrades to `null`.
 *
 * Gated on the same `assertProviderAllowed` kill-switch/cap check every
 * other paid provider dispatch goes through, and records actual spend via
 * `recordProviderCost` so it shows up in the admin cost/margin dashboards —
 * this is a server-pool key (not BYOK/user-credit-billed), so cost-tracker
 * observability is the only spend guardrail it has.
 */
export async function synthesizeCharacterVoice(opts: {
  text: string;
  humeVoiceId?: string;
  humeVoiceName?: string;
  description?: string;
}): Promise<CharacterVoiceResult> {
  if (!humeService.isConfigured()) return { audioUrl: null };

  try {
    await assertProviderAllowed({ provider: 'hume' });

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

    recordProviderCost({
      provider: 'hume',
      kind: 'audio_gen',
      model: 'octave-tts',
      costUsd: (opts.text.length / 1000) * HUME_TTS_COST_PER_1K_CHARS_USD,
      extra: { characterCount: opts.text.length },
    }).catch((err) => console.warn('[loar-director] recordProviderCost(hume) failed:', err));

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
  update_node: 'updating that scene',
  generate_scene: 'generating a new scene',
};

/**
 * Turn a story-action utterance into a structured plan: which action kind
 * it is, the extracted parameters, and a short spoken acknowledgement. This
 * does not execute anything — the client (or a follow-up call) hands the
 * plan to `executeStoryAction`, which enforces ownership + credits.
 *
 * `hasActiveNode` tells the classifier whether there's a node from earlier
 * in this conversation that "change that" / "actually, ..." could refer to
 * — pass true once the client has a `lastEventId` from a prior create/branch
 * in the same session. Without it, revision language falls back to
 * `create_node` rather than guessing at a target to update.
 */
export async function planStoryAction(opts: {
  utterance: string;
  universeId: string;
  userId?: string | null;
  hasActiveNode?: boolean;
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

  const updateOption = opts.hasActiveNode
    ? `\n- "update_node": revise the scene/node created or discussed earlier in this conversation (e.g. "actually, she shouldn't know that yet", "change the ending").`
    : '';

  const prompt = `You are LOAR's story director. The user asked for a story action. Classify it into exactly one kind:

- "create_node": continue the timeline with a new scene/node.
- "branch_story": start an alternate branch from an existing point in the story.${updateOption}
- "generate_scene": generate a specific shot/clip (a visual, not a plot beat).

Also extract a short "title" (<=80 chars) and a "description" (<=400 chars) capturing what they asked for, in your own words. For "update_node", the description should be the revised scene content, not just the delta.

Line: """${opts.utterance}"""

Respond with strict JSON only: {"kind": "create_node" | "branch_story"${opts.hasActiveNode ? ' | "update_node"' : ''} | "generate_scene", "title": string, "description": string}`;

  const result = await dispatchLlm({
    modelId,
    userId: opts.userId ?? undefined,
    maxTokens: 250,
    jsonMode: true,
    messages: [{ role: 'user', content: prompt }],
  }).catch(() => null);

  if (!result) return fallback;

  const parsed = parseJsonObject(result.text);
  const allowUpdate = !!opts.hasActiveNode;
  const kind: StoryActionKind =
    parsed?.kind === 'branch_story' ||
    parsed?.kind === 'generate_scene' ||
    (allowUpdate && parsed?.kind === 'update_node')
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
