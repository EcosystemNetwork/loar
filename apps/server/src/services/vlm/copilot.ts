/**
 * Reference-aware generation copilot.
 *
 *   - improvePromptFromReferences: user idea + reference images → concrete prompt
 *   - extractStyleBible: moodboard images → style pack fields
 *   - scoreOutput: a generated image/video scored against intent + references
 */

import { callJson, callText, mediaPartFromUrl } from './gemini-client';
import {
  buildPromptImprovementPrompt,
  buildStyleBiblePrompt,
  buildCopilotScorePrompt,
} from './prompts';
import {
  styleBibleOutputSchema,
  copilotScoreOutputSchema,
  type StyleBibleOutput,
  type CopilotScoreOutput,
} from './schemas';
import type { CostSummary } from './types';

export interface ReferenceImage {
  url: string;
  note?: string;
}

async function describeReference(url: string): Promise<string> {
  const media = await mediaPartFromUrl(url, 'image');
  const { text } = await callText({
    model: 'gemini-2.5-flash',
    media: [media],
    prompt:
      'Describe this reference image in one sentence: camera framing, subject, palette, lighting, mood.',
    label: 'ref-describe',
  });
  return text;
}

export async function improvePromptFromReferences(input: {
  userPrompt: string;
  references: ReferenceImage[];
  houseStyle?: string;
}): Promise<{ prompt: string; cost: CostSummary[] }> {
  const costs: CostSummary[] = [];
  const descriptions: string[] = [];
  for (const ref of input.references.slice(0, 6)) {
    const media = await mediaPartFromUrl(ref.url, 'image');
    const { text, cost } = await callText({
      model: 'gemini-2.5-flash',
      media: [media],
      prompt:
        'Describe this reference image in one sentence: camera framing, subject, palette, lighting, mood.',
      label: 'ref-describe',
    });
    descriptions.push(ref.note ? `${text} (note: ${ref.note})` : text);
    costs.push(cost);
  }
  const { text, cost } = await callText({
    model: 'gemini-2.5-flash',
    prompt: buildPromptImprovementPrompt({
      userPrompt: input.userPrompt,
      referenceDescriptions: descriptions,
      referenceStyle: input.houseStyle,
    }),
    label: 'prompt-improve',
  });
  costs.push(cost);
  return { prompt: text, cost: costs };
}

export async function extractStyleBibleFromMoodboard(input: {
  imageUrls: string[];
}): Promise<{ styleBible: StyleBibleOutput; cost: CostSummary[] }> {
  const media = [] as Awaited<ReturnType<typeof mediaPartFromUrl>>[];
  for (const url of input.imageUrls.slice(0, 8)) {
    media.push(await mediaPartFromUrl(url, 'image'));
  }
  const { data, cost } = await callJson<StyleBibleOutput>({
    model: 'gemini-2.5-flash',
    prompt: buildStyleBiblePrompt(),
    media,
    schema: styleBibleOutputSchema,
    label: 'style-bible',
  });
  return { styleBible: data, cost: [cost] };
}

export async function scoreOutput(input: {
  outputUrl: string;
  outputType: 'image' | 'video';
  intent: string;
  prompt: string;
  referenceUrls: string[];
}): Promise<{ score: CopilotScoreOutput; cost: CostSummary[] }> {
  const costs: CostSummary[] = [];
  const refDescs: string[] = [];
  for (const r of input.referenceUrls.slice(0, 4)) {
    try {
      const d = await describeReference(r);
      refDescs.push(d);
    } catch {
      // skip unfetchable references
    }
  }
  const media = [await mediaPartFromUrl(input.outputUrl, input.outputType)];
  const { data, cost } = await callJson<CopilotScoreOutput>({
    model: 'gemini-2.5-flash',
    prompt: buildCopilotScorePrompt({
      requestedIntent: input.intent,
      requestedPrompt: input.prompt,
      referenceDescriptions: refDescs,
    }),
    media,
    schema: copilotScoreOutputSchema,
    label: 'copilot-score',
  });
  costs.push(cost);
  return { score: data, cost: costs };
}
