/**
 * Auto-tagging for freshly-published gallery content.
 *
 * One-shot Gemini Flash call that turns an image/video into ~8–15 lowercase
 * search tags. Called inline during publishToGallery so the tags hit Firestore
 * with the initial write, powering tag-based gallery discovery without a
 * second round-trip.
 *
 * Env-gated (VLM_AUTOTAG_ON_PUBLISH=true) because every publish adds a
 * ~$0.0001–0.001 Gemini Flash cost. Safe to turn off — user-supplied tags
 * still work as before.
 */

import { z } from 'zod';
import { callJson, mediaPartFromUrl } from './gemini-client';
import type { GalleryMediaType } from '../../lib/gallery-publish';

const autoTagOutputSchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
});

export interface AutoTagArgs {
  mediaUrl: string;
  mediaType: GalleryMediaType;
  title?: string;
  description?: string;
}

function assetTypeFor(mediaType: GalleryMediaType): 'video' | 'image' | null {
  if (mediaType.includes('image')) return 'image';
  if (mediaType.includes('video')) return 'video';
  return null;
}

function buildPrompt(title?: string, description?: string): string {
  const context = [title ? `TITLE: ${title}` : '', description ? `DESCRIPTION: ${description}` : '']
    .filter(Boolean)
    .join('\n');
  return `You are tagging a piece of creative content for a search index.
${context}

RULES:
- Output 8–15 tags total.
- Each tag is lowercase, 1–3 words, hyphens instead of spaces (e.g. "neon-noir", "desert").
- Mix concrete nouns (objects, settings), stylistic descriptors (mood, palette, genre),
  and entity hints (visible characters, factions, species) if applicable.
- No stopwords, no punctuation other than hyphens, no duplicates.

Output JSON with this exact shape:
{ "tags": ["tag1", "tag2", ...] }

Output JSON only.`;
}

/**
 * Returns normalized tags, or [] on any failure (non-blocking).
 * Caller should merge with user-supplied tags and dedupe.
 */
export async function autoTagContent(input: AutoTagArgs): Promise<string[]> {
  const assetType = assetTypeFor(input.mediaType);
  if (!assetType) return [];
  try {
    const media = await mediaPartFromUrl(input.mediaUrl, assetType);
    const { data } = await callJson({
      model: 'gemini-2.5-flash',
      prompt: buildPrompt(input.title, input.description),
      media: [media],
      schema: autoTagOutputSchema,
      label: 'auto_tag',
    });
    return data.tags
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 40);
  } catch (err) {
    console.warn('[auto-tag] skipped:', (err as Error).message);
    return [];
  }
}

export function mergeTags(userTags: string[] = [], autoTags: string[] = []): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...userTags, ...autoTags]) {
    const norm = t.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    merged.push(norm);
  }
  return merged.slice(0, 25);
}
