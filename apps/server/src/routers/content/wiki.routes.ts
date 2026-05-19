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

const charactersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characters');
};
const eventWikisCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('eventWikis');
};

export const wikiRouter = router({
  /** List characters from the wiki database, optionally filtered by universe. */
  characters: publicProcedure
    .input(z.object({ universeId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const col = charactersCol();
        const query = input?.universeId ? col.where('universe_id', '==', input.universeId) : col;
        const snapshot = await query.get();
        const result = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        return {
          metadata: {
            version: '5.0',
            created_at: new Date().toISOString(),
            total_characters: result.length,
            last_updated: new Date().toISOString(),
          },
          characters: result.map((char: any) => ({
            id: char.id,
            character_name: char.character_name,
            collection: char.collection,
            token_id: char.token_id,
            traits: char.traits as Record<string, string>,
            rarity_rank: char.rarity_rank,
            rarity_percentage: char.rarity_percentage ? parseFloat(char.rarity_percentage) : 0,
            image_url: char.image_url,
            description: char.description,
            created_at: char.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          })),
        };
      } catch (error) {
        console.error('Failed to load characters from database:', error);
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
      traits: char.traits as Record<string, string>,
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
        title: z.string(),
        description: z.string(),
        videoUrl: z.string(),
        previousNodes: z.array(z.object({ title: z.string(), plot: z.string() })).optional(),
        nextNodes: z.array(z.object({ title: z.string(), plot: z.string() })).optional(),
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
        prompt: z.string().min(1, 'Prompt is required'),
        characters: z.array(z.string()).optional(),
        previousEvents: z
          .array(z.object({ title: z.string(), description: z.string() }))
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
        universeId: z.string(),
        eventId: z.string(),
        videoUrl: z.string(),
        title: z.string(),
        description: z.string(),
        characterIds: z.array(z.string()).optional(),
        characters: z
          .array(
            z.object({
              name: z.string(),
              userDescription: z.string(),
              visualDescription: z.string().optional(),
            })
          )
          .optional(),
        previousEvents: z
          .array(z.object({ title: z.string(), description: z.string() }))
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
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

        const wikiId = `${input.universeId}-${input.eventId}`;
        const wikiEntry = {
          universeId: input.universeId,
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
    .input(z.object({ universeId: z.string(), eventId: z.string() }))
    .query(async ({ input }) => {
      const wikiId = `${input.universeId}-${input.eventId}`;
      const doc = await eventWikisCol().doc(wikiId).get();

      if (!doc.exists) return null;

      const data = doc.data()!;
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
        tokensUsed: data.tokensUsed as number | undefined,
        inputTokens: data.inputTokens as number | undefined,
        outputTokens: data.outputTokens as number | undefined,
        costUsd: data.costUsd as string | undefined,
        generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    }),

  /** Get all wiki entries for a universe. */
  getUniverseWikis: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await eventWikisCol().where('universeId', '==', input.universeId).get();

      return snapshot.docs
        .map((doc) => {
          const data = doc.data()!;
          return {
            id: doc.id,
            universeId: data.universeId as string,
            eventId: data.eventId as string,
            wikiData: data.wikiData as any,
            generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() ?? null,
          };
        })
        .sort(
          (a, b) => new Date(a.generatedAt ?? 0).getTime() - new Date(b.generatedAt ?? 0).getTime()
        );
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
