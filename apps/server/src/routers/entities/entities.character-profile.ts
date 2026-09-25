/**
 * Character profile — the structured dossier for a `person` entity.
 *
 * One source of truth for which fields a character has, how they group into
 * sections, and how "complete" a profile is. The wiki page renders straight
 * from `buildCharacterProfile`, and AI completion (`entities.completeCharacterProfile`)
 * asks the model for exactly the fields listed here that are still empty.
 *
 * Everything lives in `entity.metadata` as short strings, so it works with the
 * existing create / update / collaborative-edit paths unchanged. The first six
 * keys are the historical person fields; the rest are additive.
 */
import type { Entity } from './entities.types';
import type { EpisodeAppearance } from './entities.mentions';

export interface CharacterField {
  key: string;
  label: string;
  /** What the AI (and the editor placeholder) should put here. */
  hint: string;
  /** Long-form prose vs. a short line. */
  long?: boolean;
  /** Older / seeded metadata keys that mean the same thing — read as fallbacks. */
  legacyKeys?: string[];
}

export interface CharacterSection {
  id: string;
  title: string;
  fields: CharacterField[];
}

export const CHARACTER_PROFILE_SECTIONS: CharacterSection[] = [
  {
    id: 'identity',
    title: 'Identity',
    fields: [
      { key: 'role', label: 'Role / Archetype', hint: 'Protagonist, mentor, villain, rival…' },
      { key: 'aliases', label: 'Aliases & Titles', hint: 'Other names, callsigns, epithets' },
      { key: 'age', label: 'Age', hint: 'Age or apparent age, era of birth' },
      {
        key: 'ancestry',
        label: 'Species / Ancestry',
        legacyKeys: ['species'],
        hint: 'What they are and where they come from',
      },
      {
        key: 'status',
        label: 'Status',
        hint: 'Alive, missing, dead, dormant… and where they stand now',
      },
      {
        key: 'homePlace',
        label: 'Home / Origin',
        legacyKeys: ['location'],
        hint: 'Where they are from or live',
      },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    fields: [
      { key: 'appearance', label: 'Appearance', hint: 'Physical description', long: true },
      {
        key: 'distinguishingFeatures',
        label: 'Distinguishing Features',
        legacyKeys: ['augmentations'],
        hint: 'Scars, tells, silhouette, signature colors',
      },
      {
        key: 'outfit',
        label: 'Signature Outfit & Gear',
        legacyKeys: ['signatureOutfit'],
        hint: 'What they wear and carry',
      },
    ],
  },
  {
    id: 'personality',
    title: 'Personality',
    fields: [
      {
        key: 'personality',
        label: 'Personality',
        hint: 'Temperament and how they behave',
        long: true,
      },
      { key: 'motivations', label: 'Motivations', hint: 'What drives them', long: true },
      { key: 'fears', label: 'Fears & Flaws', hint: 'What breaks or blinds them' },
      {
        key: 'speechStyle',
        label: 'Voice & Speech Style',
        legacyKeys: ['voice'],
        hint: 'How they talk; a signature line',
      },
    ],
  },
  {
    id: 'abilities',
    title: 'Abilities',
    fields: [
      {
        key: 'abilities',
        label: 'Abilities / Skills',
        legacyKeys: ['skills'],
        hint: 'Powers, skills, talents',
        long: true,
      },
      {
        key: 'weaknesses',
        label: 'Limits & Weaknesses',
        hint: 'What they cannot do, and what it costs',
      },
    ],
  },
  {
    id: 'history',
    title: 'History & Connections',
    fields: [
      {
        key: 'backstory',
        label: 'Backstory',
        hint: 'Key events that made them who they are',
        long: true,
      },
      {
        key: 'firstAppearance',
        label: 'First Appearance',
        hint: 'Episode, scene or event where they debut',
      },
      {
        key: 'affiliations',
        label: 'Affiliations',
        legacyKeys: ['faction'],
        hint: 'Factions, organizations, allies',
      },
    ],
  },
];

export const CHARACTER_FIELDS: CharacterField[] = CHARACTER_PROFILE_SECTIONS.flatMap(
  (s) => s.fields
);
export const CHARACTER_FIELD_KEYS: string[] = CHARACTER_FIELDS.map((f) => f.key);

/** A field counts as filled once it has real text (whitespace / placeholder dashes don't). */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return text.length > 0 && !/^[-–—?.]+$/.test(text);
}

/** The value of a field, falling back to its legacy keys. Empty string when unset. */
export function readField(md: Record<string, unknown>, field: CharacterField): string {
  for (const k of [field.key, ...(field.legacyKeys ?? [])]) {
    if (isFilled(md[k])) return String(md[k]).trim();
  }
  return '';
}

/** camelCase / snake_case metadata key → "Camel case" label for unknown fields. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Asset/connection signals gathered by the route; all optional so the builder stays pure. */
export interface CharacterProfileSignals {
  relationCount?: number;
  mediaCount?: number;
  referenceCount?: number;
  appearances?: EpisodeAppearance[];
}

export interface CharacterAssetCheck {
  key: 'portrait' | 'references' | 'model3d' | 'relationships' | 'media';
  label: string;
  done: boolean;
  count?: number;
}

export interface CharacterProfile {
  entityId: string;
  name: string;
  summary: string;
  sections: Array<{
    id: string;
    title: string;
    fields: Array<CharacterField & { value: string; filled: boolean }>;
  }>;
  /** Metadata keys that aren't part of the spec (kept so nothing is ever hidden). */
  extra: Array<{ key: string; value: string }>;
  completeness: {
    filled: number;
    total: number;
    percent: number;
    missing: string[];
    hasDescription: boolean;
  };
  assets: CharacterAssetCheck[];
  /** Canon episodes that mention the character by name. */
  appearances: EpisodeAppearance[];
}

/** Metadata keys that hold structured blobs, not display text. */
const NON_DISPLAY_KEYS = new Set(['characterVariants', 'modelUrl']);

function hasModel(entity: Pick<Entity, 'metadata'>): boolean {
  const md = entity.metadata ?? {};
  if (isFilled(md.modelUrl)) return true;
  const variants = md.characterVariants;
  return (
    Array.isArray(variants) &&
    variants.some((v) => v && typeof v === 'object' && (v as any).type === '3d')
  );
}

export function buildCharacterProfile(
  entity: Pick<Entity, 'id' | 'name' | 'description' | 'imageUrl' | 'metadata'>,
  signals: CharacterProfileSignals = {}
): CharacterProfile {
  const md = (entity.metadata ?? {}) as Record<string, unknown>;
  const spec = new Set(CHARACTER_FIELDS.flatMap((f) => [f.key, ...(f.legacyKeys ?? [])]));

  const sections = CHARACTER_PROFILE_SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    fields: s.fields.map((f) => ({
      ...f,
      value: readField(md, f),
      filled: readField(md, f) !== '',
    })),
  }));

  const all = sections.flatMap((s) => s.fields);
  const filled = all.filter((f) => f.filled).length;
  const hasDescription = (entity.description ?? '').trim().length >= 40;

  const extra = Object.entries(md)
    .filter(([k, v]) => !spec.has(k) && !NON_DISPLAY_KEYS.has(k) && isFilled(v))
    .map(([key, v]) => ({ key: humanizeKey(key), value: String(v) }));

  const relationCount = signals.relationCount ?? 0;
  const mediaCount = signals.mediaCount ?? 0;
  const referenceCount = signals.referenceCount ?? 0;

  return {
    entityId: entity.id,
    name: entity.name,
    summary: entity.description ?? '',
    sections,
    extra,
    completeness: {
      filled,
      total: all.length,
      percent: all.length === 0 ? 0 : Math.round((filled / all.length) * 100),
      missing: all.filter((f) => !f.filled).map((f) => f.key),
      hasDescription,
    },
    appearances: signals.appearances ?? [],
    assets: [
      { key: 'portrait', label: 'Portrait', done: isFilled(entity.imageUrl) },
      {
        key: 'references',
        label: 'Reference images',
        done: referenceCount > 0,
        count: referenceCount,
      },
      { key: 'model3d', label: '3D model', done: hasModel(entity) },
      {
        key: 'relationships',
        label: 'Relationships',
        done: relationCount > 0,
        count: relationCount,
      },
      { key: 'media', label: 'Media & assets', done: mediaCount > 0, count: mediaCount },
    ],
  };
}

/**
 * Merge AI-generated metadata into existing metadata without ever overwriting
 * something a human already wrote. Only spec keys are accepted, and only when
 * the existing value is empty and the generated one is real text.
 */
export function mergeGeneratedFields(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>
): { metadata: Record<string, unknown>; added: string[] } {
  const metadata = { ...existing };
  const added: string[] = [];
  const byKey = new Map(CHARACTER_FIELDS.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(generated)) {
    const field = byKey.get(key);
    if (!field || readField(existing, field) !== '' || !isFilled(value)) continue;
    metadata[key] = String(value).trim().slice(0, 1200);
    added.push(key);
  }
  return { metadata, added };
}
