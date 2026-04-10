/**
 * FAL AI router — tRPC procedures for image generation, video generation,
 * character creation, image editing, and Gemini-powered character analysis.
 *
 * @deprecated Prefer `generation.*` routes which enforce credit deduction.
 * These legacy routes now also deduct credits to prevent free generation.
 */
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { falService } from '../../services/fal';
import { db } from '../../lib/firebase';
import { geminiService } from '../../services/gemini';

// ── Credit costs for FAL routes (mirrors generation.routes.ts) ──────────
const FAL_CREDIT_COSTS = { image: 3, video: 13, character: 8, edit: 3 } as const;

/** Deduct credits from user balance. Throws if insufficient. */
async function deductCredits(uid: string, cost: number, generationType: string): Promise<void> {
  if (!db) return; // Skip in degraded mode (no Firestore)
  const userRef = db.collection('userCredits').doc(uid);
  const userDoc = await userRef.get();
  const balance = userDoc.data()?.balance || 0;

  if (balance < cost) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
    });
  }

  await userRef.update({
    balance: balance - cost,
    totalSpent: (userDoc.data()?.totalSpent || 0) + cost,
    updatedAt: new Date(),
  });

  await db.collection('creditTransactions').add({
    uid,
    type: 'spend',
    generationType,
    credits: -cost,
    source: 'fal_legacy',
    createdAt: new Date(),
  });
}

const charactersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characters');
};

const imageGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('imageGenerations');
};

const videoGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('videoGenerations');
};

/** Fire-and-forget save — never blocks the response */
function saveGenerationRecord(collection: 'image' | 'video', record: Record<string, any>) {
  const col = collection === 'image' ? imageGenerationsCol : videoGenerationsCol;
  try {
    col()
      .doc(record.id)
      .set(record)
      .catch((err: any) =>
        console.error(`Failed to save ${collection} generation record:`, err.message)
      );
  } catch {
    // db not configured — skip silently
  }
}

export const falRouter = router({
  testConnection: protectedProcedure.query(async () => {
    try {
      return {
        success: true,
        message: 'FAL service is available',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }),

  generateImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required'),
        model: z
          .enum([
            'fal-ai/nano-banana',
            'fal-ai/nano-banana-2',
            'fal-ai/nano-banana-pro',
            'fal-ai/flux/schnell',
            'fal-ai/flux/dev',
            'fal-ai/flux-pro',
            'fal-ai/flux-pro/v1.1',
            'fal-ai/flux-2-pro',
            'fal-ai/flux-pro/kontext',
            'fal-ai/recraft/v4/pro/text-to-image',
            'fal-ai/ideogram/v3/generate',
            'fal-ai/bytedance/seedream/v5/lite/edit',
            'fal-ai/gpt-image-1.5/edit',
            'fal-ai/wan/v2.7/text-to-image',
            'fal-ai/qwen-image',
          ])
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
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.image, 'image');
      const startTime = Date.now();
      const result = await falService.generateImage(input);
      if (result.status === 'failed') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Image generation failed',
        });
      }
      saveGenerationRecord('image', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: input.model || 'fal-ai/nano-banana',
        imageSize: input.imageSize || 'square_hd',
        status: 'completed',
        imageUrls: result.images?.map((i) => i.url) || (result.imageUrl ? [result.imageUrl] : []),
        seed: result.seed ?? null,
        source: 'fal.generateImage',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

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
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.edit, 'image_edit');
      const startTime = Date.now();
      const result = await falService.editImage(input);
      if (result.status === 'failed') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Image editing failed',
        });
      }
      saveGenerationRecord('image', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/nano-banana/edit',
        task: 'image_to_image',
        status: 'completed',
        imageUrls: result.images?.map((i) => i.url) || (result.imageUrl ? [result.imageUrl] : []),
        seed: result.seed ?? null,
        source: 'fal.editImage',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

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
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.edit, 'image_to_image');
      const startTime = Date.now();
      const result = await falService.imageToImage(input);
      if (result.status === 'failed') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Image-to-image failed',
        });
      }
      saveGenerationRecord('image', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/nano-banana/edit',
        task: 'image_to_image',
        status: 'completed',
        imageUrls: result.images?.map((i) => i.url) || (result.imageUrl ? [result.imageUrl] : []),
        seed: result.seed ?? null,
        source: 'fal.imageToImage',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

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
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.character, 'character');
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
        console.error('Character analysis failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to analyze character image'
        );
      }
    }),

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

      try {
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
      } catch (dbError) {
        console.error('Database insert failed:', dbError);
        throw new Error(
          dbError instanceof Error ? dbError.message : 'Failed to save character to database'
        );
      }
    }),

  generateCharacterAndVideo: protectedProcedure
    .input(
      z.object({
        characterName: z.string().min(1),
        characterDescription: z.string().min(1),
        characterStyle: z.enum(['cute', 'realistic', 'anime', 'fantasy', 'cyberpunk']).optional(),
        videoPrompt: z.string().min(1),
        videoDuration: z.number().min(5).max(10).optional(),
        videoProvider: z.enum(['fal']).optional().default('fal'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Character image + video generation
      await deductCredits(
        ctx.user.uid,
        FAL_CREDIT_COSTS.character + FAL_CREDIT_COSTS.video,
        'character_and_video'
      );
      const stylePrompts = {
        cute: 'cute kawaii style, adorable, soft colors',
        realistic: 'photorealistic, detailed, cinematic lighting',
        anime: 'anime style, manga aesthetic, vibrant',
        fantasy: 'fantasy art, magical, ethereal',
        cyberpunk: 'cyberpunk style, neon, futuristic',
      };
      const stylePrompt = input.characterStyle
        ? stylePrompts[input.characterStyle]
        : stylePrompts.cute;
      const characterPrompt = `Character portrait of ${input.characterName}, ${input.characterDescription}, ${stylePrompt}, high quality digital art`;

      const imageResult = await falService.generateImage({
        prompt: characterPrompt,
        model: 'fal-ai/nano-banana',
        imageSize: 'square_hd',
        numImages: 1,
      });

      if (imageResult.status !== 'completed' || !imageResult.imageUrl) {
        throw new Error(imageResult.error || 'Failed to generate character image');
      }

      const characterId = `nano-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const localImageUrl = imageResult.imageUrl;

      await charactersCol()
        .doc(characterId)
        .set({
          character_name: input.characterName,
          collection: 'Nano Banana AI',
          token_id: characterId,
          traits: {
            style: input.characterStyle || 'cute',
            generated_with: 'nano-banana',
            seed: imageResult.seed?.toString() || 'random',
          },
          rarity_rank: 0,
          rarity_percentage: null,
          image_url: localImageUrl,
          description: input.characterDescription,
          created_at: new Date(),
          updated_at: new Date(),
        });

      const videoResult = await falService.generateVideo({
        prompt: input.videoPrompt,
        model: 'fal-ai/veo3.1/fast/image-to-video',
        imageUrl: imageResult.imageUrl,
        duration: input.videoDuration || 5,
        aspectRatio: '16:9',
        motionStrength: 127,
      });

      return {
        success: true,
        character: {
          id: characterId,
          name: input.characterName,
          imageUrl: imageResult.imageUrl,
          localImageUrl,
        },
        video: {
          generationId: videoResult.id,
          status: videoResult.status,
          provider: input.videoProvider,
        },
      };
    }),

  generateVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        model: z
          .enum([
            // Text-to-Video
            'fal-ai/hunyuan-video',
            'fal-ai/ltx-video',
            'fal-ai/cogvideox-5b',
            'fal-ai/runway-gen3',
            'fal-ai/veo3.1/fast',
            'fal-ai/veo3.1',
            'fal-ai/veo3.1/lite',
            'fal-ai/sora-2/text-to-video',
            'fal-ai/sora-2/text-to-video/pro',
            'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
            'fal-ai/wan-25-preview/text-to-video',
            'fal-ai/wan/v2.7/text-to-video',
            'fal-ai/pixverse/v6/text-to-video',
            // Image-to-Video
            'fal-ai/veo3.1/fast/image-to-video',
            'fal-ai/veo3.1/image-to-video',
            'fal-ai/veo3.1/lite/image-to-video',
            'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
            'fal-ai/kling-video/v3/pro/image-to-video',
            'fal-ai/wan-25-preview/image-to-video',
            'fal-ai/wan/v2.7/image-to-video',
            'fal-ai/sora-2/image-to-video',
            'fal-ai/sora-2/image-to-video/pro',
            'fal-ai/pixverse/v6/image-to-video',
            // Seedance 2.0
            'bytedance/seedance-2.0/text-to-video',
            'bytedance/seedance-2.0/image-to-video',
            'bytedance/seedance-2.0/fast/text-to-video',
            'bytedance/seedance-2.0/fast/image-to-video',
            'bytedance/seedance-2.0/reference-to-video',
            'bytedance/seedance-2.0/fast/reference-to-video',
          ])
          .optional(),
        imageUrl: z.string().url().optional(),
        duration: z.number().min(1).max(20).optional(),
        fps: z.number().min(8).max(30).optional(),
        width: z.number().min(256).max(1920).optional(),
        height: z.number().min(256).max(1080).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        numInferenceSteps: z.number().min(10).max(50).optional(),
        aspectRatio: z.enum(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'auto']).optional(),
        motionStrength: z.number().min(1).max(255).optional(),
        negativePrompt: z.string().optional(),
        cfgScale: z.number().min(0.1).max(2.0).optional(),
        resolution: z.enum(['480p', '720p', '1080p', 'auto']).optional(),
        enablePromptExpansion: z.boolean().optional(),
        generateAudio: z.boolean().optional(),
        endImageUrl: z.string().url().optional(),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.video, 'video');
      const startTime = Date.now();
      const result = await falService.generateVideo(input);
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Video generation failed');
      }
      saveGenerationRecord('video', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: input.model || 'fal-ai/ltx-video',
        mode: input.imageUrl ? 'image_to_video' : 'text_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration ?? null,
        aspectRatio: input.aspectRatio ?? null,
        resolution: input.resolution ?? null,
        source: 'fal.generateVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

  getStatus: publicProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    return await falService.getGenerationStatus(input.id);
  }),

  quickGenerate: protectedProcedure
    .input(z.object({ prompt: z.string().min(1), imageUrl: z.string().url().optional() }))
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.video, 'video_quick');
      const startTime = Date.now();
      const result = await falService.generateVideo({
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        model: 'fal-ai/ltx-video',
        duration: 5,
        fps: 25,
        width: 768,
        height: 512,
        guidanceScale: 3,
        numInferenceSteps: 30,
      });
      if (result.status !== 'failed') {
        saveGenerationRecord('video', {
          id: result.id || randomUUID(),
          userId: ctx.user?.uid || 'anonymous',
          prompt: input.prompt,
          model: 'fal-ai/ltx-video',
          mode: input.imageUrl ? 'image_to_video' : 'text_to_video',
          status: result.status,
          videoUrl: result.videoUrl,
          source: 'fal.quickGenerate',
          latencyMs: Date.now() - startTime,
          createdAt: new Date(),
        });
      }
      return result;
    }),

  veo3ImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        imageUrl: z.string().url(),
        duration: z
          .union([z.literal(5), z.literal(10)])
          .optional()
          .default(5),
        aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional().default('16:9'),
        motionStrength: z.number().min(1).max(255).optional().default(127),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.video, 'video_veo3');
      const startTime = Date.now();
      const result = await falService.generateVideo({
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        model: 'fal-ai/veo3.1/fast/image-to-video',
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        motionStrength: input.motionStrength,
      });
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Veo3 video generation failed');
      }
      saveGenerationRecord('video', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/veo3.1/fast/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        source: 'fal.veo3ImageToVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

  klingVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        imageUrl: z.string().url(),
        duration: z
          .union([z.literal(5), z.literal(10)])
          .optional()
          .default(5),
        aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional().default('16:9'),
        negativePrompt: z.string().optional(),
        cfgScale: z.number().min(0.1).max(2.0).optional().default(0.5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.video, 'video_kling');
      const startTime = Date.now();
      const result = await falService.generateVideo({
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        negativePrompt: input.negativePrompt,
        cfgScale: input.cfgScale,
      });
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Kling video generation failed');
      }
      saveGenerationRecord('video', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        source: 'fal.klingVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

  wan25ImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        imageUrl: z.string().url(),
        duration: z
          .union([z.literal(5), z.literal(10)])
          .optional()
          .default(5),
        resolution: z.enum(['720p', '1080p', 'auto']).optional().default('1080p'),
        negativePrompt: z.string().optional(),
        enablePromptExpansion: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.video, 'video_wan25');
      const startTime = Date.now();
      const result = await falService.generateVideo({
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        model: 'fal-ai/wan-25-preview/image-to-video',
        duration: input.duration,
        resolution: input.resolution,
        negativePrompt: input.negativePrompt,
        enablePromptExpansion: input.enablePromptExpansion,
      });
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Wan25 video generation failed');
      }
      saveGenerationRecord('video', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/wan-25-preview/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        resolution: input.resolution,
        source: 'fal.wan25ImageToVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),

  soraImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required for Sora video generation'),
        imageUrl: z.string().url('Valid image URL is required for Sora image-to-video'),
        duration: z
          .union([z.literal(4), z.literal(8), z.literal(12)])
          .optional()
          .default(4),
        aspectRatio: z.enum(['16:9', '9:16', '1:1', 'auto']).optional().default('auto'),
        resolution: z.enum(['720p', '1080p', 'auto']).optional().default('auto'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, FAL_CREDIT_COSTS.video, 'video_sora');
      const startTime = Date.now();
      const result = await falService.generateVideo({
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        model: 'fal-ai/sora-2/image-to-video',
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
      });
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Sora video generation failed');
      }
      saveGenerationRecord('video', {
        id: result.id || randomUUID(),
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/sora-2/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        source: 'fal.soraImageToVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      return result;
    }),
});
