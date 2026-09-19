/**
 * Wiki Router — character wikis, event wikis, storyline generation, prompt improvement.
 * Extracted from the root appRouter inline definition into its own module.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../../lib/firebase';
import { throwApiError, wrapError } from '../../lib/errors';
import { wikiaService } from '../../services/wikia';
import { geminiService } from '../../services/gemini';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { normalizeUniverseId } from '../../lib/universe-id';

/** Doc ids can't contain '/', and the `${universeId}-${eventId}` key must be unambiguous. */
const wikiKeyPart = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !v.includes('/'), 'Must not contain "/"');
const MAX_WIKI_GENERATIONS_PER_HOUR = 20;

const charactersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characters');
};
const eventWikisCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('eventWikis');
};

export const wikiRouter = router({
  /**
   * List characters from the wiki database, optionally filtered by universe.
   *
   * When `universeId` is omitted this used to read the ENTIRE `characters`
   * collection (unbounded full-collection scan / DoS + cost vector). It is now
   * always bounded: filtered queries page by `universe_id`; the unfiltered
   * "all characters" path is capped at `limit` (default 50) with an opaque
   * doc-id `cursor` for follow-up pages. `nextCursor` is null on the last page.
   */
  characters: publicProcedure
    .input(
      z
        .object({
          universeId: z.string().optional(),
          limit: z.number().int().positive().max(200).default(50),
          cursor: z
            .string()
            .max(200)
            .regex(/^[^/]+$/)
            .optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      try {
        const col = charactersCol();
        let query: FirebaseFirestore.Query = input?.universeId
          ? col.where('universe_id', '==', input.universeId)
          : col;
        query = query.orderBy('__name__');
        if (input?.cursor) {
          const cursorDoc = await col.doc(input.cursor).get();
          if (cursorDoc.exists) query = query.startAfter(cursorDoc);
        }
        const snapshot = await query.limit(limit).get();
        const result = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        const nextCursor =
          snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;
        return {
          metadata: {
            version: '5.0',
            created_at: new Date().toISOString(),
            total_characters: result.length,
            last_updated: new Date().toISOString(),
            nextCursor,
          },
          nextCursor,
          characters: result.map((char: any) => ({
            id: char.id,
            character_name: char.character_name,
            collection: char.collection,
            token_id: char.token_id,
            traits: (char.traits ?? {}) as Record<string, string>,
            rarity_rank: char.rarity_rank,
            rarity_percentage: char.rarity_percentage ? parseFloat(char.rarity_percentage) : 0,
            image_url: char.image_url,
            description: char.description,
            created_at: char.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          })),
        };
      } catch (error) {
        console.error('Failed to load characters from database:', error);
        // The static fallback file has no universe scoping — serving it for a
        // universe-filtered request would return unrelated characters.
        if (input?.universeId) {
          throw wrapError(error, 'Could not load character data');
        }
        try {
          const wikiPath = join(process.cwd(), '../character-wiki/simple_character_wiki.json');
          const wikiData = readFileSync(wikiPath, 'utf-8');
          try {
            return JSON.parse(wikiData);
          } catch (parseErr) {
            throw new Error('Character wiki fallback file contains invalid JSON');
          }
        } catch (fileError) {
          console.error('Failed to load character wiki file:', fileError);
          throw wrapError(fileError, 'Could not load character data');
        }
      }
    }),

  /** Get a single character by ID. */
  character: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const doc = await charactersCol().doc(input.id).get();
    if (!doc.exists) {
      throwApiError('NOT_FOUND', 'Character not found');
    }

    const char = doc.data() as any;
    return {
      id: doc.id,
      character_name: char.character_name,
      collection: char.collection,
      token_id: char.token_id,
      traits: (char.traits ?? {}) as Record<string, string>,
      rarity_rank: char.rarity_rank,
      rarity_percentage: char.rarity_percentage ? parseFloat(char.rarity_percentage) : 0,
      image_url: char.image_url,
      description: char.description,
      created_at: char.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString(),
    };
  }),

  /** Generate a wikia entry for a narrative event. */
  generateEventWikia: protectedProcedure
    .input(
      z.object({
        nodeId: z.number(),
        title: z.string().max(300),
        description: z.string().max(5000),
        videoUrl: z.string().url().max(2048),
        previousNodes: z
          .array(z.object({ title: z.string().max(300), plot: z.string().max(5000) }))
          .max(20)
          .optional(),
        nextNodes: z
          .array(z.object({ title: z.string().max(300), plot: z.string().max(5000) }))
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await wikiaService.generateWikiaEntry(
          input.nodeId,
          input.title,
          input.description,
          input.videoUrl,
          input.previousNodes,
          input.nextNodes,
          ctx.user.uid
        );
      } catch (error) {
        throw wrapError(error, 'Could not generate wikia entry');
      }
    }),

  /** Generate a storyline from a user prompt. */
  generateStoryline: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required').max(5000),
        characters: z.array(z.string().max(200)).max(50).optional(),
        previousEvents: z
          .array(z.object({ title: z.string().max(300), description: z.string().max(5000) }))
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await wikiaService.generateStorylineFromPrompt(
          input.prompt,
          input.characters || [],
          input.previousEvents,
          ctx.user.uid
        );
      } catch (error) {
        throw wrapError(error, 'Could not generate storyline');
      }
    }),

  /** Generate wiki content from a video using Gemini. */
  generateFromVideo: protectedProcedure
    .input(
      z.object({
        universeId: wikiKeyPart,
        eventId: wikiKeyPart,
        videoUrl: z.string().url().max(2048),
        title: z.string().max(300),
        description: z.string().max(5000),
        characterIds: z.array(wikiKeyPart).max(50).optional(),
        characters: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              userDescription: z.string().max(5000),
              visualDescription: z.string().max(5000).optional(),
            })
          )
          .max(50)
          .optional(),
        previousEvents: z
          .array(z.object({ title: z.string().max(300), description: z.string().max(5000) }))
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const wikiId = `${normalizeUniverseId(input.universeId)}-${input.eventId}`;
      const caller = ctx.user.address;
      const callerIsAdmin = !!caller && (await isUniverseAdmin(input.universeId, caller));

      // Overwrite guard: an existing event wiki may only be regenerated by a
      // universe admin or the user who originally generated it.
      const existingDoc = await eventWikisCol().doc(wikiId).get();
      if (existingDoc.exists && !callerIsAdmin) {
        const owner = existingDoc.data()?.generatedByUid as string | undefined;
        if (owner !== ctx.user.uid) {
          throwApiError(
            'FORBIDDEN',
            'Only the universe owner or the original author can regenerate this wiki'
          );
        }
      }

      // Cost guard: Gemini 2.5 Pro on the server key. Fixed 1h window per user,
      // kept in a single doc so it needs no composite index.
      const rateRef = db.collection('wikiGenerationRate').doc(ctx.user.uid);
      const allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(rateRef);
        const now = Date.now();
        const d = snap.data() as { windowStart?: number; count?: number } | undefined;
        const fresh = !d?.windowStart || now - d.windowStart > 60 * 60 * 1000;
        const count = fresh ? 0 : (d?.count ?? 0);
        if (count >= MAX_WIKI_GENERATIONS_PER_HOUR) return false;
        tx.set(rateRef, { windowStart: fresh ? now : d!.windowStart, count: count + 1 });
        return true;
      });
      if (!allowed) {
        throwApiError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded: max ${MAX_WIKI_GENERATIONS_PER_HOUR} wiki generations per hour`
        );
      }

      try {
        let characterData = input.characters;
        if (!characterData && input.characterIds && input.characterIds.length > 0) {
          const charDocs = await Promise.all(
            input.characterIds.map((id) => charactersCol().doc(id).get())
          );
          characterData = charDocs
            .filter((doc) => doc.exists)
            .map((doc) => {
              const d = doc.data() as any;
              return {
                name: d.character_name,
                userDescription: d.description,
                visualDescription: d.detailed_visual_description || undefined,
              };
            });
        }

        const result = await geminiService.generateWikiFromVideo(input.videoUrl, {
          eventId: input.eventId,
          title: input.title,
          description: input.description,
          characterIds: input.characterIds,
          characters: characterData,
          previousEvents: input.previousEvents,
        });

        const wikiEntry = {
          universeId: normalizeUniverseId(input.universeId),
          generatedByUid: ctx.user.uid,
          eventId: input.eventId,
          wikiData: result.wikiData,
          videoUrl: input.videoUrl,
          eventTitle: input.title,
          eventDescription: input.description,
          characterIds: input.characterIds || null,
          generatedBy: result.metadata.generatedBy,
          tokensUsed: result.metadata.tokensUsed,
          inputTokens: result.metadata.inputTokens,
          outputTokens: result.metadata.outputTokens,
          costUsd: result.metadata.costUsd.toString(),
          generatedAt: new Date(),
          updatedAt: new Date(),
        };

        await eventWikisCol().doc(wikiId).set(wikiEntry, { merge: true });

        return {
          success: true,
          wikiId,
          wikiData: result.wikiData,
          metadata: result.metadata,
        };
      } catch (error) {
        throw wrapError(error, 'Wiki generation failed');
      }
    }),

  /** Get a wiki entry for a specific event. */
  getWiki: publicProcedure
    .input(z.object({ universeId: wikiKeyPart, eventId: wikiKeyPart }))
    .query(async ({ input, ctx }) => {
      const wikiId = `${normalizeUniverseId(input.universeId)}-${input.eventId}`;
      const doc = await eventWikisCol().doc(wikiId).get();

      if (!doc.exists) return null;

      const data = doc.data()!;
      // Generation cost/token telemetry is only for the universe's admins.
      const showCost =
        !!ctx.user?.address && (await isUniverseAdmin(input.universeId, ctx.user.address));
      return {
        id: doc.id,
        universeId: data.universeId as string,
        eventId: data.eventId as string,
        wikiData: data.wikiData as any,
        videoUrl: data.videoUrl as string | undefined,
        eventTitle: data.eventTitle as string | undefined,
        eventDescription: data.eventDescription as string | undefined,
        characterIds: data.characterIds as string[] | null,
        generatedBy: data.generatedBy as string | undefined,
        tokensUsed: showCost ? (data.tokensUsed as number | undefined) : undefined,
        inputTokens: showCost ? (data.inputTokens as number | undefined) : undefined,
        outputTokens: showCost ? (data.outputTokens as number | undefined) : undefined,
        costUsd: showCost ? (data.costUsd as string | undefined) : undefined,
        generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    }),

  /**
   * Get wiki entries for a universe. Previously read the whole
   * `universeId`-filtered set with no cap; now cursor-paginated (default 50,
   * opaque doc-id `cursor`) so a universe with thousands of event wikis can't
   * return everything in one request. `nextCursor` is null on the last page.
   */
  getUniverseWikis: publicProcedure
    .input(
      z.object({
        universeId: z.string().min(1).max(200),
        limit: z.number().int().positive().max(200).default(50),
        cursor: z
          .string()
          .max(200)
          .regex(/^[^/]+$/)
          .optional(),
      })
    )
    .query(async ({ input }) => {
      const col = eventWikisCol();
      let query: FirebaseFirestore.Query = col
        .where('universeId', '==', normalizeUniverseId(input.universeId))
        .orderBy('generatedAt', 'asc')
        .orderBy('__name__', 'asc');

      if (input.cursor) {
        const cursorDoc = await col.doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.limit(input.limit).get();
      const items = snapshot.docs.map((doc) => {
        const data = doc.data()!;
        return {
          id: doc.id,
          universeId: data.universeId as string,
          eventId: data.eventId as string,
          wikiData: data.wikiData as any,
          generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() ?? null,
        };
      });
      const nextCursor =
        snapshot.docs.length === input.limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

      return { items, nextCursor };
    }),

  /** Improve a user's video prompt using Gemini. */
  improveVideoPrompt: protectedProcedure
    .input(
      z.object({
        userPrompt: z.string().min(1, 'Prompt is required'),
        characterContext: z
          .array(z.object({ name: z.string(), description: z.string() }))
          .optional(),
        previousEventContext: z
          .object({
            title: z.string(),
            summary: z.string(),
            plot: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await geminiService.improveVideoPrompt(
          input.userPrompt,
          input.characterContext,
          input.previousEventContext
        );
      } catch (error) {
        throw wrapError(error, 'Prompt improvement failed');
      }
    }),

  /** Improve a user's image prompt using Gemini. */
  improveImagePrompt: protectedProcedure
    .input(
      z.object({
        userPrompt: z.string().min(1, 'Prompt is required'),
        characterContext: z
          .array(z.object({ name: z.string(), description: z.string() }))
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await geminiService.improveImagePrompt(input.userPrompt, input.characterContext);
      } catch (error) {
        throw wrapError(error, 'Prompt improvement failed');
      }
    }),

  /**
   * Director-mode shot expansion. Given a logline + optional style/character
   * notes, returns N shot descriptions ready to feed an image generator. Uses
   * OpenAI structured output so the response shape is guaranteed.
   */
  expandStoryboard: protectedProcedure
    .input(
      z.object({
        logline: z.string().min(1).max(2000),
        shotCount: z.number().int().min(2).max(12).default(6),
        styleNotes: z.string().max(500).optional(),
        characterNotes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { resolveProviderKey } = await import('../../lib/byok');
      const { openAIService } = await import('../../services/openai');
      const userKey = await resolveProviderKey(ctx.user.uid, 'openai');
      if (!userKey) {
        throw wrapError(
          new Error('OPENAI_API_KEY is not configured — set one in /settings/api-keys'),
          'Director mode requires an OpenAI key'
        );
      }
      const directorPrompt = [
        'You are a storyboard director. Break the following idea into a sequence of distinct visual shots.',
        `Number of shots: ${input.shotCount}.`,
        'Each shot prompt should: name the framing (wide / medium / close / over-shoulder / etc), the subject, the action, the lighting/mood, and a brief style hint. Keep each shot 25-60 words. Do not reference shot numbers in the prompt text.',
        input.styleNotes ? `Style notes (apply to every shot): ${input.styleNotes}` : '',
        input.characterNotes ? `Character notes: ${input.characterNotes}` : '',
        `Idea: ${input.logline}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      try {
        const result = await openAIService.chat({
          apiKey: userKey,
          model: 'gpt-4.1-mini',
          messages: [{ role: 'user', content: directorPrompt }],
          responseSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              shots: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    framing: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                  required: ['framing', 'prompt'],
                },
              },
            },
            required: ['shots'],
          },
          maxTokens: 2000,
        });
        const parsed = JSON.parse(result.text || '{}') as {
          shots?: Array<{ framing: string; prompt: string }>;
        };
        const shots = (parsed.shots ?? []).slice(0, input.shotCount);
        if (shots.length === 0) {
          throw new Error('Director returned no shots');
        }
        return { shots };
      } catch (error) {
        throw wrapError(error, 'Director-mode expansion failed');
      }
    }),
});
