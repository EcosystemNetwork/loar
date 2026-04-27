/**
 * Z.AI-powered canon consistency check for episodes.
 *
 * Given an episode + its universe, extracts a representative frame from the
 * first clip and asks GLM-5V to score the visual against the universe's
 * lore summary. The score (0-100) and verdict ("canonical" | "borderline" |
 * "off-canon") feed both:
 *
 *   1. A pre-publish preview procedure (`zai.canonCheckEpisode`)
 *   2. An advisory gate inside `episodes.publishAsCanon` that records the
 *      score on the audit log entry and blocks only when verdict is
 *      "off-canon" with high-severity contradictions.
 *
 * Bypassed when:
 *   - No Z.AI key is configured (BYOK + platform both absent)
 *   - Episode has no playable first clip
 *   - First-clip thumbnail extraction fails
 *
 * Errors here NEVER block publish — they degrade to `null` so a Z.AI outage
 * cannot DOS canon submissions. The hard block comes from the verdict, not
 * from infrastructure.
 */
import { db, firebaseAvailable } from '../lib/firebase';
import { extractVideoThumbnail } from './video-thumbnail';
import { zaiService } from './zai';
import { getUserSecret } from './userSecrets';

export interface CanonCheckResult {
  score: number;
  verdict: 'canonical' | 'borderline' | 'off-canon';
  contradictions: Array<{ severity: 'low' | 'med' | 'high'; note: string }>;
  summary: string;
  thumbUrl: string;
}

/**
 * Run the canon consistency check for a single episode against its universe.
 * Returns null when the check is skipped (no key, no playable clip, etc.) so
 * the caller can treat absence as "no advisory available".
 */
export async function runEpisodeCanonCheck(
  episodeId: string,
  callerUid: string
): Promise<CanonCheckResult | null> {
  if (!firebaseAvailable) return null;

  // Resolve user-bound or platform Z.AI key. If neither, skip silently.
  const byok = await getUserSecret(callerUid, 'zai').catch(() => null);
  if (!zaiService.isConfigured(byok ?? undefined)) {
    return null;
  }

  // Load episode + universe
  const epDoc = await db.collection('episodes').doc(episodeId).get();
  if (!epDoc.exists) return null;
  const ep = epDoc.data() ?? {};

  const universeId = (ep.universeId as string | undefined)?.toLowerCase();
  if (!universeId) return null;

  const uniDoc = await db.collection('cinematicUniverses').doc(universeId).get();
  if (!uniDoc.exists) return null;
  const uni = uniDoc.data() ?? {};

  const universeName = (uni.name as string | undefined) ?? 'this universe';
  const loreSummary =
    (uni.description as string | undefined) || (ep.description as string | undefined) || '';
  if (loreSummary.trim().length < 16) return null;

  const clips = Array.isArray(ep.clips) ? (ep.clips as Array<{ videoUrl?: string }>) : [];
  const firstUrl = clips.find((c) => typeof c.videoUrl === 'string' && c.videoUrl)?.videoUrl;
  if (!firstUrl) return null;

  // Extract a thumbnail (1 frame ~0.5s in) so we can pass an image to GLM-5V.
  // ffmpeg failures degrade to null — the caller treats no thumb as "skip".
  const thumbUrl = await extractVideoThumbnail(firstUrl, `canon-${episodeId}`, {
    seekSeconds: 0.5,
    width: 768,
    uploaderUid: callerUid,
  });
  if (!thumbUrl) return null;

  const visionResult = await zaiService
    .vision({
      apiKey: byok ?? undefined,
      model: 'glm-4.5v',
      maxTokens: 1200,
      prompt: `You are LOAR's canon consistency reviewer for the universe "${universeName}".

Lore summary:
"""
${loreSummary.slice(0, 6000)}
"""

Look at the attached frame from a candidate canon episode. Score 0-100 how well the frame fits the universe's lore (visual style, period, characters, technology). List up to 5 specific contradictions with the lore. Respond with strict JSON only:

{
  "score": number,                       // 0-100
  "verdict": "canonical" | "borderline" | "off-canon",
  "contradictions": Array<{ severity: "low" | "med" | "high", note: string }>,
  "summary": string                       // one short paragraph
}`,
      imageUrls: [thumbUrl],
    })
    .catch((err) => {
      console.warn('[canon-check] zai.vision failed', err);
      return null;
    });

  if (!visionResult) return null;

  let parsed: Omit<CanonCheckResult, 'thumbUrl'>;
  try {
    const stripped = visionResult.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    parsed = JSON.parse(stripped);
  } catch {
    parsed = {
      score: 50,
      verdict: 'borderline',
      contradictions: [],
      summary: visionResult.content.slice(0, 500),
    };
  }

  // Clamp the score to [0,100] and normalize the verdict to one of three values.
  const score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 50)));
  const verdict: CanonCheckResult['verdict'] =
    parsed.verdict === 'canonical' || parsed.verdict === 'off-canon'
      ? parsed.verdict
      : 'borderline';

  return {
    score,
    verdict,
    contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.slice(0, 5) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    thumbUrl,
  };
}

/**
 * Should the canon advisory result block publishing?
 * Hard block only when the verdict is "off-canon" *and* there is at least
 * one high-severity contradiction. Borderline scores warn but do not block.
 */
export function shouldBlockCanonPublish(result: CanonCheckResult | null): boolean {
  if (!result) return false;
  if (result.verdict !== 'off-canon') return false;
  return result.contradictions.some((c) => c.severity === 'high');
}
