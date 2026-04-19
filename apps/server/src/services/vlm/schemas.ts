/**
 * Zod schemas for validating VLM JSON outputs.
 * VLMs hallucinate shapes — every parse goes through a schema before persistence.
 */

import { z } from 'zod';
import { ENTITY_KINDS, ENTITY_RELATION_TYPES } from '../../routers/entities/entities.types';

const entityKindEnum = z.enum(ENTITY_KINDS as unknown as [string, ...string[]]);
const relationTypeEnum = z.enum(ENTITY_RELATION_TYPES as unknown as [string, ...string[]]);

export const riskKindEnum = z.enum([
  'nsfw',
  'violence',
  'copyright_logo',
  'copyright_character',
  'watermark',
  'ocr_credits',
  'franchise_lookalike',
]);

export const extractedSceneSchema = z.object({
  index: z.number().int().nonnegative(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  shotType: z.string().max(80).optional(),
  description: z.string().min(1).max(2000),
  location: z.string().max(200).optional(),
  mood: z.string().max(200).optional(),
  subjects: z.array(z.string().max(200)).max(20).default([]),
  actions: z.array(z.string().max(400)).max(20).default([]),
});

export const extractedEntitySchema = z.object({
  kind: entityKindEnum,
  name: z.string().min(1).max(200),
  description: z.string().max(3000).default(''),
  firstSeenAtSec: z.number().nonnegative().optional(),
  evidenceSceneIndexes: z.array(z.number().int().nonnegative()).default([]),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const extractedRelationshipSchema = z.object({
  sourceName: z.string().min(1).max(200),
  targetName: z.string().min(1).max(200),
  type: relationTypeEnum,
  evidenceSceneIndex: z.number().int().nonnegative(),
  description: z.string().max(1000).optional(),
});

export const extractedTimelineEventSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1500).default(''),
  atSec: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});

export const extractedChapterSchema = z.object({
  title: z.string().min(1).max(200),
  startSec: z.number().nonnegative(),
  summary: z.string().max(1000).default(''),
});

export const extractedRiskSchema = z.object({
  kind: riskKindEnum,
  score: z.number().min(0).max(1),
  evidence: z.string().max(1000),
  sceneIndex: z.number().int().nonnegative().optional(),
});

export const extractionOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  durationSec: z.number().nonnegative().optional(),
  scenes: z.array(extractedSceneSchema).default([]),
  entities: z.array(extractedEntitySchema).default([]),
  relationships: z.array(extractedRelationshipSchema).default([]),
  timelineEvents: z.array(extractedTimelineEventSchema).default([]),
  chapterMarkers: z.array(extractedChapterSchema).default([]),
  risks: z.array(extractedRiskSchema).default([]),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

export const canonConflictSchema = z.object({
  severity: z.enum(['info', 'warn', 'block']),
  rule: z.enum([
    'costume_drift',
    'timeline_impossible',
    'character_out_of_lore',
    'location_layout',
    'faction_insignia',
    'duplicate_beat',
    'rights_mismatch',
  ]),
  message: z.string().min(1).max(1000),
  evidence: z.string().max(1000),
  sceneIndex: z.number().int().nonnegative().optional(),
  relatedEntityNames: z.array(z.string().max(200)).default([]),
});

export const canonCheckOutputSchema = z.object({
  conflicts: z.array(canonConflictSchema).default([]),
});

export type CanonCheckOutput = z.infer<typeof canonCheckOutputSchema>;

export const sceneIndexOutputSchema = z.object({
  scenes: z
    .array(
      z.object({
        sceneIndex: z.number().int().nonnegative(),
        caption: z.string().min(1).max(500),
        tags: z.array(z.string().max(60)).max(40).default([]),
        objects: z.array(z.string().max(80)).max(40).default([]),
        faces: z.array(z.string().max(120)).max(20).default([]),
        mood: z.string().max(120).default(''),
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
      })
    )
    .default([]),
});

export type SceneIndexOutput = z.infer<typeof sceneIndexOutputSchema>;

export const recapOutputSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        startSec: z.number().nonnegative(),
        summary: z.string().max(500),
      })
    )
    .default([]),
  trailerBeats: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
        reason: z.string().max(400),
      })
    )
    .default([]),
  recapText: z.string().max(4000).default(''),
  previouslyOn: z.string().max(2000).default(''),
  socialCuts: z
    .array(
      z.object({
        platform: z.enum(['tiktok', 'reels', 'shorts', 'twitter']),
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
        caption: z.string().max(400),
      })
    )
    .default([]),
  title: z.string().max(200).default(''),
  seoDescription: z.string().max(1000).default(''),
  thumbnailSuggestions: z
    .array(
      z.object({
        startSec: z.number().nonnegative(),
        reason: z.string().max(300),
      })
    )
    .default([]),
  /**
   * Derived at parse-time from the best entry in thumbnailSuggestions (the
   * prompt instructs Gemini to order them best-first). Populated by runRecap
   * so a single content card can `thumbnailUrl = extractFrame(mediaUrl, selectedThumbnailSec)`.
   */
  selectedThumbnailSec: z.number().nonnegative().optional(),
});

export type RecapOutput = z.infer<typeof recapOutputSchema>;

export const governanceDraftOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(3000),
  affectedEntityNames: z.array(z.string().max(200)).default([]),
  affectedLore: z.array(z.string().max(200)).default([]),
  continuityConflicts: z.array(z.string().max(600)).default([]),
  proChange: z.string().max(2000).default(''),
  conChange: z.string().max(2000).default(''),
  evidence: z
    .array(
      z.object({
        sceneIndex: z.number().int().nonnegative(),
        timestamp: z.string().max(20),
        note: z.string().max(400),
      })
    )
    .default([]),
});

export type GovernanceDraftOutput = z.infer<typeof governanceDraftOutputSchema>;

export const copilotScoreOutputSchema = z.object({
  matchesIntent: z.number().min(0).max(1),
  identityPreserved: z.number().min(0).max(1),
  compositionMatch: z.number().min(0).max(1),
  styleMatch: z.number().min(0).max(1),
  issues: z.array(z.string().max(500)).default([]),
  suggestions: z.array(z.string().max(500)).default([]),
  rerollPrompt: z.string().max(2000).default(''),
});

export type CopilotScoreOutput = z.infer<typeof copilotScoreOutputSchema>;

export const styleBibleOutputSchema = z.object({
  basePreset: z.string().max(80).default(''),
  stylePrompt: z.string().max(1500).default(''),
  negativePrompt: z.string().max(1000).default(''),
  styleKeywords: z.array(z.string().max(60)).max(30).default([]),
  palette: z.array(z.string().max(40)).max(12).default([]),
  cameraLanguage: z.string().max(600).default(''),
  lightingLanguage: z.string().max(600).default(''),
  defaultStrength: z.number().min(0).max(1).default(0.7),
});

export type StyleBibleOutput = z.infer<typeof styleBibleOutputSchema>;
