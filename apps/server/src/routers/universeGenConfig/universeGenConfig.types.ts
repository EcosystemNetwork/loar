/**
 * Universe Generation Config — Type definitions and Zod schemas.
 * Defines the parameters universe creators set for AI content generation.
 */
import { z } from 'zod';

export const loreRuleSchema = z.object({
  rule: z.string().min(1).max(500),
  type: z.enum(['DO', 'DONT']),
});

export const accessTypeEnum = z.enum(['PUBLIC', 'HOLDERS', 'WHITELISTED']);

export const universeGenConfigSchema = z.object({
  universeAddress: z.string(),

  // Model constraints
  approvedModelIds: z.array(z.string()).default([]),
  blockedModelIds: z.array(z.string()).default([]),

  // Style constraints
  styleGuide: z.string().max(5000).default(''),
  referenceImageUrls: z.array(z.string().url()).max(10).default([]),
  negativePrompts: z.array(z.string()).default([]),
  defaultPromptPrefix: z.string().max(500).default(''),
  defaultPromptSuffix: z.string().max(500).default(''),

  // Character & lore refs
  requiredEntityIds: z.array(z.string()).default([]),
  loreEntityIds: z.array(z.string()).default([]),
  loreRules: z.array(loreRuleSchema).max(50).default([]),

  // Credit pricing
  creditMultiplier: z.number().min(0.5).max(5.0).default(1.0),
  minCreditsPerGen: z.number().int().min(0).default(0),

  // Access control
  accessType: accessTypeEnum.default('PUBLIC'),
  whitelistedAddresses: z.array(z.string()).default([]),
  requiredTokenBalance: z.number().min(0).default(0),

  // Revenue split (links to Phase 1)
  universeCreatorSplitBps: z.number().int().min(0).max(4000).default(2000),
});

export type UniverseGenConfig = z.infer<typeof universeGenConfigSchema>;
export type LoreRule = z.infer<typeof loreRuleSchema>;
export type AccessType = z.infer<typeof accessTypeEnum>;
