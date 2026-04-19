/**
 * VLM-driven moderation risk scoring.
 *
 * Consumes an ExtractionResult (which includes `risks[]`), derives an overall
 * level, writes `vlmRiskScores/{contentId}` and — when risk is high — creates
 * a row in the existing `flags` collection so the admin moderation queue
 * surfaces it alongside user-submitted flags.
 *
 * No content is ever auto-hidden without admin action; we only tag it. The
 * `hide_pending_review` auto-action requires explicit env toggle.
 */

import { db, firebaseAvailable } from '../../lib/firebase';
import type { ExtractionResult, ExtractedRisk, RiskLevel, VlmRiskScoreDoc } from './types';

const RISK_THRESHOLDS = {
  highPerKind: 0.75,
  mediumPerKind: 0.45,
};

const BLOCK_KINDS = new Set([
  'nsfw',
  'violence',
  'copyright_logo',
  'copyright_character',
  'franchise_lookalike',
]);

function summarizeRisks(risks: ExtractedRisk[]): {
  overall: RiskLevel;
  topKinds: string[];
} {
  let max = 0;
  const byKind = new Map<string, number>();
  for (const r of risks) {
    max = Math.max(max, r.score);
    byKind.set(r.kind, Math.max(byKind.get(r.kind) ?? 0, r.score));
  }
  let overall: RiskLevel = 'low';
  if (max >= RISK_THRESHOLDS.highPerKind) overall = 'high';
  else if (max >= RISK_THRESHOLDS.mediumPerKind) overall = 'medium';
  const topKinds = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  return { overall, topKinds };
}

export interface ModerationArgs {
  extraction: ExtractionResult;
  contentId?: string;
}

export async function runModerationScoring({
  extraction,
  contentId,
}: ModerationArgs): Promise<VlmRiskScoreDoc | null> {
  if (!firebaseAvailable) return null;
  const targetId = contentId ?? extraction.contentId;
  if (!targetId) return null;

  const { overall, topKinds } = summarizeRisks(extraction.risks);
  const autoHide = process.env.VLM_AUTO_HIDE_HIGH_RISK === 'true';
  const autoAction =
    overall === 'high'
      ? autoHide && extraction.risks.some((r) => BLOCK_KINDS.has(r.kind))
        ? 'hide_pending_review'
        : 'flag'
      : 'none';

  const doc: VlmRiskScoreDoc = {
    contentId: targetId,
    overallRisk: overall,
    autoAction,
    scores: extraction.risks,
    extractionId: extraction.id,
    evaluatedAt: new Date(),
  };

  await db.collection('vlmRiskScores').doc(targetId).set(doc);

  // Only file a flag when risk escalates — deduped on (contentId, source).
  if (autoAction !== 'none') {
    const existing = await db
      .collection('flags')
      .where('contentId', '==', targetId)
      .where('source', '==', 'vlm')
      .limit(1)
      .get();
    if (existing.empty) {
      await db.collection('flags').add({
        contentId: targetId,
        flaggerUid: 'system:vlm',
        flaggerAddress: null,
        reason:
          topKinds.includes('copyright_logo') || topKinds.includes('copyright_character')
            ? 'copyright'
            : topKinds.includes('nsfw') || topKinds.includes('violence')
              ? 'offensive'
              : 'other',
        description: `VLM risk=${overall}. Top: ${topKinds.join(', ')}. Extraction: ${extraction.id}`,
        status: 'pending',
        source: 'vlm',
        riskLevel: overall,
        extractionId: extraction.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Set content status to under_review when auto-hide is active.
  if (autoAction === 'hide_pending_review') {
    await db
      .collection('content')
      .doc(targetId)
      .set(
        {
          contentStatus: 'under_review',
          contentStatusUpdatedAt: new Date().toISOString(),
          contentStatusUpdatedBy: 'system:vlm',
          contentStatusReason: `Auto-review: VLM flagged ${topKinds.join(', ')}`,
        },
        { merge: true }
      );
    await db.collection('contentAuditLog').add({
      contentId: targetId,
      action: 'status_change_to_under_review',
      adminUid: 'system:vlm',
      reason: `VLM risk=${overall}`,
      createdAt: new Date().toISOString(),
    });
  }

  return doc;
}
