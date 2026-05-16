/**
 * Voice Studio — shared types mirroring server zod schemas.
 *
 * Source of truth for the wire shapes:
 *   apps/server/src/routers/generation/voiceLibrary.routes.ts
 *   apps/server/src/routers/generation/dubbing.routes.ts
 *   apps/server/src/routers/generation/multilingualDub.routes.ts
 *   apps/server/src/data/voice-library-seed.ts
 */

export type VoiceCategory =
  | 'narrator'
  | 'protagonist_male'
  | 'protagonist_female'
  | 'villain'
  | 'child'
  | 'elderly'
  | 'creature'
  | 'accent'
  | 'specialty';

export type Gender = 'male' | 'female' | 'neutral';
export type AgeBand = 'young' | 'middle_aged' | 'old';

export interface LibraryVoice {
  id: string;
  slug?: string;
  voiceId: string;
  name: string;
  description: string;
  category: VoiceCategory;
  tags: string[];
  previewUrl?: string;
  gender: Gender;
  age: AgeBand;
  accent?: string;
}

/**
 * Rights lane for a user-owned voice — gates what the Voice Mixer (and any
 * future commercial flows) can use as a source.
 *   owned    — user cloned or designed it; full creative & commercial rights
 *   licensed — platform-licensed catalog voice the user saved from Library
 */
export type VoiceRightsClass = 'owned' | 'licensed';

export interface MyVoice {
  id: string;
  userId: string;
  source: 'library' | 'clone' | 'design';
  rightsClass: VoiceRightsClass;
  voiceId: string;
  name: string;
  description?: string;
  category?: VoiceCategory;
  tags?: string[];
  previewUrl?: string;
  libraryEntryId?: string;
  sourceSampleUrls?: string[];
  designGenerationId?: string;
  createdAt: Date | string;
}

export type ElevenLabsVoiceModelId =
  | 'eleven_flash_v2_5'
  | 'eleven_multilingual_v2'
  | 'eleven_turbo_v2'
  | 'eleven_v3';

export interface ScriptLine {
  id: string;
  characterId?: string;
  characterName?: string;
  voiceId: string;
  text: string;
  startSec?: number;
  endSec?: number;
  model?: ElevenLabsVoiceModelId;
  stability?: number;
  style?: number;
  audioUrl?: string;
  audioDurationSec?: number;
  wordTimings?: Array<{ word: string; start: number; end: number }>;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  error?: string;
}

export interface DubbingProject {
  id: string;
  userId: string;
  episodeId?: string | null;
  universeId?: string | null;
  title: string;
  baseVideoUrl?: string | null;
  castMap: Record<string, string>;
  scriptLines: ScriptLine[];
  status: 'draft' | 'generating' | 'ready' | 'compositing' | 'complete' | 'failed';
  mergedAudioUrl?: string | null;
  finalVideoUrl?: string | null;
  compositeMode?: 'mux' | 'lipsync';
  failureReason?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface MultilingualDubJob {
  id: string;
  userId: string;
  episodeId?: string | null;
  universeId?: string | null;
  sourceVideoUrl: string;
  sourceLang?: string | null;
  targetLang: string;
  elevenLabsDubbingId: string;
  durationSec: number;
  status: 'dubbing' | 'complete' | 'failed';
  creditsCharged: number;
  outputVideoUrl?: string | null;
  outputAudioUrl?: string | null;
  publishedToEpisode: boolean;
  failureReason?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const VOICE_CATEGORY_LABELS: Record<VoiceCategory, string> = {
  narrator: 'Narrators',
  protagonist_male: 'Male Leads',
  protagonist_female: 'Female Leads',
  villain: 'Villains',
  child: 'Children',
  elderly: 'Elders',
  creature: 'Creatures',
  accent: 'Accents',
  specialty: 'Specialty',
};

export const LANG_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  tr: 'Turkish',
  ru: 'Russian',
  nl: 'Dutch',
  cs: 'Czech',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  id: 'Indonesian',
  ms: 'Malay',
  ro: 'Romanian',
  sk: 'Slovak',
  el: 'Greek',
  he: 'Hebrew',
  th: 'Thai',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  bg: 'Bulgarian',
  hr: 'Croatian',
};
