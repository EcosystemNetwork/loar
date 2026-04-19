/**
 * Multimodal search over VLM extractions.
 *
 * V1 strategy: lexical retrieval over the `sceneIndex` collection (tags,
 * captions, objects, faces) plus `vlmExtractions` summaries. Simple, cheap,
 * and works with the data we already collect post-generation.
 *
 * Optional V2 behind `VLM_EMBEDDINGS=true`: Gemini text-embedding-004 over
 * captions for semantic recall. We persist the embedding on the sceneIndex
 * row and do in-memory cosine ranking for small corpora (good enough until
 * we outgrow Firestore; migrate to pgvector/similar when we do).
 */

import { db, firebaseAvailable } from '../../lib/firebase';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { SceneIndexDoc } from './types';

const EMBEDDINGS_ENABLED = process.env.VLM_EMBEDDINGS === 'true';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const genAI = GOOGLE_API_KEY ? new GoogleGenerativeAI(GOOGLE_API_KEY) : null;

async function embed(text: string): Promise<number[]> {
  if (!genAI) throw new Error('GOOGLE_API_KEY is required for embeddings');
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const res = await (model as any).embedContent(text);
  return (res.embedding?.values ?? []) as number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SearchHit {
  contentId: string;
  sceneIndex: number;
  caption: string;
  tags: string[];
  startSec: number;
  endSec: number;
  score: number;
  matchedBy: 'tag' | 'object' | 'caption' | 'embedding';
}

export async function searchScenes(input: {
  query: string;
  universeAddress?: string | null;
  limit?: number;
}): Promise<SearchHit[]> {
  if (!firebaseAvailable) return [];
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const q = input.query.trim().toLowerCase();
  if (!q) return [];
  const tokens = Array.from(new Set(q.split(/\s+/).filter(Boolean)));

  // Lexical pass: fetch up to 500 candidate scenes, filter in-memory. This
  // avoids needing a full-text index in Firestore while still being fast at
  // testnet corpus size (<100k scenes). Migrate to Algolia/Meili at scale.
  let baseQuery = db.collection('sceneIndex').orderBy('startSec').limit(500);
  if (input.universeAddress) {
    baseQuery = db
      .collection('sceneIndex')
      .where('universeAddress', '==', input.universeAddress)
      .limit(500) as any;
  }
  const snap = await baseQuery.get();
  const docs: Array<SceneIndexDoc & { universeAddress?: string | null }> = snap.docs.map((d) => {
    const data = d.data() as SceneIndexDoc;
    return { ...data, id: d.id };
  });

  let queryEmbedding: number[] | null = null;
  if (EMBEDDINGS_ENABLED) {
    try {
      queryEmbedding = await embed(q);
    } catch {
      queryEmbedding = null;
    }
  }

  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const hay = [
      doc.caption,
      doc.mood,
      (doc.tags ?? []).join(' '),
      (doc.objects ?? []).join(' '),
      (doc.faces ?? []).join(' '),
    ]
      .join(' ')
      .toLowerCase();

    let score = 0;
    let matchedBy: SearchHit['matchedBy'] = 'caption';
    for (const tok of tokens) {
      if ((doc.tags ?? []).some((t) => t.toLowerCase().includes(tok))) {
        score += 2;
        matchedBy = 'tag';
      } else if ((doc.objects ?? []).some((o) => o.toLowerCase().includes(tok))) {
        score += 1.5;
        matchedBy = 'object';
      } else if (hay.includes(tok)) {
        score += 1;
      }
    }

    if (queryEmbedding && doc.embedding && doc.embedding.length === queryEmbedding.length) {
      const sim = cosine(queryEmbedding, doc.embedding);
      if (sim > 0.55) {
        score += sim * 2;
        matchedBy = 'embedding';
      }
    }

    if (score > 0) {
      hits.push({
        contentId: doc.contentId,
        sceneIndex: doc.sceneIndex,
        caption: doc.caption,
        tags: doc.tags ?? [],
        startSec: doc.startSec,
        endSec: doc.endSec,
        score,
        matchedBy,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export async function indexScenesForContent(input: {
  contentId: string;
  universeAddress?: string | null;
  rows: Array<{
    sceneIndex: number;
    caption: string;
    tags: string[];
    objects: string[];
    faces: string[];
    mood: string;
    startSec: number;
    endSec: number;
  }>;
}): Promise<number> {
  if (!firebaseAvailable) return 0;
  const batch = db.batch();
  let count = 0;
  for (const r of input.rows) {
    const id = `${input.contentId}_${r.sceneIndex}`;
    const ref = db.collection('sceneIndex').doc(id);
    const doc: SceneIndexDoc & { universeAddress?: string | null } = {
      id,
      contentId: input.contentId,
      universeAddress: input.universeAddress ?? null,
      sceneIndex: r.sceneIndex,
      caption: r.caption,
      tags: r.tags,
      objects: r.objects,
      faces: r.faces,
      mood: r.mood,
      startSec: r.startSec,
      endSec: r.endSec,
    };
    if (EMBEDDINGS_ENABLED) {
      try {
        doc.embedding = await embed(`${r.caption}. Tags: ${r.tags.join(', ')}`);
      } catch {
        // skip embedding on failure; lexical still works
      }
    }
    batch.set(ref, doc);
    count++;
  }
  await batch.commit();
  return count;
}
