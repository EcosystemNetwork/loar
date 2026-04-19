/**
 * Post-extraction entity auto-linking.
 *
 * The extractor proposes entities the VLM sees in the asset. We then ask a
 * cheap Gemini Flash pass to match each proposal against the universe's
 * existing entities — by name + semantic description — so the reviewer
 * doesn't have to manually dedupe "Aria Voss" vs "aria_voss" vs "Commander
 * Voss".
 *
 * Returns a map proposalId -> { entityId, confidence }. Callers decide the
 * threshold (recommended: >= 0.8 auto-link, 0.6–0.8 suggest, <0.6 treat as
 * new). Non-blocking — on any error we return an empty map so the
 * extraction pipeline still delivers proposals.
 */

import { z } from 'zod';
import { db, firebaseAvailable } from '../../lib/firebase';
import { callJson } from './gemini-client';
import type { ExtractedEntityProposal } from './types';

export interface EntityLinkMatch {
  entityId: string;
  confidence: number;
}

export type EntityLinkMap = Record<string, EntityLinkMatch>;

const linkerOutputSchema = z.object({
  links: z
    .array(
      z.object({
        proposalId: z.string().min(1).max(200),
        entityId: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1),
      })
    )
    .default([]),
});

interface CanonEntity {
  id: string;
  name: string;
  kind: string;
  description: string;
}

async function loadCanonEntities(universeAddress: string): Promise<CanonEntity[]> {
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeAddress)
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      name: String(e.name ?? ''),
      kind: String(e.kind ?? ''),
      description: String(e.description ?? '').slice(0, 500),
    };
  });
}

function buildPrompt(
  proposals: Array<Pick<ExtractedEntityProposal, 'proposalId' | 'kind' | 'name' | 'description'>>,
  canon: CanonEntity[]
): string {
  const proposalBlock = proposals
    .map(
      (p) =>
        `- id=${p.proposalId} kind=${p.kind} name="${p.name}" desc="${p.description.slice(0, 240)}"`
    )
    .join('\n');
  const canonBlock = canon
    .map((c) => `- id=${c.id} kind=${c.kind} name="${c.name}" desc="${c.description}"`)
    .join('\n');
  return `You are an entity-deduplication linker for a worldbuilding platform.
Match each PROPOSAL to a CANON entity ONLY if you are confident they refer to the same person/place/thing/etc.

PROPOSALS (from a newly analyzed asset):
${proposalBlock}

EXISTING CANON ENTITIES IN THIS UNIVERSE:
${canonBlock}

RULES:
- Require matching kind (a "person" never links to a "place").
- Require strong semantic evidence: same name, alias, or clearly the same described entity.
- Prefer NOT linking over a bad link. Unknowns are fine — we'll create new entities.
- Confidence is 0.0–1.0; only emit matches with confidence >= 0.6.
- Never invent entity ids. Only reuse ids from the CANON list above.

Output JSON with this exact shape:
{
  "links": [
    { "proposalId": "prop_...", "entityId": "<id from canon>", "confidence": 0.0 }
  ]
}

Output JSON only.`;
}

export async function linkProposalsToCanon(
  proposals: Array<Pick<ExtractedEntityProposal, 'proposalId' | 'kind' | 'name' | 'description'>>,
  universeAddress: string | null | undefined
): Promise<EntityLinkMap> {
  if (!universeAddress || !firebaseAvailable || proposals.length === 0) return {};
  try {
    const canon = await loadCanonEntities(universeAddress);
    if (canon.length === 0) return {};
    const { data } = await callJson({
      model: 'gemini-2.5-flash',
      prompt: buildPrompt(proposals, canon),
      schema: linkerOutputSchema,
      label: 'entity_link',
    });
    const canonIds = new Set(canon.map((c) => c.id));
    const proposalIds = new Set(proposals.map((p) => p.proposalId));
    const out: EntityLinkMap = {};
    for (const link of data.links) {
      if (link.confidence < 0.6) continue;
      if (!canonIds.has(link.entityId)) continue;
      if (!proposalIds.has(link.proposalId)) continue;
      const prior = out[link.proposalId];
      if (!prior || link.confidence > prior.confidence) {
        out[link.proposalId] = { entityId: link.entityId, confidence: link.confidence };
      }
    }
    return out;
  } catch (err) {
    console.warn('[entity-linker] skipped:', (err as Error).message);
    return {};
  }
}
