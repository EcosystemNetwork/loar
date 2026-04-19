/**
 * Video/image → structured canon extraction.
 *
 * Given a media URL + optional universe context, runs Gemini and returns a
 * validated ExtractionResult. The caller (vlm.worker) persists the result
 * to `vlmExtractions/` and spawns `entityProposals/`, `sceneIndex/`,
 * and `vlmRiskScores/` rows.
 */

import { randomUUID, createHash } from 'node:crypto';
import { db, firebaseAvailable } from '../../lib/firebase';
import type {
  ExtractionResult,
  ExtractedEntityProposal,
  ExtractedRelationship,
  VlmJobInput,
  VlmModel,
} from './types';
import { buildExtractionPrompt, PROMPT_VERSION } from './prompts';
import { extractionOutputSchema, type ExtractionOutput } from './schemas';
import { callJson, mediaPartFromUrl } from './gemini-client';
import { linkProposalsToCanon } from './entity-linker';

export interface ExtractorArgs {
  input: VlmJobInput;
  creatorUid: string;
}

export interface ExtractorResultBundle {
  extraction: ExtractionResult;
  proposals: Array<ExtractedEntityProposal & { _rawKind: string }>;
  sceneIndexRows: Array<{
    sceneIndex: number;
    caption: string;
    tags: string[];
    objects: string[];
    faces: string[];
    mood: string;
    startSec: number;
    endSec: number;
  }>;
}

function cacheKey(mediaUrl: string, model: VlmModel): string {
  return createHash('sha256').update(`${mediaUrl}|${model}|${PROMPT_VERSION}`).digest('hex');
}

async function loadPriorEntities(universeAddress?: string | null) {
  if (!firebaseAvailable || !universeAddress) return [];
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeAddress)
    .limit(60)
    .get();
  return snap.docs.map((d) => {
    const e = d.data();
    return {
      name: String(e.name ?? ''),
      kind: String(e.kind ?? ''),
      description: String(e.description ?? ''),
    };
  });
}

async function loadUniverseNotes(universeAddress?: string | null): Promise<string | undefined> {
  if (!firebaseAvailable || !universeAddress) return undefined;
  const doc = await db.collection('universes').doc(universeAddress).get();
  if (!doc.exists) return undefined;
  const data = doc.data() ?? {};
  return [data.name, data.description, data.synopsis].filter(Boolean).join('\n');
}

export async function runExtraction({
  input,
  creatorUid,
}: ExtractorArgs): Promise<ExtractorResultBundle> {
  if (input.assetType === 'audio') {
    throw new Error('Audio-only extraction is not implemented; convert via transcription first.');
  }
  if (!firebaseAvailable) {
    throw new Error('Firestore is required for VLM extraction');
  }

  // Cache lookup — VLM output is deterministic for (mediaUrl, model, promptVersion).
  // Skip cache when explicit force=true in options.
  const force = Boolean((input.options as any)?.force);
  const model: VlmModel = (input.options as any)?.model ?? 'gemini-2.5-pro';
  const key = cacheKey(input.mediaUrl, model);
  if (!force) {
    const cached = await db
      .collection('vlmExtractions')
      .where('cacheKey', '==', key)
      .limit(1)
      .get();
    if (!cached.empty) {
      const doc = cached.docs[0];
      const data = doc.data() as ExtractionResult & {
        _proposals?: ExtractorResultBundle['proposals'];
        _sceneIndex?: ExtractorResultBundle['sceneIndexRows'];
      };
      return {
        extraction: { ...data, id: doc.id, createdAt: data.createdAt ?? new Date() },
        proposals: data._proposals ?? [],
        sceneIndexRows: data._sceneIndex ?? [],
      };
    }
  }

  const priorEntities = await loadPriorEntities(input.universeAddress);
  const universeDoc = await loadUniverseNotes(input.universeAddress);

  const media = await mediaPartFromUrl(input.mediaUrl, input.assetType, input.mimeType);
  const prompt = buildExtractionPrompt({
    universeName: universeDoc,
    priorEntities,
    userNotes: (input.options as any)?.userNotes,
  });

  const { data: output, cost } = await callJson<ExtractionOutput>({
    model,
    prompt,
    media: [media],
    schema: extractionOutputSchema,
    label: 'extraction',
  });

  const now = new Date();
  const extractionId = `vlmex_${randomUUID()}`;

  const proposals = output.entities.map<ExtractedEntityProposal & { _rawKind: string }>((e) => ({
    proposalId: `prop_${randomUUID()}`,
    kind: e.kind as ExtractedEntityProposal['kind'],
    name: e.name,
    description: e.description,
    firstSeenAtSec: e.firstSeenAtSec,
    evidenceSceneIndexes: e.evidenceSceneIndexes,
    metadata: e.metadata,
    _rawKind: e.kind,
  }));

  // Auto-link proposals to existing canon entities so downstream reviewers
  // don't have to manually dedupe. Env-gated; on failure returns empty map
  // and proposals pass through unlinked.
  if (process.env.VLM_ENTITY_AUTOLINK === 'true' && input.universeAddress && proposals.length) {
    const linkMap = await linkProposalsToCanon(
      proposals.map((p) => ({
        proposalId: p.proposalId,
        kind: p.kind,
        name: p.name,
        description: p.description,
      })),
      input.universeAddress
    );
    for (const p of proposals) {
      const m = linkMap[p.proposalId];
      if (m) {
        p.linkedEntityId = m.entityId;
        p.linkedConfidence = m.confidence;
      }
    }
  }

  // Build a lightweight scene index as a side-effect — good enough for text
  // search even without a dedicated index pass. The search worker later
  // re-runs a richer pass in a separate `search_index` job if enabled.
  const sceneIndexRows = output.scenes.map((s) => ({
    sceneIndex: s.index,
    caption: s.description,
    tags: Array.from(
      new Set(
        [
          ...s.actions.map((a) => a.toLowerCase()),
          ...(s.mood ? [s.mood.toLowerCase()] : []),
          ...(s.location ? [s.location.toLowerCase()] : []),
          ...(s.shotType ? [s.shotType.toLowerCase()] : []),
        ].flatMap((t) =>
          t
            .split(/[,;]+/)
            .map((x) => x.trim())
            .filter(Boolean)
        )
      )
    ).slice(0, 30),
    objects: s.subjects,
    faces: [],
    mood: s.mood ?? '',
    startSec: s.startSec,
    endSec: s.endSec,
  }));

  const extraction: ExtractionResult = {
    id: extractionId,
    sourceMediaUrl: input.mediaUrl,
    contentId: input.contentId,
    creatorUid,
    universeAddress: input.universeAddress ?? null,
    model,
    summary: output.summary,
    durationSec: output.durationSec,
    scenes: output.scenes,
    entities: proposals,
    relationships: output.relationships as ExtractedRelationship[],
    timelineEvents: output.timelineEvents,
    chapterMarkers: output.chapterMarkers,
    risks: output.risks,
    tokensUsed: cost.tokensUsed,
    costUsd: cost.costUsd,
    createdAt: now,
  };

  // Persist extraction (cache + canonical store).
  await db
    .collection('vlmExtractions')
    .doc(extractionId)
    .set({
      ...extraction,
      cacheKey: key,
      promptVersion: PROMPT_VERSION,
    });

  return { extraction, proposals, sceneIndexRows };
}
