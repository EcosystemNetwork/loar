/**
 * Canon proposal drafter — turns an extraction into voter-ready proposal
 * material for the governance router.
 */

import { randomUUID } from 'node:crypto';
import { db, firebaseAvailable } from '../../lib/firebase';
import type { CanonProposalDraft, ExtractionResult } from './types';
import { buildGovernanceDraftPrompt } from './prompts';
import { governanceDraftOutputSchema } from './schemas';
import { dispatchLlmWithFallback, routeLlmModel } from '../llm-models';

export interface DraftArgs {
  extraction: ExtractionResult;
  universeAddress: string;
  creatorUid: string;
}

async function loadUniverseName(universeAddress: string): Promise<string> {
  if (!firebaseAvailable) return 'Universe';
  const doc = await db.collection('universes').doc(universeAddress).get();
  return String(doc.data()?.name ?? 'Universe');
}

async function loadLoreRules(universeAddress: string): Promise<string[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeAddress)
    .where('kind', '==', 'lore')
    .limit(20)
    .get();
  return snap.docs.map((d) => String(d.data().description ?? ''));
}

async function loadAffectedEntities(universeAddress: string) {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeAddress)
    .limit(40)
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    name: String(d.data().name ?? ''),
    kind: String(d.data().kind ?? ''),
  }));
}

export async function runGovernanceDraft({
  extraction,
  universeAddress,
  creatorUid,
}: DraftArgs): Promise<CanonProposalDraft> {
  if (!firebaseAvailable) {
    throw new Error('Firestore is required for governance drafting');
  }
  const [universeName, loreRules, allEntities] = await Promise.all([
    loadUniverseName(universeAddress),
    loadLoreRules(universeAddress),
    loadAffectedEntities(universeAddress),
  ]);

  const referencedNames = new Set<string>(extraction.entities.map((e) => e.name.toLowerCase()));
  const affectedEntities = allEntities.filter((e) => referencedNames.has(e.name.toLowerCase()));

  const prompt = buildGovernanceDraftPrompt({
    universeName,
    extractionSummary: extraction.summary,
    scenes: extraction.scenes.map((s) => ({
      index: s.index,
      description: s.description,
      startSec: s.startSec,
    })),
    existingLore: loreRules,
    affectedEntities: affectedEntities.map((e) => ({ name: e.name, kind: e.kind })),
  });

  // Text-only governance draft — route to cheapest standard-tier chat model.
  // dispatchLlm handles cost recording + admin kill-switch; fallback chain
  // protects against any one provider's transient failures.
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
  const parsed = governanceDraftOutputSchema.safeParse(JSON.parse(stripped));
  if (!parsed.success) {
    throw new Error(
      `governance-draft schema invalid: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  const data = parsed.data;

  const id = `cpd_${randomUUID()}`;
  const draft: CanonProposalDraft = {
    id,
    extractionId: extraction.id,
    creatorUid,
    universeAddress,
    title: data.title,
    summary: data.summary,
    affectedEntityIds: affectedEntities
      .filter((e) => data.affectedEntityNames.some((n) => n.toLowerCase() === e.name.toLowerCase()))
      .map((e) => e.id),
    affectedLore: data.affectedLore,
    continuityConflicts: data.continuityConflicts,
    proChange: data.proChange,
    conChange: data.conChange,
    evidence: data.evidence,
    createdAt: new Date(),
  };

  await db.collection('canonProposalDrafts').doc(id).set(draft);
  return draft;
}
