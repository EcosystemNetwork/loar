/**
 * LoRA Training & Inference Router
 *
 * Character consistency via LoRA fine-tuning. Users upload reference images,
 * train a LoRA model on FAL (~5-10 min), then use it for consistent generation.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router, requirePermission } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { logFailedRefund } from '../../lib/refund-audit';

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
    .use(requirePermission('generation.image'))
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
      // Deduct credits transactionally BEFORE calling FAL
      const userCreditsRef = db!.collection('userCredits').doc(ctx.user.uid);
      await db!.runTransaction(async (tx) => {
        const doc = await tx.get(userCreditsRef);
        const balance = doc.exists ? doc.data()?.balance || 0 : 0;
        if (balance < TRAINING_COST_CREDITS) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Insufficient credits. Need ${TRAINING_COST_CREDITS}, have ${balance}`,
          });
        }
        tx.update(userCreditsRef, {
          balance: balance - TRAINING_COST_CREDITS,
          totalSpent: (doc.data()?.totalSpent || 0) + TRAINING_COST_CREDITS,
          updatedAt: new Date(),
        });
      });

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
          throw new Error(`FAL training request failed (${response.status})`);
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

        return { modelId: modelRef.id, status: 'training' };
      } catch (err) {
        // Refund credits atomically on failure
        await userCreditsRef.update({
          balance: FieldValue.increment(TRAINING_COST_CREDITS),
          totalSpent: FieldValue.increment(-TRAINING_COST_CREDITS),
          updatedAt: new Date(),
        });
        // Mark as failed
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
                // Refund training credits on FAL failure
                const alreadyRefunded = model.creditsRefunded === true;
                if (!alreadyRefunded) {
                  try {
                    await db!
                      .collection('userCredits')
                      .doc(ctx.user.uid)
                      .update({
                        balance: FieldValue.increment(TRAINING_COST_CREDITS),
                        totalSpent: FieldValue.increment(-TRAINING_COST_CREDITS),
                        updatedAt: new Date(),
                      });
                  } catch (refundErr) {
                    console.error(
                      `CRITICAL: LoRA training refund failed for ${ctx.user.uid}:`,
                      refundErr
                    );
                    await logFailedRefund({
                      userId: ctx.user.uid,
                      credits: TRAINING_COST_CREDITS,
                      source: 'lora.getTrainingStatus',
                      generationId: input.modelId,
                      error: refundErr instanceof Error ? refundErr.message : 'Unknown',
                    });
                  }
                }
                await loraModelsCol()
                  .doc(input.modelId)
                  .update({
                    status: 'failed',
                    creditsRefunded: true,
                    error: status.error || 'Training failed',
                  });
                return { ...model, status: 'failed', creditsRefunded: true };
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
    .use(requirePermission('generation.image'))
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
      const LORA_GEN_CREDITS = 3;

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

      // Deduct credits transactionally BEFORE generation
      const userCreditsRef = db!.collection('userCredits').doc(ctx.user.uid);
      await db!.runTransaction(async (tx) => {
        const doc = await tx.get(userCreditsRef);
        const balance = doc.exists ? doc.data()?.balance || 0 : 0;
        if (balance < LORA_GEN_CREDITS) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient credits' });
        }
        tx.update(userCreditsRef, {
          balance: balance - LORA_GEN_CREDITS,
          totalSpent: (doc.data()?.totalSpent || 0) + LORA_GEN_CREDITS,
          updatedAt: new Date(),
        });
      });

      const FAL_KEY = process.env.FAL_KEY;
      if (!FAL_KEY)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'FAL_KEY not set' });

      try {
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

        if (!response.ok) {
          throw new Error(`FAL generation failed (${response.status})`);
        }

        const result = await response.json();
        const imageUrl = result.images?.[0]?.url;
        if (!imageUrl) {
          throw new Error('FAL returned no image');
        }

        return {
          imageUrl,
          seed: result.seed,
        };
      } catch (err) {
        // Refund credits atomically on failure
        await userCreditsRef.update({
          balance: FieldValue.increment(LORA_GEN_CREDITS),
          totalSpent: FieldValue.increment(-LORA_GEN_CREDITS),
          updatedAt: new Date(),
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `LoRA generation failed: ${(err as Error).message}`,
        });
      }
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

  /** List LoRA models for a specific character (public — excludes sensitive fields) */
  listByCharacter: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await loraModelsCol()
        .where('characterId', '==', input.characterId)
        .where('status', '==', 'ready')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          characterId: data.characterId,
          universeId: data.universeId,
          triggerWord: data.triggerWord,
          status: data.status,
          createdAt: data.createdAt,
        };
      });
    }),
});
