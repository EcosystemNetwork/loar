/**
 * LOAR Voice Library — curated seed catalog.
 *
 * Each entry is materialized once by `scripts/seed-voice-library.ts`:
 *   1. Call ElevenLabs designVoice() to mint the voiceId + preview audio
 *   2. Upload preview to Firebase Storage
 *   3. Write the resulting `voiceLibrary/{slug}` doc
 *
 * Seeding is idempotent — re-running skips any slug whose doc already has a
 * non-empty voiceId. This is the "permanent platform value" we mint during
 * the ElevenLabs unlimited window.
 *
 * 51 entries:
 *   5 narrators · 5 male leads · 5 female leads · 5 villains · 4 children
 *   4 elderly · 4 creatures · 10 accents · 9 specialty
 */

export type SeedGender = 'male' | 'female' | 'neutral';
export type SeedAge = 'young' | 'middle_aged' | 'old';
export type SeedCategory =
  | 'narrator'
  | 'protagonist_male'
  | 'protagonist_female'
  | 'villain'
  | 'child'
  | 'elderly'
  | 'creature'
  | 'accent'
  | 'specialty';

export interface VoiceLibrarySeedEntry {
  slug: string;
  name: string;
  description: string;
  previewText: string;
  category: SeedCategory;
  gender: SeedGender;
  age: SeedAge;
  accent?: string;
  accentStrength?: number;
  tags: string[];
}

const NARRATOR_PREVIEW =
  'In the age that came before, when stars still answered to their old names, a single lantern was lit at the edge of the world.';
const PROTAGONIST_PREVIEW =
  'I never asked for any of this. But here we are — and there is no road back. So we go forward, together.';
const VILLAIN_PREVIEW =
  'You misunderstand me. I do not want to destroy your world. I want you to give it to me, willingly, on your knees.';
const CHILD_PREVIEW = 'Hey! Wait up! Mom said I get to come on this adventure too — you promised!';
const ELDERLY_PREVIEW =
  'I have seen seventy winters. Each one teaches the same lesson: hold tight to the small things, for they are all that is given to us.';
const CREATURE_PREVIEW =
  'You came to my mountain. You woke me from a long sleep. You will not leave the way you came.';
const SPECIALTY_PREVIEW =
  'Initiating sequence. All systems are nominal. Stand by — the simulation will resume momentarily.';
const ACCENT_PREVIEW =
  'Right, so the plan is simple enough: in through the side door, grab what we came for, and out before they know we were there.';

export const VOICE_LIBRARY_SEED: VoiceLibrarySeedEntry[] = [
  // ── Narrators ──────────────────────────────────────────────────────
  {
    slug: 'narrator-noble',
    name: 'Aldric the Recorder',
    description:
      'Stately, measured narrator with weight and authority — chronicles, epics, prologue voiceovers.',
    previewText: NARRATOR_PREVIEW,
    category: 'narrator',
    gender: 'male',
    age: 'middle_aged',
    accent: 'british',
    accentStrength: 1.1,
    tags: ['narrator', 'epic', 'noble', 'voiceover'],
  },
  {
    slug: 'narrator-ominous',
    name: 'The Watcher in Dark',
    description: 'Low, ominous narrator for horror, mystery, cold open. Restrained and patient.',
    previewText: NARRATOR_PREVIEW,
    category: 'narrator',
    gender: 'male',
    age: 'old',
    tags: ['narrator', 'horror', 'mystery', 'cold-open'],
  },
  {
    slug: 'narrator-friendly',
    name: 'Lyra Storywell',
    description:
      'Warm, friendly narrator for fables, kid-friendly worldbuilding, breezy travelogues.',
    previewText: NARRATOR_PREVIEW,
    category: 'narrator',
    gender: 'female',
    age: 'middle_aged',
    tags: ['narrator', 'friendly', 'storyteller', 'fable'],
  },
  {
    slug: 'narrator-gritty',
    name: 'Garrick the Hardbitten',
    description:
      'Gritty noir narrator — rain-on-asphalt cadence, world-weary edge. Crime, dystopia, neo-noir.',
    previewText: NARRATOR_PREVIEW,
    category: 'narrator',
    gender: 'male',
    age: 'middle_aged',
    tags: ['narrator', 'noir', 'gritty', 'detective'],
  },
  {
    slug: 'narrator-neutral',
    name: 'Standard Bearer',
    description:
      'Neutral, professional narrator. Documentary tone — no accent baggage, scales across genres.',
    previewText: NARRATOR_PREVIEW,
    category: 'narrator',
    gender: 'neutral',
    age: 'middle_aged',
    tags: ['narrator', 'neutral', 'documentary', 'utility'],
  },

  // ── Male Protagonists ──────────────────────────────────────────────
  {
    slug: 'lead-m-stoic',
    name: 'Captain Rourke',
    description: 'Stoic, deliberate male lead. Soldier, commander, reluctant hero.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_male',
    gender: 'male',
    age: 'middle_aged',
    tags: ['protagonist', 'stoic', 'soldier', 'leader'],
  },
  {
    slug: 'lead-m-rakish',
    name: 'Finn Quickstep',
    description: 'Rakish young male lead — charm, mischief, fast wit. Rogue archetype.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_male',
    gender: 'male',
    age: 'young',
    tags: ['protagonist', 'rogue', 'charming', 'witty'],
  },
  {
    slug: 'lead-m-earnest',
    name: 'Theo Brightwood',
    description:
      'Earnest, idealistic male lead — the apprentice, the chosen one, the boy who would be hero.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_male',
    gender: 'male',
    age: 'young',
    tags: ['protagonist', 'earnest', 'chosen-one', 'idealist'],
  },
  {
    slug: 'lead-m-grizzled',
    name: 'Old Marshal Vance',
    description:
      'Grizzled veteran lead — past his prime but sharper for it. Mentor or comeback protagonist.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_male',
    gender: 'male',
    age: 'old',
    tags: ['protagonist', 'mentor', 'veteran', 'grizzled'],
  },
  {
    slug: 'lead-m-quiet',
    name: 'Sable',
    description:
      'Quiet intensity — the silent lead who speaks rarely and means every word. Assassin, monk, wanderer.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_male',
    gender: 'male',
    age: 'middle_aged',
    tags: ['protagonist', 'quiet', 'intense', 'wanderer'],
  },

  // ── Female Protagonists ────────────────────────────────────────────
  {
    slug: 'lead-f-commanding',
    name: 'Empress Yara',
    description: 'Commanding female lead — ruler, general, queen who will not be moved.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_female',
    gender: 'female',
    age: 'middle_aged',
    tags: ['protagonist', 'commanding', 'ruler', 'general'],
  },
  {
    slug: 'lead-f-firebrand',
    name: 'Nessa the Spark',
    description:
      'Firebrand young female lead — passionate, defiant, the spark that lights revolution.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_female',
    gender: 'female',
    age: 'young',
    tags: ['protagonist', 'firebrand', 'revolutionary', 'defiant'],
  },
  {
    slug: 'lead-f-witty',
    name: 'Rosalind Cogg',
    description:
      'Quick-witted female lead — inventor, scholar, thinker who runs three steps ahead of the room.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_female',
    gender: 'female',
    age: 'young',
    tags: ['protagonist', 'witty', 'inventor', 'scholar'],
  },
  {
    slug: 'lead-f-haunted',
    name: 'Mara Greylight',
    description:
      'Haunted, dignified female lead — survivor, refugee, woman carrying the weight of a lost world.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_female',
    gender: 'female',
    age: 'middle_aged',
    tags: ['protagonist', 'haunted', 'survivor', 'dignified'],
  },
  {
    slug: 'lead-f-warm',
    name: 'Hana of the Reed',
    description:
      'Warm, grounded female lead — healer, diplomat, the steady center of a falling-apart world.',
    previewText: PROTAGONIST_PREVIEW,
    category: 'protagonist_female',
    gender: 'female',
    age: 'middle_aged',
    tags: ['protagonist', 'warm', 'healer', 'grounded'],
  },

  // ── Villains ───────────────────────────────────────────────────────
  {
    slug: 'villain-aristocrat',
    name: 'Lord Vex',
    description: 'Cultured aristocratic villain — silk-and-velvet menace, refined cruelty.',
    previewText: VILLAIN_PREVIEW,
    category: 'villain',
    gender: 'male',
    age: 'middle_aged',
    accent: 'british',
    accentStrength: 1.2,
    tags: ['villain', 'aristocrat', 'cultured', 'menacing'],
  },
  {
    slug: 'villain-sociopath',
    name: 'The Smiling Doctor',
    description:
      'Soft-spoken sociopath — friendly tone, dead eyes. Cult leader, manipulator, cold technocrat.',
    previewText: VILLAIN_PREVIEW,
    category: 'villain',
    gender: 'male',
    age: 'middle_aged',
    tags: ['villain', 'sociopath', 'manipulator', 'cult-leader'],
  },
  {
    slug: 'villain-warlord',
    name: 'Khazar the Iron',
    description: 'Booming warlord villain — battle-shouts, blood oaths, charisma of conquest.',
    previewText: VILLAIN_PREVIEW,
    category: 'villain',
    gender: 'male',
    age: 'middle_aged',
    tags: ['villain', 'warlord', 'commander', 'imposing'],
  },
  {
    slug: 'villain-femme-fatale',
    name: 'Lady Nightshade',
    description: 'Femme fatale villain — silk-and-poison cadence, every word a setup.',
    previewText: VILLAIN_PREVIEW,
    category: 'villain',
    gender: 'female',
    age: 'middle_aged',
    tags: ['villain', 'femme-fatale', 'manipulator', 'seductive'],
  },
  {
    slug: 'villain-cold-witch',
    name: 'The White Sister',
    description: 'Cold witch villain — austere, ancient, indifferent to mortal suffering.',
    previewText: VILLAIN_PREVIEW,
    category: 'villain',
    gender: 'female',
    age: 'old',
    tags: ['villain', 'witch', 'ancient', 'indifferent'],
  },

  // ── Children ───────────────────────────────────────────────────────
  {
    slug: 'child-bright-boy',
    name: 'Jem',
    description: 'Bright, curious young boy — wonder, questions, every-second-line a why.',
    previewText: CHILD_PREVIEW,
    category: 'child',
    gender: 'male',
    age: 'young',
    tags: ['child', 'curious', 'apprentice', 'wonder'],
  },
  {
    slug: 'child-fierce-girl',
    name: 'Pip',
    description: 'Fierce young girl — small, loud, refuses to be left behind.',
    previewText: CHILD_PREVIEW,
    category: 'child',
    gender: 'female',
    age: 'young',
    tags: ['child', 'fierce', 'tomboy', 'defiant'],
  },
  {
    slug: 'child-shy',
    name: 'Lin',
    description: 'Shy, soft-spoken child — overheard observations, half-whispered truths.',
    previewText: CHILD_PREVIEW,
    category: 'child',
    gender: 'neutral',
    age: 'young',
    tags: ['child', 'shy', 'observer', 'soft'],
  },
  {
    slug: 'child-orphan-wise',
    name: 'Crow',
    description: 'Streetwise orphan child — older than the years, raised by the city.',
    previewText: CHILD_PREVIEW,
    category: 'child',
    gender: 'neutral',
    age: 'young',
    tags: ['child', 'streetwise', 'orphan', 'survivor'],
  },

  // ── Elderly ────────────────────────────────────────────────────────
  {
    slug: 'elder-sage-m',
    name: 'Master Aldwin',
    description: 'Wise old sage — mentor archetype. Calm, considered, knows more than he says.',
    previewText: ELDERLY_PREVIEW,
    category: 'elderly',
    gender: 'male',
    age: 'old',
    tags: ['elderly', 'sage', 'mentor', 'wise'],
  },
  {
    slug: 'elder-cron-f',
    name: 'Grandmother Wren',
    description:
      'Sharp, dry-witted grandmother — keeps a sword under the bed and an opinion on everything.',
    previewText: ELDERLY_PREVIEW,
    category: 'elderly',
    gender: 'female',
    age: 'old',
    tags: ['elderly', 'matriarch', 'sharp-witted', 'dry'],
  },
  {
    slug: 'elder-grizzled-m',
    name: 'Old Captain Marsh',
    description: 'Grizzled retired captain — gravel in the throat, stories at the tavern.',
    previewText: ELDERLY_PREVIEW,
    category: 'elderly',
    gender: 'male',
    age: 'old',
    tags: ['elderly', 'retired-soldier', 'grizzled', 'storyteller'],
  },
  {
    slug: 'elder-fey-f',
    name: 'The Lavender Witch',
    description:
      'Fey, fluttering elderly woman — kind, distracted, possibly the most powerful person in the room.',
    previewText: ELDERLY_PREVIEW,
    category: 'elderly',
    gender: 'female',
    age: 'old',
    tags: ['elderly', 'fey', 'witch', 'kind'],
  },

  // ── Creatures / Non-Human ──────────────────────────────────────────
  {
    slug: 'creature-dragon',
    name: 'Vorothar the Ancient',
    description: 'Deep, slow dragon-voice — millennia of patience, no human urgency.',
    previewText: CREATURE_PREVIEW,
    category: 'creature',
    gender: 'male',
    age: 'old',
    tags: ['creature', 'dragon', 'ancient', 'imposing'],
  },
  {
    slug: 'creature-fey',
    name: 'Thistleblight',
    description: 'High, mocking fey trickster — rhymes, riddles, smiling threats.',
    previewText: CREATURE_PREVIEW,
    category: 'creature',
    gender: 'neutral',
    age: 'young',
    tags: ['creature', 'fey', 'trickster', 'mocking'],
  },
  {
    slug: 'creature-undead',
    name: 'The Hollow King',
    description: 'Dry, rasping undead king — bone-on-stone cadence, half-remembered command.',
    previewText: CREATURE_PREVIEW,
    category: 'creature',
    gender: 'male',
    age: 'old',
    tags: ['creature', 'undead', 'lich', 'sepulchral'],
  },
  {
    slug: 'creature-beast',
    name: 'Snarl',
    description:
      'Guttural beast-speech — minimal vocabulary, max menace. Trolls, orcs, things in the dark.',
    previewText: CREATURE_PREVIEW,
    category: 'creature',
    gender: 'male',
    age: 'middle_aged',
    tags: ['creature', 'beast', 'orc', 'guttural'],
  },

  // ── Accents (10) ───────────────────────────────────────────────────
  {
    slug: 'accent-british-rp',
    name: 'Henry Mayfair',
    description: 'Crisp British RP — courtly, polished. Period drama, espionage.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'british',
    accentStrength: 1.3,
    tags: ['accent', 'british', 'rp'],
  },
  {
    slug: 'accent-scottish',
    name: 'Iain MacLeod',
    description: 'Scottish highlander accent — warm, weatherbeaten.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'scottish',
    accentStrength: 1.3,
    tags: ['accent', 'scottish', 'highland'],
  },
  {
    slug: 'accent-australian',
    name: 'Sienna Hart',
    description: 'Easy Australian accent — bright, laid-back, surf-and-sun.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'female',
    age: 'young',
    accent: 'australian',
    accentStrength: 1.2,
    tags: ['accent', 'australian'],
  },
  {
    slug: 'accent-indian-eng',
    name: 'Anjali Rao',
    description: 'Indian English — clear, professional, modern subcontinental cadence.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'female',
    age: 'middle_aged',
    accent: 'indian',
    accentStrength: 1.2,
    tags: ['accent', 'indian-english'],
  },
  {
    slug: 'accent-russian',
    name: 'Dmitri Volkov',
    description: 'Cold, deliberate Russian-English — spy thrillers, cold-war pieces.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'russian',
    accentStrength: 1.3,
    tags: ['accent', 'russian'],
  },
  {
    slug: 'accent-japanese-eng',
    name: 'Akira Tanaka',
    description: 'Japanese-English — careful articulation, measured pace.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'japanese',
    accentStrength: 1.2,
    tags: ['accent', 'japanese-english'],
  },
  {
    slug: 'accent-french',
    name: 'Camille Beaumont',
    description: 'Parisian French-English — chic, lightly sardonic.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'female',
    age: 'middle_aged',
    accent: 'french',
    accentStrength: 1.3,
    tags: ['accent', 'french'],
  },
  {
    slug: 'accent-german',
    name: 'Hannes Werner',
    description: 'Crisp German-English — precise, slightly formal.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'german',
    accentStrength: 1.2,
    tags: ['accent', 'german'],
  },
  {
    slug: 'accent-spanish-castilian',
    name: 'Mateo Vidal',
    description: 'Castilian Spanish-English — warm, lyrical.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'spanish',
    accentStrength: 1.2,
    tags: ['accent', 'spanish', 'castilian'],
  },
  {
    slug: 'accent-southern-us',
    name: 'Cole Beauregard',
    description: 'Southern American — Appalachian-flavored drawl, easy charm.',
    previewText: ACCENT_PREVIEW,
    category: 'accent',
    gender: 'male',
    age: 'middle_aged',
    accent: 'american',
    accentStrength: 1.4,
    tags: ['accent', 'southern-us', 'drawl'],
  },

  // ── Specialty (9) ──────────────────────────────────────────────────
  {
    slug: 'spec-newscaster',
    name: 'Anchor Reeves',
    description:
      'TV newscaster baseline — neutral, authoritative. Anchor desks, in-world broadcasts.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'male',
    age: 'middle_aged',
    tags: ['specialty', 'newscaster', 'broadcast'],
  },
  {
    slug: 'spec-whisper-intimate',
    name: 'Whisper',
    description: 'Close-mic intimate whisper — ASMR-style, inner thoughts, prayer scenes.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'female',
    age: 'young',
    tags: ['specialty', 'whisper', 'intimate', 'asmr'],
  },
  {
    slug: 'spec-robotic',
    name: 'Unit 17',
    description: 'Robotic synthesized cadence — mechanical, low affect. Constructs, droids.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'neutral',
    age: 'middle_aged',
    tags: ['specialty', 'robotic', 'synth', 'droid'],
  },
  {
    slug: 'spec-ai-assistant',
    name: 'Aria',
    description: 'Modern AI-assistant voice — calm, helpful, slightly uncanny.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'female',
    age: 'middle_aged',
    tags: ['specialty', 'ai', 'assistant', 'helpful'],
  },
  {
    slug: 'spec-royal-court',
    name: 'Herald of the Crown',
    description: 'Royal court herald — formal proclamations, ceremonial address.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'male',
    age: 'middle_aged',
    accent: 'british',
    accentStrength: 1.4,
    tags: ['specialty', 'herald', 'royal', 'ceremonial'],
  },
  {
    slug: 'spec-street-tough',
    name: 'Mick the Knock',
    description: 'Street tough — gravel cadence, working-class swagger.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'male',
    age: 'middle_aged',
    tags: ['specialty', 'street', 'tough', 'gravel'],
  },
  {
    slug: 'spec-war-cry',
    name: 'Warband Captain',
    description: 'Battle-cry, rally-the-troops energy — high volume, high emotion.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'male',
    age: 'middle_aged',
    tags: ['specialty', 'war-cry', 'battle', 'rally'],
  },
  {
    slug: 'spec-oracle',
    name: 'The Oracle',
    description: 'Oracle/prophecy voice — hushed, multi-layered, dread.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'neutral',
    age: 'old',
    tags: ['specialty', 'oracle', 'prophecy', 'ominous'],
  },
  {
    slug: 'spec-noir-detective',
    name: 'Detective Calloway',
    description: 'Noir detective monologue voice — rain-soaked, weary, wry.',
    previewText: SPECIALTY_PREVIEW,
    category: 'specialty',
    gender: 'male',
    age: 'middle_aged',
    tags: ['specialty', 'noir', 'detective', 'monologue'],
  },
];

export const VOICE_LIBRARY_SEED_BY_SLUG: Record<string, VoiceLibrarySeedEntry> = Object.fromEntries(
  VOICE_LIBRARY_SEED.map((e) => [e.slug, e])
);
