/**
 * Curation — positive taste layer on top of the platform.
 *
 * Moderation (negative filter) says what is *not allowed*. Curation says what
 * is *worth looking at*. Any authenticated wallet can endorse an entity, a
 * universe, or a content item with a weight 1–5 and an optional note. Aggregate
 * weight becomes a public taste signal; the leaderboard surfaces the top of
 * each target type.
 */

export type CurationTargetType = 'entity' | 'universe' | 'content';

export const CURATION_TARGET_TYPES: CurationTargetType[] = ['entity', 'universe', 'content'];

export interface Endorsement {
  /** Deterministic: `${curator}:${targetType}:${targetId}`. */
  id: string;
  curator: string; // lowercase wallet
  targetType: CurationTargetType;
  targetId: string;
  /** 1–5. Higher = stronger endorsement. */
  weight: number;
  /** Optional why-note — surfaced on the leaderboard. */
  note: string;
  /** Optional universe scoping for leaderboard filtering. */
  universeAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeaderboardEntry {
  targetType: CurationTargetType;
  targetId: string;
  /** Sum of weights across all endorsements for this target. */
  score: number;
  /** Distinct endorser count. */
  endorsers: number;
  /** Most recent endorsement timestamp — used for tiebreak / recency display. */
  lastEndorsedAt: Date;
}
