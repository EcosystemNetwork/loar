/**
 * Canon consistency checker.
 *
 * Given an extraction + a universe, loads the universe bible + entities +
 * recent beats and asks Gemini to flag conflicts. Result is persisted to
 * `canonConflicts/{id}` and consumed by the publish flow.
 */

import { randomUUID } from 'node:crypto';
import { db, firebaseAvailable } from '../../lib/firebase';
import type { CanonCheckResult, CanonConflict, ExtractionResult } from './types';
import { buildCanonCheckPrompt } from './prompts';
import { canonCheckOutputSchema } from './schemas';
import { dispatchLlmWithFallback, routeLlmModel } from '../llm-models';

export interface CanonCheckArgs {
  extraction: ExtractionResult;
  universeAddress: string;
  targetId: string;
}

async function loadUniverseBible(universeAddress: string): Promise<string> {
  if (!firebaseAvailable) return '';
  const doc = await db.collection('universes').doc(universeAddress).get();
  if (!doc.exists) return '';
  const d = doc.data() ?? {};
  return [d.name, d.description, d.synopsis, d.loreRules, d.worldRules]
    .filter(Boolean)
    .map(String)
    .join('\n\n');
}

async function loadCanonEntities(universeAddress: string) {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeAddress)
    .limit(80)
    .get();
  return snap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      name: String(e.name ?? ''),
      kind: String(e.kind ?? ''),
      description: String(e.description ?? ''),
    };
  });
}

async function loadRecentBeats(universeAddress: string): Promise<string[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('content')
    .where('universeId', '==', universeAddress)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  return snap.docs.map((d) => String(d.data().description ?? '')).filter((s) => s.length > 0);
}

export async function runCanonCheck({
  extraction,
  universeAddress,
  targetId,
}: CanonCheckArgs): Promise<CanonCheckResult> {
  if (!firebaseAvailable) {
    throw new Error('Firestore is required for canon check');
  }
  const [bible, canonEntities, beats] = await Promise.all([
    loadUniverseBible(universeAddress),
    loadCanonEntities(universeAddress),
    loadRecentBeats(universeAddress),
  ]);

  const prompt = buildCanonCheckPrompt({
    extractionSummary: extraction.summary,
    scenes: extraction.scenes.map((s) => ({ index: s.index, description: s.description })),
    entities: canonEntities,
    universeBible: bible || '(no universe bible provided)',
    recentBeats: beats,
  });

  // Text-only consistency check — route to cheapest standard-tier chat model.
  // Fallback chain shields against any one provider's rate-limit storm.
  const decision = routeLlmModel({
    requires: { chat: true },
    qualityTarget: 'standard',
    costBudget: 'low',
  });
  const r = await dispatchLlmWithFallback({
    primaryModelId: decision.chosenModelId,
    fallbackModelIds: decision.fallbackModelIds.slice(0, 3),
    messages: [{ role: 'user', content: prompt }],
    jsonMode: true,
    maxTokens: 4000,
  });
  const stripped = r.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const parsed = canonCheckOutputSchema.safeParse(JSON.parse(stripped));
  if (!parsed.success) {
    throw new Error(
      `canon-check schema invalid: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  const data = parsed.data;

  // Resolve related entity NAMES back to IDs using the loaded map.
  const byName = new Map<string, string>();
  for (const e of canonEntities) byName.set(e.name.toLowerCase(), e.id);

  const conflicts: CanonConflict[] = data.conflicts.map((c) => ({
    severity: c.severity,
    rule: c.rule,
    message: c.message,
    evidence: c.evidence,
    sceneIndex: c.sceneIndex,
    relatedEntityIds: c.relatedEntityNames
      .map((n) => byName.get(n.toLowerCase()))
      .filter((v): v is string => Boolean(v)),
  }));

  const passed = !conflicts.some((c) => c.severity === 'block');
  const id = `canc_${randomUUID()}`;
  const result: CanonCheckResult = {
    id,
    targetId,
    universeAddress,
    conflicts,
    passed,
    checkedAt: new Date(),
  };
  await db.collection('canonConflicts').doc(id).set(result);
  return result;
}
