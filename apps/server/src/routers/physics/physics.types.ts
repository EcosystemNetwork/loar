/**
 * Universe Physics — first-class invariants, conservation rules, and
 * forbidden events that a universe declares about itself.
 *
 * The core idea: every universe has an implicit ruleset ("magic requires
 * a cost", "no time travel", "characters can't revive without cost") that
 * lives only in the creator's head today. When those rules are explicit,
 * the canon-publish path can detect contradictions before they land.
 *
 * This module stores the rules and provides a validator. Enforcement at
 * publish-time is opt-in — callers can hit `physics.validate` before
 * mutating state. A future pass can wire it into canon mutations.
 */

export type InvariantSeverity = 'must' | 'should';

export interface Invariant {
  /** Client-generated stable id (uuid or timestamp-based). */
  id: string;
  /** Short human name — "Death is permanent", "No time travel". */
  name: string;
  /** Natural-language rule statement. Shown to creators + used by validator. */
  rule: string;
  /**
   * `must` — blocking. Canon publish should refuse content that violates.
   * `should` — advisory. Warn, don't block.
   */
  severity: InvariantSeverity;
}

export interface ConservationRule {
  id: string;
  name: string;
  description: string;
}

export interface UniverseLaws {
  /** Lowercase Ethereum address of the universe (also doc id). */
  universeAddress: string;
  invariants: Invariant[];
  conservationRules: ConservationRule[];
  /**
   * Free-form phrases that canonically do not happen. Keyword match —
   * cheap filter before the LLM gets involved.
   */
  forbiddenEvents: string[];
  updatedAt: Date;
  updatedBy: string;
}

export interface PhysicsViolation {
  kind: 'invariant' | 'forbidden_event';
  /** id of the invariant, or the forbidden phrase itself */
  ref: string;
  name: string;
  severity: InvariantSeverity;
  excerpt: string;
}

export function emptyLaws(universeAddress: string): UniverseLaws {
  return {
    universeAddress: universeAddress.toLowerCase(),
    invariants: [],
    conservationRules: [],
    forbiddenEvents: [],
    updatedAt: new Date(0),
    updatedBy: '',
  };
}
