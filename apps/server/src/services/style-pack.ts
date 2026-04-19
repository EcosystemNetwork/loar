/**
 * Style Pack + Moodboard composition (PRD 5).
 *
 * Given an optional style_pack entity, an optional moodboard entity, and a
 * style strength in [0, 1], this module produces a prompt prefix, negative
 * prompt fragment, and reference image URL list that the image/video routers
 * merge into their provider calls.
 *
 * Strength interpretation:
 *   0.0  — user prompt only; style pack ignored
 *   0.5  — style pack appended as a light influence
 *   0.7  — balanced (default)
 *   1.0  — full retexture: style becomes the dominant instruction
 *
 * The helper is provider-agnostic — it only shapes text and URL lists. The
 * caller (image.routes.ts, generation.routes.ts) decides how to pass the
 * result to the underlying model.
 */
import { db } from '../lib/firebase';
import type {
  Entity,
  MoodboardMetadata,
  StylePackMetadata,
  StyleReferenceImage,
} from '../routers/entities/entities.types';

export interface StyleComposition {
  /** Text fragment prepended or appended to the user prompt. */
  stylePrefix: string;
  /** Negative prompt fragment merged with any existing negative prompt. */
  negativeAddendum: string;
  /** Reference image URLs harvested from the style pack + moodboard. */
  referenceImages: string[];
  /** Tags that downstream systems can surface in UI or logging. */
  tags: string[];
  /** Which style pack, if any, was actually applied. */
  appliedStylePackEntityId: string | null;
  /** Which moodboard, if any, was actually merged. */
  appliedMoodboardEntityId: string | null;
  /** Effective strength after clamping. */
  strength: number;
}

export interface ComposeStyleInput {
  stylePackEntityId?: string | null;
  moodboardEntityId?: string | null;
  /** 0..1. If omitted, falls back to style_pack.metadata.defaultStrength or 0.7. */
  styleStrength?: number;
  /**
   * When true and no stylePackEntityId was provided, resolve the universe's
   * canon style pack and apply it automatically.
   */
  universeId?: string | null;
}

const DEFAULT_STRENGTH = 0.7;

function clampStrength(v: number | undefined, fallback: number): number {
  if (v === undefined || v === null || Number.isNaN(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function collectReferenceUrls(refs: StyleReferenceImage[] | undefined): string[] {
  if (!refs) return [];
  return refs
    .map((r) => (r && typeof r.url === 'string' ? r.url : null))
    .filter((url): url is string => Boolean(url));
}

async function loadEntity(entityId: string): Promise<Entity | null> {
  const doc = await db.collection('entities').doc(entityId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as Entity;
}

async function resolveCanonStylePack(universeId: string): Promise<string | null> {
  const doc = await db.collection('cinematicUniverses').doc(universeId.toLowerCase()).get();
  if (!doc.exists) return null;
  const id = doc.data()?.canonStylePackEntityId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Build a style composition. Safe to call with all-null inputs — returns an
 * empty composition the caller can ignore.
 */
export async function composeStyle(input: ComposeStyleInput): Promise<StyleComposition> {
  const empty: StyleComposition = {
    stylePrefix: '',
    negativeAddendum: '',
    referenceImages: [],
    tags: [],
    appliedStylePackEntityId: null,
    appliedMoodboardEntityId: null,
    strength: 0,
  };

  // Resolve which style pack to apply
  let stylePackId = input.stylePackEntityId ?? null;
  if (!stylePackId && input.universeId) {
    stylePackId = await resolveCanonStylePack(input.universeId);
  }

  const [stylePackEntity, moodboardEntity] = await Promise.all([
    stylePackId ? loadEntity(stylePackId) : Promise.resolve(null),
    input.moodboardEntityId ? loadEntity(input.moodboardEntityId) : Promise.resolve(null),
  ]);

  // Entity kind validation — silently drop mismatches so a bad client id
  // doesn't break generation.
  const validStylePack =
    stylePackEntity && stylePackEntity.kind === 'style_pack' ? stylePackEntity : null;
  const validMoodboard =
    moodboardEntity && moodboardEntity.kind === 'moodboard' ? moodboardEntity : null;

  if (!validStylePack && !validMoodboard) return empty;

  const stylePackMeta = (validStylePack?.metadata ?? {}) as StylePackMetadata;
  const moodboardMeta = (validMoodboard?.metadata ?? {}) as MoodboardMetadata;

  const strength = clampStrength(
    input.styleStrength,
    clampStrength(stylePackMeta.defaultStrength, DEFAULT_STRENGTH)
  );

  if (strength === 0) {
    return {
      ...empty,
      appliedStylePackEntityId: validStylePack?.id ?? null,
      appliedMoodboardEntityId: validMoodboard?.id ?? null,
    };
  }

  // ── Prompt composition ───────────────────────────────────────────────
  const parts: string[] = [];
  if (validStylePack) {
    if (stylePackMeta.basePreset) parts.push(`${stylePackMeta.basePreset} style`);
    if (stylePackMeta.stylePrompt) parts.push(stylePackMeta.stylePrompt);
    if (Array.isArray(stylePackMeta.styleKeywords) && stylePackMeta.styleKeywords.length) {
      parts.push(stylePackMeta.styleKeywords.join(', '));
    }
  }
  if (validMoodboard) {
    if (Array.isArray(moodboardMeta.tags) && moodboardMeta.tags.length) {
      parts.push(`mood: ${moodboardMeta.tags.join(', ')}`);
    }
    if (moodboardMeta.notes) parts.push(moodboardMeta.notes);
  }

  // Strength scaling. Below 0.5, append as a softer "with subtle …" hint.
  // Above 0.5, prepend and emphasise.
  let stylePrefix = '';
  if (parts.length > 0) {
    const joined = parts.join(', ');
    stylePrefix = strength >= 0.5 ? joined : `with subtle ${joined}`;
  }

  // ── Negative prompt ──────────────────────────────────────────────────
  const negativeAddendum = validStylePack ? (stylePackMeta.negativePrompt ?? '') : '';

  // ── Reference images ─────────────────────────────────────────────────
  const referenceImages: string[] = [
    ...collectReferenceUrls(stylePackMeta.referenceImages),
    ...collectReferenceUrls(moodboardMeta.referenceImages),
  ];

  const tags: string[] = [];
  if (stylePackMeta.basePreset) tags.push(stylePackMeta.basePreset);
  if (Array.isArray(moodboardMeta.tags)) tags.push(...moodboardMeta.tags);

  return {
    stylePrefix,
    negativeAddendum,
    referenceImages,
    tags,
    appliedStylePackEntityId: validStylePack?.id ?? null,
    appliedMoodboardEntityId: validMoodboard?.id ?? null,
    strength,
  };
}

/**
 * Merge a composed style into an existing prompt/negative prompt pair.
 * Strength ≥ 0.5 prepends the style prefix so it has stronger influence;
 * below that, the prefix is appended as a lighter modifier.
 */
export function applyStyleToPrompt(
  prompt: string,
  negativePrompt: string | undefined,
  composition: StyleComposition
): { prompt: string; negativePrompt: string | undefined } {
  let merged = prompt;
  if (composition.stylePrefix) {
    merged =
      composition.strength >= 0.5
        ? `${composition.stylePrefix}. ${prompt}`
        : `${prompt}, ${composition.stylePrefix}`;
  }

  let mergedNegative = negativePrompt;
  if (composition.negativeAddendum) {
    mergedNegative = negativePrompt
      ? `${negativePrompt}, ${composition.negativeAddendum}`
      : composition.negativeAddendum;
  }

  return { prompt: merged, negativePrompt: mergedNegative };
}
