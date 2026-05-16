/**
 * Voice Library Router
 *
 * Curated catalog of LOAR signature voices (seeded via `designVoice`) plus
 * per-user "saved" + cloned voice management for the Voice Studio.
 *
 * Collections:
 *   voiceLibrary               — global curated catalog (admin-seeded)
 *   userVoices/{uid}/voices    — per-user saved + cloned voices
 *
 * Procedures:
 *   list             — public catalog browse with filters
 *   get              — single curated entry
 *   preview          — protected TTS render of a curated voice (small free quota)
 *   saveToMyVoices   — copy a curated voice into user's collection
 *   myVoices         — list user's voices (saved + cloned)
 *   deleteMyVoice    — remove a user's saved/cloned voice
 *   registerClone    — internal: called by voice.cloneFromUpload after ElevenLabs returns voice_id
 */

import { router, protectedProcedure, publicProcedure, expensiveProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { elevenLabsService } from '../../services/elevenlabs';
import { firebaseStorageService } from '../../services/firebase-storage';
import { TRPCError } from '@trpc/server';

// ── Collections ──────────────────────────────────────────────────────

const voiceLibraryCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('voiceLibrary');
};

const userVoicesCol = (uid: string) => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userVoices').doc(uid).collection('voices');
};

// ── Schemas ──────────────────────────────────────────────────────────

const VOICE_CATEGORIES = [
  'narrator',
  'protagonist_male',
  'protagonist_female',
  'villain',
  'child',
  'elderly',
  'creature',
  'accent',
  'specialty',
] as const;

const voiceLibraryEntrySchema = z.object({
  id: z.string(),
  voiceId: z.string(), // ElevenLabs voice ID
  name: z.string(),
  description: z.string(),
  category: z.enum(VOICE_CATEGORIES),
  tags: z.array(z.string()),
  previewUrl: z.string().url(),
  gender: z.enum(['male', 'female', 'neutral']),
  age: z.enum(['young', 'middle_aged', 'old']),
  accent: z.string().optional(),
  createdAt: z.date(),
});

export type VoiceLibraryEntry = z.infer<typeof voiceLibraryEntrySchema>;

/**
 * Rights classification for a user-owned voice entry. Drives what the Voice
 * Mixer (and any future commercial flows) can use as a source.
 *   owned    — user cloned it from their own samples or designed it from scratch
 *   licensed — platform-licensed catalog voice the user saved from Library
 */
export type VoiceRightsClass = 'owned' | 'licensed';

// User-voice doc shape — either a `saved` curated copy or a `cloned` upload.
export interface UserVoiceDoc {
  id: string;
  userId: string;
  source: 'library' | 'clone' | 'design';
  /** Authorization lane for downstream commercial use (mix, license, mint). */
  rightsClass: VoiceRightsClass;
  voiceId: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  previewUrl?: string;
  // For `library` source — the catalog entry this was copied from.
  libraryEntryId?: string;
  // For `clone` source — the original sample URLs the user uploaded.
  sourceSampleUrls?: string[];
  // For `design` source — the parametric design generation that produced it.
  designGenerationId?: string;
  createdAt: Date;
}

/** Map a voice source to its default rights class. */
function defaultRightsClass(source: UserVoiceDoc['source']): VoiceRightsClass {
  return source === 'library' ? 'licensed' : 'owned';
}

// ── Preview rate limit (in-memory, per-process) ─────────────────────
// Cheap floor: 20 free previews per user per hour. Beyond that, billing kicks in.
const PREVIEW_FREE_PER_HOUR = 20;
const previewWindowMs = 60 * 60 * 1000;
type PreviewWindow = { count: number; resetAt: number };
const previewWindows = new Map<string, PreviewWindow>();

function tickPreviewQuota(uid: string): { free: boolean; remaining: number } {
  const now = Date.now();
  const w = previewWindows.get(uid);
  if (!w || w.resetAt <= now) {
    previewWindows.set(uid, { count: 1, resetAt: now + previewWindowMs });
    return { free: true, remaining: PREVIEW_FREE_PER_HOUR - 1 };
  }
  if (w.count >= PREVIEW_FREE_PER_HOUR) {
    return { free: false, remaining: 0 };
  }
  w.count += 1;
  return { free: true, remaining: PREVIEW_FREE_PER_HOUR - w.count };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function uploadAudio(buffer: Buffer, filename: string): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, filename);
  return firebaseStorageService.getPublicUrl(key);
}

// ── Router ───────────────────────────────────────────────────────────

export const voiceLibraryRouter = router({
  /**
   * Browse the curated catalog. Public — anyone can discover voices before signup.
   */
  list: publicProcedure
    .input(
      z
        .object({
          category: z.enum(VOICE_CATEGORIES).optional(),
          gender: z.enum(['male', 'female', 'neutral']).optional(),
          tag: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().min(1).max(200).default(100),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const params = input ?? { limit: 100 };
      let query = voiceLibraryCol() as FirebaseFirestore.Query;
      if (params.category) query = query.where('category', '==', params.category);
      if (params.gender) query = query.where('gender', '==', params.gender);
      if (params.tag) query = query.where('tags', 'array-contains', params.tag);
      query = query.limit(params.limit ?? 100);

      const snap = await query.get();
      let entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

      // Free-text search filter (post-query, since Firestore lacks LIKE)
      if (params.search) {
        const needle = params.search.toLowerCase();
        entries = entries.filter((e) => {
          const haystack =
            `${(e as any).name ?? ''} ${(e as any).description ?? ''} ${(e as any).tags?.join(' ') ?? ''}`.toLowerCase();
          return haystack.includes(needle);
        });
      }

      return entries;
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const snap = await voiceLibraryCol().doc(input.id).get();
    if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Voice not found' });
    return { id: snap.id, ...snap.data() };
  }),

  /**
   * Render a TTS preview of a curated voice. Small free quota per user/hour;
   * past the quota the caller should fall back to `voice.synthesize` (billed).
   */
  preview: expensiveProcedure
    .input(
      z.object({
        voiceId: z.string().min(1),
        text: z.string().min(1).max(280),
        stability: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const quota = tickPreviewQuota(ctx.user.uid);
      if (!quota.free) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Preview quota exhausted (${PREVIEW_FREE_PER_HOUR}/hour). Use voice.synthesize for billed renders.`,
        });
      }

      const result = await elevenLabsService.textToSpeech({
        text: input.text,
        voiceId: input.voiceId,
        modelId: 'eleven_flash_v2_5',
        stability: input.stability ?? 0.5,
        style: input.style ?? 0,
      });

      const url = await uploadAudio(
        result.audioBuffer,
        `previews/${ctx.user.uid}/${randomUUID()}.mp3`
      );

      return { url, previewsRemainingThisHour: quota.remaining };
    }),

  /**
   * Save a curated voice to the user's collection. Idempotent — re-saving the
   * same library entry returns the existing doc.
   */
  saveToMyVoices: protectedProcedure
    .input(
      z.object({
        libraryEntryId: z.string(),
        rename: z.string().min(1).max(80).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entrySnap = await voiceLibraryCol().doc(input.libraryEntryId).get();
      if (!entrySnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Library voice not found' });
      }
      const entry = entrySnap.data() as VoiceLibraryEntry;

      // Idempotent: look for existing saved copy of this library entry.
      const existing = await userVoicesCol(ctx.user.uid)
        .where('libraryEntryId', '==', input.libraryEntryId)
        .limit(1)
        .get();

      if (!existing.empty) {
        const doc = existing.docs[0];
        return { id: doc.id, ...(doc.data() as Record<string, unknown>) };
      }

      const id = randomUUID();
      const doc: UserVoiceDoc = {
        id,
        userId: ctx.user.uid,
        source: 'library',
        rightsClass: defaultRightsClass('library'),
        voiceId: entry.voiceId,
        name: input.rename || entry.name,
        description: entry.description,
        category: entry.category,
        tags: entry.tags,
        previewUrl: entry.previewUrl,
        libraryEntryId: input.libraryEntryId,
        createdAt: new Date(),
      };
      await userVoicesCol(ctx.user.uid).doc(id).set(doc);
      return doc;
    }),

  /**
   * List the user's saved + cloned + designed voices. Optional `rightsClass`
   * filter is the canonical way to drive the Voice Mixer source picker — pass
   * `['owned', 'licensed']` (default) to include everything the user can legally
   * remix; pass `['owned']` to restrict to user-IP-only.
   */
  myVoices: protectedProcedure
    .input(
      z
        .object({
          source: z.enum(['library', 'clone', 'design']).optional(),
          rightsClass: z.array(z.enum(['owned', 'licensed'])).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      let query = userVoicesCol(ctx.user.uid) as FirebaseFirestore.Query;
      if (input?.source) query = query.where('source', '==', input.source);
      const snap = await query.orderBy('createdAt', 'desc').limit(200).get();
      const rows = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        // Backfill for legacy docs written before rightsClass existed.
        if (!data.rightsClass && typeof data.source === 'string') {
          data.rightsClass = defaultRightsClass(data.source as UserVoiceDoc['source']);
        }
        return { id: d.id, ...data };
      });
      if (input?.rightsClass && input.rightsClass.length > 0) {
        const allowed = new Set(input.rightsClass);
        return rows.filter((r) =>
          allowed.has((r as unknown as { rightsClass: VoiceRightsClass }).rightsClass)
        );
      }
      return rows;
    }),

  deleteMyVoice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = userVoicesCol(ctx.user.uid).doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Voice not found' });
      }
      // Defense in depth: ensure ownership (subcollection path already scopes by uid)
      if ((snap.data() as UserVoiceDoc).userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your voice' });
      }
      await ref.delete();
      return { ok: true };
    }),

  /**
   * Internal — called by `voice.cloneFromUpload` after ElevenLabs returns a
   * cloned voice_id. Exposed here so the Voice Studio uses one consistent
   * "my voices" surface regardless of source.
   */
  registerClone: protectedProcedure
    .input(
      z.object({
        voiceId: z.string(),
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        sourceSampleUrls: z.array(z.string().url()).optional(),
        previewUrl: z.string().url().optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = randomUUID();
      const doc: UserVoiceDoc = {
        id,
        userId: ctx.user.uid,
        source: 'clone',
        rightsClass: defaultRightsClass('clone'),
        voiceId: input.voiceId,
        name: input.name,
        description: input.description,
        tags: input.tags,
        previewUrl: input.previewUrl,
        sourceSampleUrls: input.sourceSampleUrls,
        createdAt: new Date(),
      };
      await userVoicesCol(ctx.user.uid).doc(id).set(doc);
      return doc;
    }),

  /**
   * Register a parametrically-designed voice into the user's collection.
   * Called by the Voice Creator UI after `voice.designVoice` succeeds — the
   * design call already charges credits and returns a voiceId + preview URL,
   * this just persists it into My Voices with `source='design'`.
   */
  registerDesign: protectedProcedure
    .input(
      z.object({
        voiceId: z.string().min(10).max(64),
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        previewUrl: z.string().url().optional(),
        tags: z.array(z.string()).optional(),
        designGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Idempotent on (uid, designGenerationId) — re-clicking "Save" must not
      // create duplicate entries.
      if (input.designGenerationId) {
        const existing = await userVoicesCol(ctx.user.uid)
          .where('designGenerationId', '==', input.designGenerationId)
          .limit(1)
          .get();
        if (!existing.empty) {
          const doc = existing.docs[0];
          return { id: doc.id, ...(doc.data() as Record<string, unknown>) };
        }
      }
      const id = randomUUID();
      const doc: UserVoiceDoc = {
        id,
        userId: ctx.user.uid,
        source: 'design',
        rightsClass: defaultRightsClass('design'),
        voiceId: input.voiceId,
        name: input.name,
        description: input.description,
        tags: input.tags,
        previewUrl: input.previewUrl,
        designGenerationId: input.designGenerationId,
        createdAt: new Date(),
      };
      await userVoicesCol(ctx.user.uid).doc(id).set(doc);
      return doc;
    }),
});
