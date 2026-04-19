/**
 * Trailer / recap / chapter / SEO generation from a video.
 * Reuses any existing extraction when available to save cost.
 */

import { db, firebaseAvailable } from '../../lib/firebase';
import type { ExtractionResult } from './types';
import { buildRecapPrompt } from './prompts';
import { recapOutputSchema, type RecapOutput } from './schemas';
import { callJson, mediaPartFromUrl } from './gemini-client';

export interface RecapArgs {
  mediaUrl: string;
  assetType: 'video' | 'image';
  mimeType?: string;
  targetDurationSec?: number;
  audience?: string;
  extraction?: ExtractionResult;
}

export async function runRecap(input: RecapArgs): Promise<{
  recap: RecapOutput;
  tokensUsed: number;
  costUsd: number;
}> {
  const media = await mediaPartFromUrl(input.mediaUrl, input.assetType, input.mimeType);
  const extractionContext = input.extraction
    ? `\n\nEXISTING EXTRACTION (use timestamps from here when possible):\n${JSON.stringify({
        summary: input.extraction.summary,
        scenes: input.extraction.scenes.slice(0, 40),
        chapterMarkers: input.extraction.chapterMarkers,
      })}`
    : '';
  const prompt =
    buildRecapPrompt({
      targetDurationSec: input.targetDurationSec,
      audience: input.audience,
    }) + extractionContext;

  const { data, cost } = await callJson<RecapOutput>({
    model: 'gemini-2.5-pro',
    prompt,
    media: [media],
    schema: recapOutputSchema,
    label: 'recap',
  });

  // Persist a lightweight record for reuse on the content card.
  if (firebaseAvailable && input.extraction?.contentId) {
    await db
      .collection('content')
      .doc(input.extraction.contentId)
      .set(
        {
          recap: {
            title: data.title,
            seoDescription: data.seoDescription,
            chapters: data.chapters,
            previouslyOn: data.previouslyOn,
            updatedAt: new Date(),
          },
        },
        { merge: true }
      );
  }

  return { recap: data, tokensUsed: cost.tokensUsed, costUsd: cost.costUsd };
}
