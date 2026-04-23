/**
 * Firestore handlers for universe physics (laws / invariants).
 *
 * Collection: `universeLaws/{universeAddress}` — one doc per universe.
 * Doc id is the lowercase universe address so we can fetch without querying.
 */
import { db } from '../../lib/firebase';
import {
  type UniverseLaws,
  type Invariant,
  type ConservationRule,
  type PhysicsViolation,
  emptyLaws,
} from './physics.types';

function lawsCol() {
  return db.collection('universeLaws');
}

export async function getUniverseLaws(universeAddress: string): Promise<UniverseLaws> {
  const id = universeAddress.toLowerCase();
  const doc = await lawsCol().doc(id).get();
  if (!doc.exists) return emptyLaws(id);
  return doc.data() as UniverseLaws;
}

export async function setUniverseLaws(
  universeAddress: string,
  input: {
    invariants?: Invariant[];
    conservationRules?: ConservationRule[];
    forbiddenEvents?: string[];
  },
  updatedBy: string
): Promise<UniverseLaws> {
  const id = universeAddress.toLowerCase();
  const ref = lawsCol().doc(id);
  const existing = (await ref.get()).data() as UniverseLaws | undefined;
  const now = new Date();
  const laws: UniverseLaws = {
    universeAddress: id,
    invariants: input.invariants ?? existing?.invariants ?? [],
    conservationRules: input.conservationRules ?? existing?.conservationRules ?? [],
    forbiddenEvents: (input.forbiddenEvents ?? existing?.forbiddenEvents ?? [])
      .map((e) => e.trim())
      .filter(Boolean),
    updatedAt: now,
    updatedBy: updatedBy.toLowerCase(),
  };
  await ref.set(laws);
  return laws;
}

/**
 * Validate a text blob (e.g. a canon-publish description, a scene plot) against
 * a universe's declared physics. Returns every matched rule — callers decide
 * whether to block (severity === 'must') or warn (severity === 'should').
 *
 * v1 is intentionally shallow: case-insensitive substring + keyword match.
 * It catches "the resurrect" in a universe with "no resurrection"-style
 * invariants, and surfaces forbidden-event phrases verbatim. A future pass
 * can route deeper checks to a VLM / reasoning model.
 */
export async function validateAgainstLaws(
  universeAddress: string,
  content: string
): Promise<{ laws: UniverseLaws; violations: PhysicsViolation[] }> {
  const laws = await getUniverseLaws(universeAddress);
  const violations: PhysicsViolation[] = [];
  const lower = content.toLowerCase();

  // Forbidden events — direct substring match on each phrase.
  for (const phrase of laws.forbiddenEvents) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    const idx = lower.indexOf(trimmed.toLowerCase());
    if (idx >= 0) {
      violations.push({
        kind: 'forbidden_event',
        ref: trimmed,
        name: trimmed,
        severity: 'must',
        excerpt: content.slice(Math.max(0, idx - 40), idx + trimmed.length + 40),
      });
    }
  }

  // Invariants — extract keywords from the rule text and check coverage.
  // Crude but useful: the invariant "Dead characters stay dead" keywordizes
  // to ["dead", "characters", "stay"]; a scene containing "dead character"
  // and "revives" would match "dead" (hit) but we also flag any rule that
  // shares a significant keyword with the content. Downstream review is
  // expected — these are suggestions, not hard refusals.
  for (const inv of laws.invariants) {
    const keywords = inv.rule
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5);
    const hit = keywords.some((kw) => lower.includes(kw));
    if (hit) {
      // Grab a short excerpt around the first hit.
      const firstKw = keywords.find((kw) => lower.includes(kw)) ?? '';
      const idx = lower.indexOf(firstKw);
      const excerpt =
        idx >= 0 ? content.slice(Math.max(0, idx - 40), idx + firstKw.length + 40) : '';
      violations.push({
        kind: 'invariant',
        ref: inv.id,
        name: inv.name,
        severity: inv.severity,
        excerpt,
      });
    }
  }

  return { laws, violations };
}
