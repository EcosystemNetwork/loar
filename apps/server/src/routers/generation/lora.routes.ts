/**
 * LoRA Training & Inference Router
 *
 * Character consistency via LoRA fine-tuning. Users upload reference images,
 * train a LoRA model on FAL (~5-10 min), then use it for consistent generation.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';

const loraModelsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('loraModels');
};

const trainingJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('loraTrainingJobs');
};

const TRAINING_COST_CREDITS = 75;

export const loraRouter = router({
  /** Start LoRA training for a character */
  startTraining: protectedProcedure
    .input(
      z.object({
        characterId: z.string(),
        universeId: z.string(),
        referenceImageUrls: z.array(z.string().url()).min(5).max(20),
        triggerWord: z
          .string()
          .min(1)
          .max(30)
          .regex(/^[a-zA-Z0-9_]+$/, 'Trigger word must be alphanumeric')
          .default('LOARCHAR'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check credits
      const creditsDoc = await db!.collection('userCredits').doc(ctx.user.uid).get();
      const balance = creditsDoc.exists ? creditsDoc.data()?.balance || 0 : 0;
      if (balance < TRAINING_COST_CREDITS) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient credits. Need ${TRAINING_COST_CREDITS}, have ${balance}`,
        });
      }

      // Create model record
      const modelRef = await loraModelsCol().add({
        characterId: input.characterId,
        universeId: input.universeId,
        creatorUid: ctx.user.uid,
        status: 'training',
        referenceImageUrls: input.referenceImageUrls,
        triggerWord: input.triggerWord,
        trainingStartedAt: new Date(),
        createdAt: new Date(),
      });

      // Kick off training via FAL
      try {
        const FAL_KEY = process.env.FAL_KEY;
        if (!FAL_KEY) {
          throw new Error('FAL_KEY not configured');
        }

        const response = await fetch('https://queue.fal.run/fal-ai/flux-lora-fast-training', {
          method: 'POST',
          headers: {
            Authorization: `Key ${FAL_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            images_data_url: input.referenceImageUrls.join('\n'),
            trigger_word: input.triggerWord,
            steps: 1000,
            is_style: false,
          }),
        });

        if (!response.ok) {
          throw new Error(`FAL API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        // Record training job
        await trainingJobsCol().add({
          loraModelId: modelRef.id,
          provider: 'fal',
          externalJobId: result.request_id || result.id,
          status: 'queued',
          createdAt: new Date(),
        });

        // Deduct credits
        await db!
          .collection('userCredits')
          .doc(ctx.user.uid)
          .update({
            balance: balance - TRAINING_COST_CREDITS,
          });

        return { modelId: modelRef.id, status: 'training' };
      } catch (err) {
        // Mark as failed if training kickoff fails
        await modelRef.update({ status: 'failed', error: (err as Error).message });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Training failed to start: ${(err as Error).message}`,
        });
      }
    }),

  /** Check training status (owner only) */
  getTrainingStatus: protectedProcedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ ctx, input }) => {
      const modelDoc = await loraModelsCol().doc(input.modelId).get();
      if (!modelDoc.exists) return null;

      const model = modelDoc.data();
      if (!model) return null;

      // Verify ownership
      if (model.creatorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your model' });
      }

      // If still training, check FAL status
      if (model.status === 'training') {
        const jobSnap = await trainingJobsCol()
          .where('loraModelId', '==', input.modelId)
          .limit(1)
          .get();

        if (!jobSnap.empty) {
          const job = jobSnap.docs[0].data();
          const FAL_KEY = process.env.FAL_KEY;

          if (FAL_KEY && job.externalJobId) {
            try {
              const statusRes = await fetch(
                `https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${job.externalJobId}/status`,
                { headers: { Authorization: `Key ${FAL_KEY}` } }
              );
              const status = await statusRes.json();

              if (status.status === 'COMPLETED') {
                // Get the result
                const resultRes = await fetch(
                  `https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${job.externalJobId}`,
                  { headers: { Authorization: `Key ${FAL_KEY}` } }
                );
                const result = await resultRes.json();

                await loraModelsCol()
                  .doc(input.modelId)
                  .update({
                    status: 'ready',
                    modelUrl: result.diffusers_lora_file?.url || result.config_file?.url,
                    trainingCompletedAt: new Date(),
                  });

                return {
                  ...model,
                  status: 'ready',
                  modelUrl: result.diffusers_lora_file?.url,
                };
              } else if (status.status === 'FAILED') {
                await loraModelsCol()
                  .doc(input.modelId)
                  .update({
                    status: 'failed',
                    error: status.error || 'Training failed',
                  });
                return { ...model, status: 'failed' };
              }
            } catch {
              // Polling failed — return current status
            }
          }
        }
      }

      return { id: modelDoc.id, ...model };
    }),

  /** Generate image using a trained LoRA model */
  generateWithLora: protectedProcedure
    .input(
      z.object({
        modelId: z.string(),
        prompt: z.string().min(1).max(1000),
        negativePrompt: z.string().max(500).optional(),
        width: z.number().min(256).max(2048).default(1024),
        height: z.number().min(256).max(2048).default(1024),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get the model
      const modelDoc = await loraModelsCol().doc(input.modelId).get();
      if (!modelDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'LoRA model not found' });
      }

      const model = modelDoc.data();
      if (!model) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'LoRA model data missing' });
      }
      if (model.creatorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this model' });
      }
      if (model.status !== 'ready') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Model not ready' });
      }

      // Check credits (3 credits per image)
      const creditsDoc = await db!.collection('userCredits').doc(ctx.user.uid).get();
      const balance = creditsDoc.exists ? creditsDoc.data()?.balance || 0 : 0;
      if (balance < 3) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient credits' });
      }

      const FAL_KEY = process.env.FAL_KEY;
      if (!FAL_KEY)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'FAL_KEY not set' });

      // Generate with LoRA
      const response = await fetch('https://fal.run/fal-ai/flux-lora', {
        method: 'POST',
        headers: {
          Authorization: `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: `${model.triggerWord} ${input.prompt}`,
          loras: [{ path: model.modelUrl, scale: 1.0 }],
          image_size: { width: input.width, height: input.height },
          num_images: 1,
        }),
      });

      const result = await response.json();

      // Deduct credits
      await db!
        .collection('userCredits')
        .doc(ctx.user.uid)
        .update({
          balance: balance - 3,
        });

      return {
        imageUrl: result.images?.[0]?.url,
        seed: result.seed,
      };
    }),

  /** List user's LoRA models */
  listModels: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await loraModelsCol()
      .where('creatorUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }),

  /** List LoRA models for a specific character */
  listByCharacter: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await loraModelsCol()
        .where('characterId', '==', input.characterId)
        .where('status', '==', 'ready')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
