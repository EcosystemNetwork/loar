/**
 * Caption translation — segment-level translation via Google Gemini.
 *
 * Word-level translation doesn't map 1:1 across languages (idioms,
 * word-order shifts, compound vs. analytic forms), so we translate at
 * segment granularity and DROP the `words` array on translated outputs.
 * Timing, speakers, and segment boundaries are preserved exactly.
 *
 * Batching: segments are sent in chunks of 30 (or ~6k chars, whichever
 * comes first) to keep prompt size predictable. A failed chunk is
 * retried once, then the original (untranslated) segments are passed
 * through with a `[untranslated]` prefix on `text` so the resulting
 * cue track still has the same shape.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { CaptionSegment } from '../lib/captions-format';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const MODEL = 'gemini-2.5-flash';
const CHUNK_SEGMENTS = 30;
const CHUNK_CHARS = 6_000;

/** ISO-639-1 → human readable. Used in the prompt for clarity. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  sv: 'Swedish',
};

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

export function supportedTranslationLanguages(): string[] {
  return Object.keys(LANGUAGE_LABELS);
}

function chunks(segments: CaptionSegment[]): CaptionSegment[][] {
  const out: CaptionSegment[][] = [];
  let buf: CaptionSegment[] = [];
  let chars = 0;
  for (const seg of segments) {
    buf.push(seg);
    chars += seg.text.length;
    if (buf.length >= CHUNK_SEGMENTS || chars >= CHUNK_CHARS) {
      out.push(buf);
      buf = [];
      chars = 0;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/**
 * Build a strict prompt for one chunk. Gemini returns a JSON array with
 * `i` (index, matches input) and `t` (translated text). We map back to
 * full CaptionSegments on the client side.
 */
function buildPrompt(chunk: CaptionSegment[], sourceLabel: string, targetLabel: string): string {
  const payload = chunk.map((s, i) => ({ i, t: s.text }));
  return `You are a professional subtitle translator. Translate from ${sourceLabel} to ${targetLabel}.
Return ONLY a valid JSON array of objects with the same shape as the input:
  [{"i": 0, "t": "translated text"}, ...]

Rules:
- Translate the "t" field. Preserve the original "i" index exactly.
- Keep the translation length similar to the original where possible (subtitle constraint).
- Do NOT add explanations, do NOT wrap in markdown code fences.
- Profanity, slang, named entities, and proper nouns: keep their original sense.
- If a segment is empty or untranslatable, return its "t" unchanged.

Input (${chunk.length} segments):
${JSON.stringify(payload)}`;
}

function parseTranslationJson(text: string): Array<{ i: number; t: string }> {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '');
  }
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed.filter((x) => typeof x?.i === 'number' && typeof x?.t === 'string') as Array<{
      i: number;
      t: string;
    }>;
  } catch (err) {
    throw new Error(
      `Translation response was not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`
    );
  }
}

export interface TranslateCaptionsInput {
  segments: CaptionSegment[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateCaptionsResult {
  segments: CaptionSegment[];
  /** Number of segments where translation succeeded; the rest fell back. */
  translated: number;
  /** Number of segments that fell back to the source text with a marker. */
  fallback: number;
  /** Approximate character count of the source (for billing). */
  sourceChars: number;
}

/**
 * Translate one caption track to one target language. Word arrays are
 * intentionally dropped from translated segments (word timing doesn't
 * survive translation).
 */
export async function translateCaptions(
  input: TranslateCaptionsInput
): Promise<TranslateCaptionsResult> {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required for caption translation');
  }
  if (input.sourceLanguage === input.targetLanguage) {
    return {
      segments: input.segments.map(({ words: _words, ...rest }) => rest),
      translated: 0,
      fallback: 0,
      sourceChars: input.segments.reduce((n, s) => n + s.text.length, 0),
    };
  }
  const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.2 },
  });

  const sourceLabel = languageLabel(input.sourceLanguage);
  const targetLabel = languageLabel(input.targetLanguage);
  const sourceChars = input.segments.reduce((n, s) => n + s.text.length, 0);

  const out: CaptionSegment[] = input.segments.map(({ words: _words, ...rest }) => ({
    ...rest,
  }));
  let translated = 0;
  let fallback = 0;

  const parts = chunks(input.segments);
  let offset = 0;
  for (const chunk of parts) {
    let attempts = 0;
    let translatedThisChunk: Array<{ i: number; t: string }> | null = null;
    while (attempts < 2 && !translatedThisChunk) {
      attempts++;
      try {
        const prompt = buildPrompt(chunk, sourceLabel, targetLabel);
        const res = await model.generateContent(prompt);
        const text = res.response.text();
        translatedThisChunk = parseTranslationJson(text);
      } catch (err) {
        if (attempts >= 2) {
          console.warn(
            `[caption-translate] chunk failed after ${attempts} attempts:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
    if (translatedThisChunk && translatedThisChunk.length > 0) {
      // Map by local-chunk index `i` back to the absolute `offset + i`.
      const byIndex = new Map(translatedThisChunk.map((x) => [x.i, x.t]));
      for (let i = 0; i < chunk.length; i++) {
        const t = byIndex.get(i);
        if (typeof t === 'string' && t.trim()) {
          out[offset + i].text = t;
          translated++;
        } else {
          out[offset + i].text = `[untranslated] ${out[offset + i].text}`;
          fallback++;
        }
      }
    } else {
      for (let i = 0; i < chunk.length; i++) {
        out[offset + i].text = `[untranslated] ${out[offset + i].text}`;
        fallback++;
      }
    }
    offset += chunk.length;
  }

  return { segments: out, translated, fallback, sourceChars };
}
