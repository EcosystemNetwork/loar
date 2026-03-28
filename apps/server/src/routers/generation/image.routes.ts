/**
 * Image & Character Generation Router
 *
 * Handles image generation, image editing, image-to-image transforms,
 * and character creation/analysis via FAL and Gemini services.
 *
 * Extracted from the legacy fal.routes.ts to separate image generation
 * from the unified video generation router (generation.routes.ts).
 */
import { router, protectedProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { falService } from '../../services/fal';
import { db } from '../../lib/firebase';
import { geminiService } from '../../services/gemini';
import { wrapError } from '../../lib/errors';

const charactersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characters');
};

export const imageRouter = router({
  /** Generate an image using FAL models. */
  generateImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required'),
        model: z
          .enum(['fal-ai/nano-banana', 'fal-ai/flux/dev', 'fal-ai/flux-pro', 'fal-ai/flux/schnell'])
          .optional(),
        negativePrompt: z.string().optional(),
        imageSize: z
          .enum([
            'square_hd',
            'square',
            'portrait_4_3',
            'portrait_16_9',
            'landscape_4_3',
            'landscape_16_9',
          ])
          .optional(),
        numInferenceSteps: z.number().min(1).max(50).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        numImages: z.number().min(1).max(4).optional(),
        seed: z.number().optional(),
        enableSafetyChecker: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await falService.generateImage(input);
    }),

  /** Edit an existing image using FAL. */
  editImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Edit prompt is required'),
        imageUrls: z.array(z.string().url()).min(1),
        numImages: z.number().min(1).max(4).optional(),
        strength: z.number().min(0.1).max(1.0).optional(),
        negativePrompt: z.string().optional(),
        numInferenceSteps: z.number().min(1).max(50).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        seed: z.number().optional(),
        enableSafetyChecker: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await falService.editImage(input);
      } catch (error) {
        throw wrapError(error, 'Image editing failed');
      }
    }),

  /** Transform an image using image-to-image models. */
  imageToImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrls: z.array(z.string().url()).min(1).max(2),
        negativePrompt: z.string().max(500).optional(),
        imageSize: z
          .union([
            z.enum([
              'square_hd',
              'square',
              'portrait_4_3',
              'portrait_16_9',
              'landscape_4_3',
              'landscape_16_9',
            ]),
            z.object({
              width: z.number().min(384).max(5000),
              height: z.number().min(384).max(5000),
            }),
          ])
          .optional(),
        numImages: z.number().min(1).max(4).optional().default(1),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await falService.imageToImage(input);
      } catch (error) {
        throw wrapError(error, 'Image-to-image transform failed');
      }
    }),

  /** Generate a character image and optionally save to database. */
  generateCharacter: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        style: z.enum(['cute', 'realistic', 'anime', 'fantasy', 'cyberpunk']).optional(),
        saveToDatabase: z.boolean().optional().default(true),
        detailedVisualDescription: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const stylePrompts = {
        cute: 'cute kawaii style, adorable, soft colors',
        realistic: 'photorealistic, detailed, cinematic lighting',
        anime: 'anime style, manga aesthetic, vibrant',
        fantasy: 'fantasy art, magical, ethereal',
        cyberpunk: 'cyberpunk style, neon, futuristic',
      };

      const stylePrompt = input.style ? stylePrompts[input.style] : stylePrompts.cute;
      const fullPrompt = `Character portrait of ${input.name}, ${input.description}, ${stylePrompt}, high quality digital art, detailed character design, clean uniform background, no text, no letters, no words, simple background, character focus`;

      const imageResult = await falService.generateImage({
        prompt: fullPrompt,
        model: 'fal-ai/nano-banana',
        imageSize: 'square_hd',
        numImages: 1,
      });

      if (imageResult.status !== 'completed' || !imageResult.imageUrl) {
        throw new Error(imageResult.error || 'Failed to generate character image');
      }

      let characterId: string | undefined;
      let localImageUrl: string | undefined;

      if (input.saveToDatabase) {
        localImageUrl = imageResult.imageUrl;
        characterId = `nano-${Date.now()}-${randomUUID().slice(0, 8)}`;

        await charactersCol()
          .doc(characterId)
          .set({
            character_name: input.name,
            collection: 'Nano Banana AI',
            token_id: characterId,
            traits: {
              style: input.style || 'cute',
              generated_with: 'nano-banana',
              seed: imageResult.seed?.toString() || 'random',
            },
            rarity_rank: 0,
            rarity_percentage: null,
            image_url: localImageUrl,
            description: input.description,
            detailed_visual_description: input.detailedVisualDescription || null,
            created_at: new Date(),
            updated_at: new Date(),
          });
      }

      return {
        success: true,
        characterId,
        characterName: input.name,
        imageUrl: imageResult.imageUrl,
        localImageUrl,
        seed: imageResult.seed,
        prompt: fullPrompt,
      };
    }),

  /** Analyze a character image using Gemini for detailed visual description. */
  analyzeCharacter: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().min(1, 'Image URL is required'),
        characterName: z.string().min(1, 'Character name is required'),
        userDescription: z.string().min(1, 'Description is required'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const detailedDescription = await geminiService.analyzeCharacterImage(
          input.imageUrl,
          input.userDescription,
          input.characterName
        );
        return {
          success: true,
          characterName: input.characterName,
          detailedVisualDescription: detailedDescription,
        };
      } catch (error) {
        throw wrapError(error, 'Failed to analyze character image');
      }
    }),

  /** Save a character to the database. */
  saveCharacter: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Character name is required'),
        description: z.string().min(1, 'Description is required'),
        imageUrl: z.string().min(1, 'Image URL is required'),
        style: z.enum(['cute', 'realistic', 'anime', 'fantasy', 'cyberpunk']),
        detailedVisualDescription: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const characterId = `nano-${Date.now()}-${randomUUID().slice(0, 8)}`;

      await charactersCol()
        .doc(characterId)
        .set({
          character_name: input.name,
          collection: 'Nano Banana AI',
          token_id: characterId,
          traits: {
            style: input.style,
            generated_with: 'nano-banana',
          },
          rarity_rank: 0,
          rarity_percentage: null,
          image_url: input.imageUrl,
          description: input.description,
          detailed_visual_description: input.detailedVisualDescription || null,
          created_at: new Date(),
          updated_at: new Date(),
        });

      return {
        success: true,
        characterId,
        characterName: input.name,
        imageUrl: input.imageUrl,
      };
    }),
});
