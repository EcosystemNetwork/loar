/**
 * Shared types for the VLM subsystem.
 * Firestore-facing shapes live here so server + worker agree.
 */

import type { EntityKind, EntityRelationType } from '../../routers/entities/entities.types';

export type VlmModel = 'gemini-2.5-pro' | 'gemini-2.5-flash';

export type VlmJobKind =
  | 'extract'
  | 'canon_check'
  | 'moderation'
  | 'recap'
  | 'search_index'
  | 'governance_draft'
  | 'copilot_score';

export type VlmJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface VlmJob {
  jobId: string;
  kind: VlmJobKind;
  status: VlmJobStatus;
  creatorUid: string;
  input: VlmJobInput;
  outputRef?: string;
  tokensUsed?: number;
  costUsd?: number;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface VlmJobInput {
  assetType: 'video' | 'image' | 'audio';
  mediaUrl: string;
  mimeType?: string;
  contentId?: string;
  generationId?: string;
  universeAddress?: string | null;
  /** Free-form options consumed per-kind. */
  options?: Record<string, unknown>;
}

export type RiskKind =
  | 'nsfw'
  | 'violence'
  | 'copyright_logo'
  | 'copyright_character'
  | 'watermark'
  | 'ocr_credits'
  | 'franchise_lookalike';

export interface ExtractedRisk {
  kind: RiskKind;
  score: number;
  evidence: string;
  sceneIndex?: number;
}

export interface ExtractedScene {
  index: number;
  startSec: number;
  endSec: number;
  shotType?: string;
  description: string;
  location?: string;
  mood?: string;
  subjects: string[];
  actions: string[];
}

export interface ExtractedEntityProposal {
  proposalId: string;
  kind: EntityKind;
  name: string;
  description: string;
  firstSeenAtSec?: number;
  evidenceSceneIndexes: number[];
  metadata?: Record<string, string>;
  /**
   * Populated by the post-extraction entity-linker: id of an existing
   * canon entity this proposal resolves to, plus the linker's confidence
   * (0.6–1.0). Absent when the proposal is judged to be a new entity.
   */
  linkedEntityId?: string;
  linkedConfidence?: number;
}

export interface ExtractedRelationship {
  sourceName: string;
  targetName: string;
  type: EntityRelationType;
  evidenceSceneIndex: number;
  description?: string;
}

export interface ExtractedTimelineEvent {
  name: string;
  description: string;
  atSec: number;
  confidence: number;
}

export interface ExtractedChapter {
  title: string;
  startSec: number;
  summary: string;
}

export interface ExtractionResult {
  id: string;
  sourceMediaUrl: string;
  contentId?: string;
  creatorUid: string;
  universeAddress?: string | null;
  model: VlmModel;
  summary: string;
  durationSec?: number;
  scenes: ExtractedScene[];
  entities: ExtractedEntityProposal[];
  relationships: ExtractedRelationship[];
  timelineEvents: ExtractedTimelineEvent[];
  chapterMarkers: ExtractedChapter[];
  risks: ExtractedRisk[];
  canonDelta?: {
    newEntities: string[];
    changedRelationships: string[];
    newTimelineEvents: string[];
    conflicts: string[];
  };
  tokensUsed: number;
  costUsd: number;
  createdAt: Date;
}

export type ConflictSeverity = 'info' | 'warn' | 'block';

export type ConflictRule =
  | 'costume_drift'
  | 'timeline_impossible'
  | 'character_out_of_lore'
  | 'location_layout'
  | 'faction_insignia'
  | 'duplicate_beat'
  | 'rights_mismatch';

export interface CanonConflict {
  severity: ConflictSeverity;
  rule: ConflictRule;
  message: string;
  evidence: string;
  sceneIndex?: number;
  relatedEntityIds: string[];
}

export interface CanonCheckResult {
  id: string;
  targetId: string;
  universeAddress: string;
  conflicts: CanonConflict[];
  passed: boolean;
  checkedAt: Date;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface VlmRiskScoreDoc {
  contentId: string;
  overallRisk: RiskLevel;
  autoAction: 'none' | 'flag' | 'hide_pending_review';
  scores: ExtractedRisk[];
  extractionId: string;
  evaluatedAt: Date;
}

export interface SceneIndexDoc {
  id: string;
  contentId: string;
  sceneIndex: number;
  caption: string;
  tags: string[];
  objects: string[];
  faces: string[];
  mood: string;
  startSec: number;
  endSec: number;
  embedding?: number[];
}

export interface CanonProposalDraft {
  id: string;
  extractionId: string;
  creatorUid: string;
  universeAddress: string;
  title: string;
  summary: string;
  affectedEntityIds: string[];
  affectedLore: string[];
  continuityConflicts: string[];
  proChange: string;
  conChange: string;
  evidence: Array<{ sceneIndex: number; timestamp: string; note: string }>;
  createdAt: Date;
}

export interface CostSummary {
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: VlmModel;
}
