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
  /** List all characters from the wiki database. Falls back to JSON file. */
  characters: publicProcedure.query(async () => {
    try {
      const snapshot = await charactersCol().get();
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
    .mutation(async ({ input }) => {
      try {
        return await wikiaService.generateWikiaEntry(
          input.nodeId,
          input.title,
          input.description,
          input.videoUrl,
          input.previousNodes,
          input.nextNodes
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
    .mutation(async ({ input }) => {
      try {
        return await wikiaService.generateStorylineFromPrompt(
          input.prompt,
          input.characters || [],
          input.previousEvents
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
      const snapshot = await eventWikisCol()
        .where('universeId', '==', input.universeId)
        .orderBy('generatedAt')
        .get();

      return snapshot.docs.map((doc) => {
        const data = doc.data()!;
        return {
          id: doc.id,
          universeId: data.universeId as string,
          eventId: data.eventId as string,
          wikiData: data.wikiData as any,
          generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() ?? null,
        };
      });
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
});
