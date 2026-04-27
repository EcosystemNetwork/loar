/**
 * Random-entity rolling — shared between the per-kind create form and the
 * "Random universe builder" wizard on /create.
 *
 * Each roll picks a fresh seed name, style preset, and image model so a
 * creator can fill out a universe with varied looks in minutes.
 */
import { trpcClient } from '@/utils/trpc';
import { STYLE_PRESETS } from '@/components/sandbox/constants';
import type { ModelOption } from '@/components/ModelSelector';

export type EntityKind =
  | 'person'
  | 'place'
  | 'thing'
  | 'faction'
  | 'event'
  | 'lore'
  | 'species'
  | 'vehicle'
  | 'technology'
  | 'organization'
  | 'moodboard'
  | 'style_pack'
  | 'timeline'
  | 'reality'
  | 'dimension'
  | 'plane'
  | 'realm'
  | 'domain';

export const RANDOM_NAME_SEEDS: Record<EntityKind, string[]> = {
  person: [
    'Kael Ashfell',
    'Mira Voss',
    'Captain Ren Holloway',
    'Old Marrow',
    'Sister Calix',
    'Tenzin Drogo',
    'Ada Reyes',
    'Junebug Whittaker',
    'Saoirse Black',
    'The Quartermaster',
  ],
  place: [
    'Hollowmere',
    'Saltspire Reach',
    'The Glass Atrium',
    'Pale Hollow',
    'Dust Junction',
    'Vault of Ash',
    'The Hanging Bazaar',
    'Coldwater District',
    'Mirror Sea',
    'Last Light Station',
  ],
  thing: [
    'The Bone Compass',
    'Veilbreaker',
    'Shard of Origin',
    'The Silver Codex',
    'Memory Lantern',
    'Tongue of Azura',
    'The Pact Signet',
    'Worldroot Splinter',
    'Echo Reliquary',
    'The Hollow Crown',
  ],
  faction: [
    'House Velantis',
    'The Pale Cohort',
    'Children of the Sundered Sky',
    'The Iron Choir',
    'Saltbound Order',
    'The Quiet Hand',
    'Concord of Mirrors',
    'Free Riders of Drift',
    'The Last Cartographers',
    'Hollow Vow',
  ],
  event: [
    'The Sundering',
    'Night of Open Doors',
    'The Ten-Year Frost',
    'Fall of Pale Hollow',
    'The First Listening',
    'Ashfall Accord',
    'Mirror War',
    'Silent Migration',
    'Day the Sun Stuttered',
    'Treaty of Salt',
  ],
  lore: [
    'Doctrine of the Hollow',
    'On the Naming of Wells',
    'The Mirror Heresy',
    'Three Laws of Drift',
    'The Forgotten Verse',
    'Cycle of the Pale Sun',
    'Songs of the Cartographers',
    'Litany of Iron',
    'Saltbound Vows',
    'Origin of Veilcraft',
  ],
  species: [
    'Tideborn',
    'The Pale Folk',
    'Ashen Drakes',
    'Glasswalkers',
    'Hollow Kin',
    'Saltlung Whales',
    'Mirror-Eyed',
    'Driftspawn',
    'Voidlings',
    'The Sleeping Many',
  ],
  vehicle: [
    'The Long Marrow',
    'Saltcutter',
    'Drifter Three',
    'Veilrunner',
    'The Iron Albatross',
    'Hollow Maker',
    'Pale Cavalry',
    'Mirrorback',
    'Embercrawler',
    'The Slow Train',
  ],
  technology: [
    'Veilcraft',
    'Memory Lantern Engine',
    'Saltbound Compass',
    'Echo Loom',
    'Hollow Engine',
    'Mirror Forge',
    'Driftscope',
    'The Listening Glass',
    'Ashflux Reactor',
    'Veil Suture',
  ],
  organization: [
    'Cartographers Guild',
    'The Quiet Office',
    'Concord of the Pale Watch',
    'Saltbound Society',
    'Ministry of Veilworks',
    'Iron Choir Academy',
    'Hollow Trust',
    'Driftcouncil',
    'Mirror Order',
    'Last Light Bureau',
  ],
  moodboard: [
    'Salt and Static',
    'Hollow Neon',
    'Pale Sun Mood',
    'Iron and Ash',
    'Mirror Rain',
    'Veiled Dusk',
    'Drift Pastels',
    'Ash Couture',
    'Cold Cathedral',
    'Wet Glass City',
  ],
  style_pack: [
    'Hollow Inkwash',
    'Pale Sun Cinematic',
    'Mirror Anime',
    'Iron Comic',
    'Salt Watercolor',
    'Veil Noir',
    'Drift Lowpoly',
    'Ash Pixel',
    'Cold Cyberpunk',
    'Glass Painterly',
  ],
  timeline: [
    'First Age',
    'Pale Sun Era',
    'The Drift Years',
    'Post-Sundering Cycle',
    'Iron Centuries',
    'Mirror Decade',
    'The Hollow Age',
    'Saltbound Period',
    'Last Light Era',
    'Veilcraft Renaissance',
  ],
  reality: [
    'Earth-Veil',
    'Hollow Reality',
    'Mirror World',
    'Saltbound Plane',
    'Drift-Prime',
    'Pale Continuum',
    'The Iron Reflection',
    'Cold Reality',
    'Veilfold',
    'The Listening World',
  ],
  dimension: [
    'The Hollow Fold',
    'Mirror Step',
    'Pale Tier',
    'Salt Pocket',
    'Veil Layer',
    'Drift Sublevel',
    'Iron Crawlspace',
    'Ash Stratum',
    'The Listening Layer',
    'Cold Annex',
  ],
  plane: [
    'Plane of Pale Sun',
    'Hollow Plane',
    'Mirror Plane',
    'Salt Spire Plane',
    'Iron Underplane',
    'Veiled Spirit Plane',
    'Drift Astral',
    'Ash Elemental Plane',
    'Cold Hereafter',
    'The Listening Vault',
  ],
  realm: [
    'Realm of Pale Hollow',
    'Saltbound Realm',
    'Hollow Reach',
    'Iron Concord Realm',
    'Mirror Kingdom',
    'Drift Federation',
    'Veilcraft Dominion',
    'Ash Reign',
    'Cold Marches',
    'Last Light Realm',
  ],
  domain: [
    'Hollow District',
    'Saltspire Domain',
    'Pale Quarter',
    'Iron Estate',
    'Mirror Annex',
    'Drift Province',
    'Veilworks Compound',
    'Ash Zone',
    'Cold Reach',
    'Last Light Stronghold',
  ],
};

export const KIND_LABELS: Record<EntityKind, string> = {
  person: 'Person',
  place: 'Place',
  thing: 'Thing',
  faction: 'Faction',
  event: 'Event',
  lore: 'Lore Page',
  species: 'Species',
  vehicle: 'Vehicle',
  technology: 'Technology',
  organization: 'Organization',
  moodboard: 'Moodboard',
  style_pack: 'Style Pack',
  timeline: 'Timeline',
  reality: 'Reality',
  dimension: 'Dimension',
  plane: 'Plane',
  realm: 'Realm',
  domain: 'Domain',
};

export const pickRandom = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * Compose a base art-prompt fragment for a kind. Surprise me appends a style
 * preset suffix to this so each roll lands on a different visual register.
 */
export const baseArtPromptForKind = (kind: EntityKind, name: string, hint: string): string => {
  const trimmedHint = hint.trim();
  const tail = trimmedHint ? `, ${trimmedHint}` : '';
  switch (kind) {
    case 'person':
      return `Character portrait of ${name}${tail}, cinematic lighting, detailed`;
    case 'place':
      return `Establishing shot of ${name}${tail}, environment concept art, atmospheric`;
    case 'thing':
      return `Detailed illustration of ${name}${tail}, isolated on dramatic background, key light`;
    case 'faction':
      return `Heraldic banner and emblem of ${name}${tail}, faction insignia, painterly`;
    case 'event':
      return `Pivotal moment of ${name}${tail}, narrative composition, cinematic`;
    case 'lore':
      return `Illuminated manuscript page evoking ${name}${tail}, ornamental, mythic`;
    case 'species':
      return `Field-guide illustration of a ${name}${tail}, full body, natural habitat`;
    case 'vehicle':
      return `Hero shot of ${name}${tail}, three-quarter view, detailed mechanical concept`;
    case 'technology':
      return `Cutaway diagram of ${name}${tail}, technical illustration, glowing accents`;
    case 'organization':
      return `Crest and motto of ${name}${tail}, formal seal, symbolic composition`;
    case 'moodboard':
    case 'style_pack':
      return `Mood collage representing ${name}${tail}, abstract composition, evocative`;
    case 'timeline':
    case 'reality':
    case 'dimension':
    case 'plane':
    case 'realm':
    case 'domain':
    default:
      return `Symbolic landscape of ${name}${tail}, mythic, atmospheric`;
  }
};

export interface RolledEntity {
  kind: EntityKind;
  name: string;
  description: string;
  metadata: Record<string, string>;
  imageUrl: string | null;
  styleLabel: string;
  modelLabel: string;
}

/**
 * Roll one fully random entity: pick a name, style, and model, then run
 * profile generation and image generation in parallel. Returns the values
 * a caller can hand straight to entities.create.
 *
 * Both calls are wrapped in try/catch — a profile failure is fatal (we have
 * nothing useful to persist), but an image failure just leaves imageUrl null
 * so the wizard keeps moving.
 */
export async function rollRandomEntity(args: {
  kind: EntityKind;
  universeAddress?: string | null;
}): Promise<RolledEntity> {
  const { kind } = args;
  const seedNames = RANDOM_NAME_SEEDS[kind] ?? ['Untitled'];
  const name = pickRandom(seedNames);
  const preset = pickRandom(STYLE_PRESETS);

  let models: ModelOption[] = [];
  try {
    models = (await trpcClient.image.listModels.query({
      task: 'text_to_image',
    })) as ModelOption[];
  } catch {
    models = [];
  }
  const rolledModel = models.length > 0 ? pickRandom(models) : null;
  const modelId = rolledModel?.id ?? '';

  const profilePromise = trpcClient.entities.generateProfile.mutate({
    name,
    kind,
    hint: '',
  });

  const artPrompt = `${baseArtPromptForKind(kind, name, '')}, ${preset.suffix}`;
  const imagePromise = trpcClient.image.generate
    .mutate({
      prompt: artPrompt,
      task: 'text_to_image',
      imageSize: 'square_hd',
      numImages: 1,
      routingMode: modelId ? 'manual' : 'auto',
      ...(modelId ? { selectedModelId: modelId } : {}),
      universeId: args.universeAddress || undefined,
    })
    .catch(() => null);

  const [profile, imgResult] = await Promise.all([profilePromise, imagePromise]);
  const imageUrl =
    imgResult && imgResult.status === 'completed' && imgResult.imageUrls?.[0]
      ? imgResult.imageUrls[0]
      : null;

  const stringMetadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(profile.metadata)) {
    if (typeof v === 'string' && v) stringMetadata[k] = v;
  }

  return {
    kind,
    name,
    description: profile.description,
    metadata: stringMetadata,
    imageUrl,
    styleLabel: preset.label,
    modelLabel: rolledModel?.displayName ?? 'Auto',
  };
}
