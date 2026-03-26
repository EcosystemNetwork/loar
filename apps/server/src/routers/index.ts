import {
  protectedProcedure, publicProcedure,
  router,
} from "../lib/trpc";
import { readFileSync } from "fs";
import { join } from "path";
import { db } from "../lib/firebase";
import { z } from "zod";

import { falService } from "../services/fal";

import { cinematicUniversesRouter } from "./cinematicUniverses/cinematicUniverses.index";
import { falRouter } from "./fal/fal.routes";
import { storageRouter } from "./storage/storage.routes";
import { getSynapseService } from "../services/synapse";
import { wikiaService } from "../services/wikia";
import { minioService } from "../services/minio";
import { geminiService } from "../services/gemini";

const charactersCol = db.collection("characters");
const eventWikisCol = db.collection("eventWikis");

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: { uid: ctx.user.uid, email: ctx.user.email },
    };
  }),
  cinematicUniverses: cinematicUniversesRouter,
  fal: falRouter,
  storage: storageRouter,
  wiki: router({
    characters: publicProcedure.query(async () => {
      try {
        const snapshot = await charactersCol.get();
        const result = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        return {
          metadata: {
            version: "5.0",
            created_at: new Date().toISOString(),
            total_characters: result.length,
            last_updated: new Date().toISOString()
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
            created_at: char.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString()
          }))
        };
      } catch (error) {
        console.error("Failed to load characters from database:", error);
        try {
          const wikiPath = join(process.cwd(), "../character-wiki/simple_character_wiki.json");
          const wikiData = readFileSync(wikiPath, "utf-8");
          return JSON.parse(wikiData);
        } catch (fileError) {
          console.error("Failed to load character wiki file:", fileError);
          throw new Error("Could not load character data");
        }
      }
    }),
    character: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        try {
          const doc = await charactersCol.doc(input.id).get();
          if (!doc.exists) {
            throw new Error("Character not found");
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
            created_at: char.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString()
          };
        } catch (error) {
          console.error("Failed to load character from database:", error);
          throw new Error("Could not load character");
        }
      }),
    generateEventWikia: protectedProcedure
      .input(z.object({
        nodeId: z.number(),
        title: z.string(),
        description: z.string(),
        videoUrl: z.string(),
        previousNodes: z.array(z.object({
          title: z.string(),
          plot: z.string(),
        })).optional(),
        nextNodes: z.array(z.object({
          title: z.string(),
          plot: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const wikiaEntry = await wikiaService.generateWikiaEntry(
            input.nodeId,
            input.title,
            input.description,
            input.videoUrl,
            input.previousNodes,
            input.nextNodes
          );
          return wikiaEntry;
        } catch (error) {
          console.error("Failed to generate wikia entry:", error);
          throw new Error("Could not generate wikia entry");
        }
      }),
    generateStoryline: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1, "Prompt is required"),
        characters: z.array(z.string()).optional(),
        previousEvents: z.array(z.object({
          title: z.string(),
          description: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const result = await wikiaService.generateStorylineFromPrompt(
            input.prompt,
            input.characters || [],
            input.previousEvents
          );
          return result;
        } catch (error) {
          console.error("Failed to generate storyline:", error);
          throw new Error("Could not generate storyline");
        }
      }),

    generateFromVideo: protectedProcedure
      .input(z.object({
        universeId: z.string(),
        eventId: z.string(),
        videoUrl: z.string(),
        title: z.string(),
        description: z.string(),
        characterIds: z.array(z.string()).optional(),
        characters: z.array(z.object({
          name: z.string(),
          userDescription: z.string(),
          visualDescription: z.string().optional(),
        })).optional(),
        previousEvents: z.array(z.object({
          title: z.string(),
          description: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          console.log(`Generating wiki for ${input.universeId}-${input.eventId}`);

          let characterData = input.characters;
          if (!characterData && input.characterIds && input.characterIds.length > 0) {
            console.log(`Fetching character data for IDs: ${input.characterIds.join(', ')}`);
            const charDocs = await Promise.all(
              input.characterIds.map((id) => charactersCol.doc(id).get())
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
            console.log(`Fetched ${characterData.length} characters`);
          }

          const result = await geminiService.generateWikiFromVideo(
            input.videoUrl,
            {
              eventId: input.eventId,
              title: input.title,
              description: input.description,
              characterIds: input.characterIds,
              characters: characterData,
              previousEvents: input.previousEvents,
            }
          );

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

          // Firestore set with merge acts as upsert
          await eventWikisCol.doc(wikiId).set(wikiEntry, { merge: true });

          console.log(`Wiki saved to database: ${wikiId}`);

          return {
            success: true,
            wikiId,
            wikiData: result.wikiData,
            metadata: result.metadata,
          };
        } catch (error) {
          console.error("Failed to generate wiki:", error);
          throw new Error(`Wiki generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),

    getWiki: publicProcedure
      .input(z.object({
        universeId: z.string(),
        eventId: z.string(),
      }))
      .query(async ({ input }) => {
        try {
          const wikiId = `${input.universeId}-${input.eventId}`;
          const doc = await eventWikisCol.doc(wikiId).get();

          if (!doc.exists) {
            return null;
          }

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
        } catch (error) {
          console.error("Failed to fetch wiki:", error);
          throw new Error("Could not fetch wiki");
        }
      }),

    getUniverseWikis: publicProcedure
      .input(z.object({
        universeId: z.string(),
      }))
      .query(async ({ input }) => {
        try {
          const snapshot = await eventWikisCol
            .where("universeId", "==", input.universeId)
            .orderBy("generatedAt")
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
        } catch (error) {
          console.error("Failed to fetch universe wikis:", error);
          throw new Error("Could not fetch universe wikis");
        }
      }),

    improveVideoPrompt: protectedProcedure
      .input(z.object({
        userPrompt: z.string().min(1, "Prompt is required"),
        characterContext: z.array(z.object({
          name: z.string(),
          description: z.string(),
        })).optional(),
        previousEventContext: z.object({
          title: z.string(),
          summary: z.string(),
          plot: z.string().optional(),
        }).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const result = await geminiService.improveVideoPrompt(
            input.userPrompt,
            input.characterContext,
            input.previousEventContext
          );
          return result;
        } catch (error) {
          console.error("Failed to improve prompt:", error);
          throw new Error(`Prompt improvement failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),
  }),
  video: router({
    generateWithProvider: protectedProcedure
      .input(z.object({
        provider: z.enum(['fal']),
        prompt: z.string().min(1, "Prompt is required"),
        duration: z.enum(['5s', '10s']).optional(),
        imageUrl: z.string().url().optional(),
      }))
      .mutation(async ({ input }) => {
        const duration = input.duration === '10s' ? 10 : 5;
        const result = await falService.generateVideo({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          duration,
          model: 'fal-ai/ltx-video'
        });

        return {
          id: result.id,
          status: result.status === 'completed' ? 'completed' :
                 result.status === 'in_progress' ? 'dreaming' :
                 result.status === 'failed' ? 'failed' : 'pending',
          videoUrl: result.videoUrl,
          failureReason: result.error
        };
      }),
  }),
  minio: router({
    uploadFromUrl: protectedProcedure
      .input(z.object({
        url: z.string().min(1, "URL is required"),
        filename: z.string().optional()
      }))
      .mutation(async ({ input}) => {
        try {
          console.log(`MinIO S3 upload for ${input.url}`)
          const result = await minioService.uploadFromUrl(input.url, input.filename)
          console.log(`MinIO S3 upload successful - key:`, result)

          return {
            key: result,
            url: minioService.getPublicUrl(result)
          };
        } catch (error) {
          console.error("MinIO upload error:", error)
          throw error
        }
      }),
    download: publicProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        try {
          const data = await minioService.download(input.key);

          if (data.length > 5 * 1024 * 1024) {
            throw new Error(`File too large for tRPC: ${Math.round(data.length / 1024 / 1024)}MB (max 5MB). Use public URL instead.`);
          }

          const base64Data = Buffer.from(data).toString('base64');

          return {
            data: base64Data,
            key: input.key,
            originalSize: data.length,
            encodedSize: base64Data.length
          };
        } catch (error) {
          console.error(`Failed to download key ${input.key}:`, error);
          throw new Error(`Failed to download from MinIO: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),
    getPublicUrl: publicProcedure
      .input(z.object({ key: z.string() }))
      .query(({ input }) => {
        return { url: minioService.getPublicUrl(input.key) };
      }),
  }),
  synapse: router({
    uploadFromUrl: protectedProcedure
      .input(z.object({
        url: z.string().min(1, "URL is required")
      }))
      .mutation(async ({ input}) => {
        try {
          console.log(`Filecoin Synapse upload for ${input.url}`)
          const service = await getSynapseService();
          const result = await service.uploadFromUrl(input.url)
          console.log(`Filecoin Synapse successful - result:`, JSON.stringify(result))
          return result;
        } catch (error) {
          console.error("Synapse upload error:", error)
          throw error
        }
      }),
    download: publicProcedure
      .input(z.object({ pieceCid: z.string() }))
      .query(async ({ input }) => {
        try {
          const service = await getSynapseService();
          const data = await service.download(input.pieceCid);

          if (data.length > 5 * 1024 * 1024) {
            throw new Error(`File too large for tRPC: ${Math.round(data.length / 1024 / 1024)}MB (max 5MB). Use HTTP gateway instead.`);
          }

          const base64Data = Buffer.from(data).toString('base64');

          return {
            data: base64Data,
            pieceCid: input.pieceCid,
            originalSize: data.length,
            encodedSize: base64Data.length
          };
        } catch (error) {
          console.error(`Failed to download PieceCID ${input.pieceCid}:`, error);
          throw new Error(`Failed to download from Filecoin: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),
    getHttpUrl: publicProcedure
      .input(z.object({ pieceCid: z.string() }))
      .query(({ input }) => {
        const baseUrl = process.env.NODE_ENV === 'production'
          ? 'https://your-domain.com'
          : 'http://localhost:3000';
        return { url: `${baseUrl}/api/filecoin/${input.pieceCid}` };
      }),
  }),
});
export type AppRouter = typeof appRouter;
