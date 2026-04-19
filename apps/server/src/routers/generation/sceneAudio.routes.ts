/**
 * Scene Audio Pipeline Router
 *
 * Reusable audio pipeline for any universe timeline — adds voices, SFX,
 * background music, and lip-sync to video scenes.
 *
 * Capabilities:
 *   sceneAudio.designVoice     — Create a voice profile for a cast member
 *   sceneAudio.generateDialogue — TTS dialogue for a scene
 *   sceneAudio.generateSFX      — Sound effects for a scene
 *   sceneAudio.generateMusic    — Background music for a scene or segment
 *   sceneAudio.lipSync          — Lip-sync video to dialogue audio
 *   sceneAudio.compositeScene   — Mix all audio layers onto a video
 *   sceneAudio.processTimeline  — Full pipeline: dialogue + SFX + music + lipsync + composite for a sequence of scenes
 *   sceneAudio.getVoiceProfiles — List voice profiles for a universe
 *   sceneAudio.getHistory       — Audio pipeline history for a universe
 *
 * Pricing:
 *   Voice design:    8 credits
 *   Dialogue TTS:    variable (per character count)
 *   SFX:             8 credits
 *   Music:           6 credits
 *   Lip-sync:        5 credits
 *   Composite:       2 credits
 *   Full pipeline:   sum of above per scene
 */
import { router, protectedProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { elevenLabsService } from '../../services/elevenlabs';
import { falService } from '../../services/fal';
import { lipSyncService } from '../../services/lipsync';
import { firebaseStorageService } from '../../services/firebase-storage';
import { trackQuests } from '../../services/quest-tracker';
import { logFailedRefund } from '../../lib/refund-audit';
import { sanitizePrompt } from '../../lib/prompt-sanitize';

// ── Pricing ─────────────────────────────────────────────────────────────

import { getPlatformConfig } from '../../services/platformConfig';

const LOAR_TO_USD = 0.01;
const SFX_COST_USD = 0.08;
const MUSIC_COST_USD = 0.04;
const VOICE_DESIGN_COST_USD = 0.08;
const LIPSYNC_COST_USD = 0.05;
const COMPOSITE_COST_USD = 0.02;
const TTS_COST_PER_CHAR_USD = 0.00004; // eleven_v3 rate

async function getMargins() {
  const cfg = await getPlatformConfig();
  return { fiatMargin: cfg.fiatMargin, loarMargin: cfg.loarMargin };
}
function withFiat(usd: number, fiatMargin = 1.35) {
  return Math.round(usd * fiatMargin * 100) / 100;
}
function toCredits(usd: number, fiatMargin = 1.35) {
  return Math.ceil(withFiat(usd, fiatMargin) / LOAR_TO_USD);
}

// ── Collections ─────────────────────────────────────────────────────────

const voiceProfilesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('voiceProfiles');
};

const sceneAudioCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('sceneAudioJobs');
};

const soundNodesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('soundNodes');
};

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

// ── Credit helpers ──────────────────────────────────────────────────────

async function deductCredits(userId: string, credits: number): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(userId, credits);
  const ref = userCreditsCol().doc(userId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new Error(
        `Insufficient credits. Need ${credits}, have ${balance}. Purchase more to continue.`
      );
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(userId: string, credits: number, jobId?: string): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  const { recordCreditsTx, recordAiGeneration } = await import('../../lib/metrics');
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
    recordCreditsTx('refund', 'success');
  } catch (err) {
    recordCreditsTx('refund', 'failure');
    console.error(`CRITICAL: Scene audio credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'sceneAudio',
      generationId: jobId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
  recordAiGeneration('elevenlabs', 'sceneAudio', 'failure');
}

// ── Upload helper ───────────────────────────────────────────────────────

async function uploadAudioBuffer(buffer: Buffer, filename: string): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, `scene-audio-${filename}`);
  // upload() returns a storage key — convert to a playable public URL
  return firebaseStorageService.getPublicUrl(key);
}

// ── Schemas ─────────────────────────────────────────────────────────────

const dialogueLineSchema = z.object({
  speaker: z.string().min(1),
  text: z.string().min(1).max(5000),
  voiceProfileId: z.string().min(1),
});

const sceneInputSchema = z.object({
  sceneId: z.string().min(1),
  title: z.string().min(1).max(200),
  videoUrl: z.string().url(),
  dialogue: z.array(dialogueLineSchema).default([]),
  sfxDescription: z.string().max(500).optional(),
  musicPrompt: z.string().max(500).optional(),
  musicDurationSec: z.number().min(5).max(47).default(10),
  hasFaces: z.boolean().default(true),
  skipLipsync: z.boolean().default(false),
});

// ── Router ──────────────────────────────────────────────────────────────

export const sceneAudioRouter = router({
  /**
   * Design a voice profile for a character in a universe.
   * Saves to Firestore for reuse across scenes and sessions.
   */
  designVoice: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        characterName: z.string().min(1).max(100),
        description: z.string().min(10).max(500),
        gender: z.enum(['male', 'female', 'neutral']),
        age: z.enum(['young', 'middle_aged', 'old']),
        accent: z.string().default('american'),
        accentStrength: z.number().min(0.3).max(2.0).default(1.0),
        previewText: z.string().min(10).max(500),
        /** Voice personality tuning */
        stability: z.number().min(0).max(1).default(0.5),
        style: z.number().min(0).max(1).default(0.3),
        /** Optional: link to a cast member entity */
        castMemberId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin } = await getMargins();
      const credits = toCredits(VOICE_DESIGN_COST_USD, fiatMargin);
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      try {
        const result = await elevenLabsService.designVoice({
          name: `${input.characterName} - ${input.universeId}`,
          description: input.description,
          gender: input.gender,
          age: input.age,
          accent: input.accent,
          accentStrength: input.accentStrength,
          text: input.previewText,
        });

        // Upload preview audio
        let previewUrl: string | undefined;
        if (result.audioBuffer.length > 0) {
          previewUrl = await uploadAudioBuffer(result.audioBuffer, `voice-preview/${jobId}.mp3`);
        }

        // Save voice profile to Firestore
        const profile = {
          id: jobId,
          universeId: input.universeId,
          characterName: input.characterName,
          voiceId: result.voiceId,
          description: input.description,
          gender: input.gender,
          age: input.age,
          accent: input.accent,
          stability: input.stability,
          style: input.style,
          previewUrl,
          castMemberId: input.castMemberId || null,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
        };

        await voiceProfilesCol().doc(jobId).set(profile);

        return { id: jobId, voiceId: result.voiceId, previewUrl, credits };
      } catch (err) {
        await refundCredits(ctx.user.uid, credits, jobId);
        throw err;
      }
    }),

  /**
   * List voice profiles for a universe.
   */
  getVoiceProfiles: protectedProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input }) => {
      const snap = await voiceProfilesCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /**
   * Delete a voice profile.
   */
  deleteVoiceProfile: protectedProcedure
    .input(z.object({ profileId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const ref = voiceProfilesCol().doc(input.profileId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Voice profile not found');
      if (doc.data()?.createdBy !== ctx.user.uid) {
        throw new Error('Not authorized to delete this voice profile');
      }
      await ref.delete();
      return { deleted: true };
    }),

  /**
   * Preview a voice profile with custom text (on-demand TTS sample).
   * No credits charged — uses short preview text.
   */
  previewVoice: protectedProcedure
    .input(
      z.object({
        profileId: z.string().min(1),
        text: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ input }) => {
      const doc = await voiceProfilesCol().doc(input.profileId).get();
      if (!doc.exists) throw new Error('Voice profile not found');
      const profile = doc.data()!;

      const result = await elevenLabsService.textToSpeech({
        text: sanitizePrompt(input.text),
        voiceId: profile.voiceId,
        modelId: 'eleven_v3',
        stability: profile.stability ?? 0.5,
        similarityBoost: 0.75,
        style: profile.style ?? 0.3,
      });

      const audioUrl = await uploadAudioBuffer(
        result.audioBuffer,
        `voice-preview/${input.profileId}-${Date.now()}.mp3`
      );

      return { audioUrl };
    }),

  /**
   * Generate dialogue TTS for a scene's dialogue lines.
   * Returns a single merged audio file URL.
   */
  generateDialogue: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        sceneId: z.string().min(1),
        dialogue: z.array(dialogueLineSchema).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Look up voice profiles
      const profileIds = [...new Set(input.dialogue.map((d) => d.voiceProfileId))];
      const profileDocs = await Promise.all(
        profileIds.map((id) => voiceProfilesCol().doc(id).get())
      );
      const profiles: Record<string, any> = {};
      for (const doc of profileDocs) {
        if (doc.exists) profiles[doc.id] = doc.data();
      }

      // Calculate cost based on total character count
      const totalChars = input.dialogue.reduce((sum, d) => sum + d.text.length, 0);
      const costUsd = totalChars * TTS_COST_PER_CHAR_USD;
      const { fiatMargin } = await getMargins();
      const credits = Math.max(2, toCredits(costUsd, fiatMargin));
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      try {
        const audioBuffers: Buffer[] = [];

        for (const line of input.dialogue) {
          const profile = profiles[line.voiceProfileId];
          if (!profile) {
            throw new Error(`Voice profile ${line.voiceProfileId} not found`);
          }

          const result = await elevenLabsService.textToSpeech({
            text: sanitizePrompt(line.text),
            voiceId: profile.voiceId,
            modelId: 'eleven_v3',
            stability: profile.stability ?? 0.5,
            similarityBoost: 0.75,
            style: profile.style ?? 0.3,
            useSpeakerBoost: true,
          });

          audioBuffers.push(result.audioBuffer);
          // Small silence gap between lines
          audioBuffers.push(Buffer.alloc(8820));
        }

        const merged = Buffer.concat(audioBuffers);
        const audioUrl = await uploadAudioBuffer(
          merged,
          `dialogue/${input.universeId}/${input.sceneId}-${jobId}.mp3`
        );

        // Record job
        await sceneAudioCol().doc(jobId).set({
          id: jobId,
          type: 'dialogue',
          universeId: input.universeId,
          sceneId: input.sceneId,
          audioUrl,
          dialogueCount: input.dialogue.length,
          totalChars,
          credits,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
        });

        return { id: jobId, audioUrl, credits, totalChars };
      } catch (err) {
        await refundCredits(ctx.user.uid, credits, jobId);
        throw err;
      }
    }),

  /**
   * Generate sound effects for a scene.
   */
  generateSFX: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        sceneId: z.string().min(1),
        description: z.string().min(5).max(500),
        durationSec: z.number().min(0.5).max(22).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin } = await getMargins();
      const credits = toCredits(SFX_COST_USD, fiatMargin);
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      try {
        const result = await elevenLabsService.soundEffect({
          text: sanitizePrompt(input.description),
          durationSeconds: input.durationSec,
          promptInfluence: 0.4,
        });

        const audioUrl = await uploadAudioBuffer(
          result.audioBuffer,
          `sfx/${input.universeId}/${input.sceneId}-${jobId}.mp3`
        );

        await sceneAudioCol().doc(jobId).set({
          id: jobId,
          type: 'sfx',
          universeId: input.universeId,
          sceneId: input.sceneId,
          audioUrl,
          description: input.description,
          credits,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
        });

        return { id: jobId, audioUrl, credits };
      } catch (err) {
        await refundCredits(ctx.user.uid, credits, jobId);
        throw err;
      }
    }),

  /**
   * Generate background music for a scene or segment.
   */
  generateMusic: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        sceneId: z.string().min(1),
        prompt: z.string().min(5).max(500),
        durationSec: z.number().min(5).max(47).default(30),
        model: z
          .enum(['fal-ai/stable-audio', 'fal-ai/musicgen/large', 'fal-ai/musicgen/stereo-large'])
          .default('fal-ai/stable-audio'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin } = await getMargins();
      const credits = toCredits(MUSIC_COST_USD, fiatMargin);
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      try {
        const result = await falService.generateAudio({
          prompt: sanitizePrompt(input.prompt),
          model: input.model,
          durationSec: input.durationSec,
        });

        if (result.status === 'failed' || !result.audioUrl) {
          throw new Error(result.error || 'Music generation failed');
        }

        await sceneAudioCol().doc(jobId).set({
          id: jobId,
          type: 'music',
          universeId: input.universeId,
          sceneId: input.sceneId,
          audioUrl: result.audioUrl,
          prompt: input.prompt,
          durationSec: input.durationSec,
          model: input.model,
          credits,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
        });

        return { id: jobId, audioUrl: result.audioUrl, credits };
      } catch (err) {
        await refundCredits(ctx.user.uid, credits, jobId);
        throw err;
      }
    }),

  /**
   * Lip-sync a video to dialogue audio using computer vision.
   * Uses FAL's lipsync model (with sadtalker fallback) to detect faces
   * and re-render mouth movements to match the audio.
   */
  lipSync: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        sceneId: z.string().min(1),
        videoUrl: z.string().url(),
        audioUrl: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin } = await getMargins();
      const credits = toCredits(LIPSYNC_COST_USD, fiatMargin);
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      try {
        const result = await lipSyncService.sync({
          videoUrl: input.videoUrl,
          audioUrl: input.audioUrl,
        });

        if (result.status === 'failed' || !result.videoUrl) {
          throw new Error(result.error || 'Lip-sync failed');
        }

        await sceneAudioCol().doc(jobId).set({
          id: jobId,
          type: 'lipsync',
          universeId: input.universeId,
          sceneId: input.sceneId,
          videoUrl: result.videoUrl,
          sourceVideoUrl: input.videoUrl,
          sourceAudioUrl: input.audioUrl,
          credits,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
        });

        return { id: jobId, videoUrl: result.videoUrl, credits };
      } catch (err) {
        await refundCredits(ctx.user.uid, credits, jobId);
        throw err;
      }
    }),

  /**
   * Full pipeline: process an entire scene through dialogue + SFX + music + lipsync.
   * Returns URLs for all generated audio layers plus the final composited result info.
   *
   * This is the main entry point when editing a universe timeline — call it per scene.
   */
  processScene: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        scene: sceneInputSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { scene, universeId } = input;
      const jobId = randomUUID();

      // Estimate total credits upfront
      const { fiatMargin } = await getMargins();
      let totalCredits = 0;

      // SFX (if provided)
      if (scene.sfxDescription) {
        totalCredits += toCredits(SFX_COST_USD, fiatMargin);
      }

      // Music (if provided)
      if (scene.musicPrompt) {
        totalCredits += toCredits(MUSIC_COST_USD, fiatMargin);
      }

      // Dialogue TTS
      if (scene.dialogue.length > 0) {
        const totalChars = scene.dialogue.reduce((sum, d) => sum + d.text.length, 0);
        totalCredits += Math.max(2, toCredits(totalChars * TTS_COST_PER_CHAR_USD, fiatMargin));

        // Lip-sync (if dialogue + faces + not skipped)
        if (scene.hasFaces && !scene.skipLipsync) {
          totalCredits += toCredits(LIPSYNC_COST_USD, fiatMargin);
        }
      }

      // Deduct all credits upfront
      if (totalCredits > 0) {
        await deductCredits(ctx.user.uid, totalCredits);
      }

      const results: Record<string, any> = {
        id: jobId,
        sceneId: scene.sceneId,
        title: scene.title,
        creditsCharged: totalCredits,
      };

      let creditsUsed = 0;

      try {
        // ── 1. Generate dialogue TTS ──
        let dialogueUrl: string | undefined;
        if (scene.dialogue.length > 0) {
          const profileIds = [...new Set(scene.dialogue.map((d) => d.voiceProfileId))];
          const profileDocs = await Promise.all(
            profileIds.map((id) => voiceProfilesCol().doc(id).get())
          );
          const profiles: Record<string, any> = {};
          for (const doc of profileDocs) {
            if (doc.exists) profiles[doc.id] = doc.data();
          }

          const audioBuffers: Buffer[] = [];
          for (const line of scene.dialogue) {
            const profile = profiles[line.voiceProfileId];
            if (!profile) {
              throw new Error(
                `Voice profile ${line.voiceProfileId} not found for speaker "${line.speaker}"`
              );
            }

            const ttsResult = await elevenLabsService.textToSpeech({
              text: sanitizePrompt(line.text),
              voiceId: profile.voiceId,
              modelId: 'eleven_v3',
              stability: profile.stability ?? 0.5,
              similarityBoost: 0.75,
              style: profile.style ?? 0.3,
              useSpeakerBoost: true,
            });
            audioBuffers.push(ttsResult.audioBuffer);
            audioBuffers.push(Buffer.alloc(8820)); // gap
          }

          if (audioBuffers.length > 0) {
            const merged = Buffer.concat(audioBuffers);
            dialogueUrl = await uploadAudioBuffer(
              merged,
              `dialogue/${universeId}/${scene.sceneId}-${jobId}.mp3`
            );
            results.dialogueUrl = dialogueUrl;
            const totalChars = scene.dialogue.reduce((s, d) => s + d.text.length, 0);
            creditsUsed += Math.max(
              2,
              toCredits(totalChars * TTS_COST_PER_CHAR_USD, (await getMargins()).fiatMargin)
            );
          }
        }

        // ── 2. Generate SFX ──
        let sfxUrl: string | undefined;
        if (scene.sfxDescription) {
          const sfxResult = await elevenLabsService.soundEffect({
            text: sanitizePrompt(scene.sfxDescription),
            durationSeconds: 10,
            promptInfluence: 0.4,
          });
          sfxUrl = await uploadAudioBuffer(
            sfxResult.audioBuffer,
            `sfx/${universeId}/${scene.sceneId}-${jobId}.mp3`
          );
          results.sfxUrl = sfxUrl;
          creditsUsed += toCredits(SFX_COST_USD, (await getMargins()).fiatMargin);
        }

        // ── 3. Generate Music ──
        let musicUrl: string | undefined;
        if (scene.musicPrompt) {
          const musicResult = await falService.generateAudio({
            prompt: sanitizePrompt(scene.musicPrompt),
            model: 'fal-ai/stable-audio',
            durationSec: scene.musicDurationSec,
          });
          if (musicResult.status === 'completed' && musicResult.audioUrl) {
            musicUrl = musicResult.audioUrl;
            results.musicUrl = musicUrl;
            creditsUsed += toCredits(MUSIC_COST_USD, (await getMargins()).fiatMargin);
          }
        }

        // ── 4. Lip-sync (if dialogue + faces) ──
        let lipsyncVideoUrl: string | undefined;
        if (dialogueUrl && scene.hasFaces && !scene.skipLipsync) {
          const lipsyncResult = await lipSyncService.sync({
            videoUrl: scene.videoUrl,
            audioUrl: dialogueUrl,
          });
          if (lipsyncResult.status === 'completed' && lipsyncResult.videoUrl) {
            lipsyncVideoUrl = lipsyncResult.videoUrl;
            results.lipsyncVideoUrl = lipsyncVideoUrl;
            creditsUsed += toCredits(LIPSYNC_COST_USD, (await getMargins()).fiatMargin);
          }
        }

        // ── Summary ──
        results.status = 'completed';
        results.finalVideoUrl = lipsyncVideoUrl || scene.videoUrl;
        results.layers = {
          dialogue: !!dialogueUrl,
          sfx: !!sfxUrl,
          music: !!musicUrl,
          lipsync: !!lipsyncVideoUrl,
        };

        // Record job
        await sceneAudioCol()
          .doc(jobId)
          .set({
            ...results,
            type: 'pipeline',
            universeId,
            createdBy: ctx.user.uid,
            createdAt: new Date(),
          });

        trackQuests(ctx.user.uid, [{ questId: 'scene_audio_complete' }]);

        return results;
      } catch (err) {
        // Refund unused credits
        const refundAmount = totalCredits - creditsUsed;
        if (refundAmount > 0) {
          await refundCredits(ctx.user.uid, refundAmount, jobId);
        }

        // Still save partial results
        results.status = 'failed';
        results.error = err instanceof Error ? err.message : 'Pipeline failed';
        await sceneAudioCol()
          .doc(jobId)
          .set({
            ...results,
            type: 'pipeline',
            universeId,
            createdBy: ctx.user.uid,
            createdAt: new Date(),
          });

        throw err;
      }
    }),

  /**
   * Process multiple scenes in a timeline sequence.
   * Shares music segments across grouped scenes for continuity.
   */
  processTimeline: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        scenes: z.array(sceneInputSchema).min(1).max(100),
        /** Optional shared music prompt for the whole timeline segment */
        sharedMusicPrompt: z.string().max(500).optional(),
        sharedMusicDurationSec: z.number().min(5).max(47).default(47),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { universeId, scenes } = input;
      const timelineId = randomUUID();

      // Generate shared music if provided
      let sharedMusicUrl: string | undefined;
      if (input.sharedMusicPrompt) {
        const { fiatMargin } = await getMargins();
        const musicCredits = toCredits(MUSIC_COST_USD, fiatMargin);
        await deductCredits(ctx.user.uid, musicCredits);

        try {
          const musicResult = await falService.generateAudio({
            prompt: sanitizePrompt(input.sharedMusicPrompt),
            model: 'fal-ai/stable-audio',
            durationSec: input.sharedMusicDurationSec,
          });
          if (musicResult.status === 'completed' && musicResult.audioUrl) {
            sharedMusicUrl = musicResult.audioUrl;
          }
        } catch (err) {
          console.error('Shared music generation failed:', err);
          const { fiatMargin: fm } = await getMargins();
          await refundCredits(ctx.user.uid, toCredits(MUSIC_COST_USD, fm), timelineId);
        }
      }

      // Process each scene
      const results: Array<{ sceneId: string; status: string; [key: string]: any }> = [];

      for (const scene of scenes) {
        try {
          // For scenes without their own music, we'll skip music gen
          // and the frontend can layer the shared music
          const { fiatMargin } = await getMargins();
          let sceneCredits = 0;

          if (scene.sfxDescription) sceneCredits += toCredits(SFX_COST_USD, fiatMargin);
          if (scene.musicPrompt) sceneCredits += toCredits(MUSIC_COST_USD, fiatMargin);

          if (scene.dialogue.length > 0) {
            const chars = scene.dialogue.reduce((s, d) => s + d.text.length, 0);
            sceneCredits += Math.max(2, toCredits(chars * TTS_COST_PER_CHAR_USD, fiatMargin));
            if (scene.hasFaces && !scene.skipLipsync) {
              sceneCredits += toCredits(LIPSYNC_COST_USD, fiatMargin);
            }
          }

          if (sceneCredits > 0) {
            await deductCredits(ctx.user.uid, sceneCredits);
          }

          // Generate audio layers
          const sceneResult: Record<string, any> = { sceneId: scene.sceneId };

          // Dialogue
          let dialogueUrl: string | undefined;
          if (scene.dialogue.length > 0) {
            const profileIds = [...new Set(scene.dialogue.map((d) => d.voiceProfileId))];
            const profileDocs = await Promise.all(
              profileIds.map((id) => voiceProfilesCol().doc(id).get())
            );
            const profiles: Record<string, any> = {};
            for (const doc of profileDocs) {
              if (doc.exists) profiles[doc.id] = doc.data();
            }

            const buffers: Buffer[] = [];
            for (const line of scene.dialogue) {
              const profile = profiles[line.voiceProfileId];
              if (!profile) {
                throw new Error(`Voice profile ${line.voiceProfileId} not found`);
              }
              const tts = await elevenLabsService.textToSpeech({
                text: sanitizePrompt(line.text),
                voiceId: profile.voiceId,
                modelId: 'eleven_v3',
                stability: profile.stability ?? 0.5,
                similarityBoost: 0.75,
                style: profile.style ?? 0.3,
              });
              buffers.push(tts.audioBuffer);
              buffers.push(Buffer.alloc(8820));
            }

            if (buffers.length > 0) {
              dialogueUrl = await uploadAudioBuffer(
                Buffer.concat(buffers),
                `dialogue/${universeId}/${scene.sceneId}-${timelineId}.mp3`
              );
              sceneResult.dialogueUrl = dialogueUrl;
            }
          }

          // SFX
          if (scene.sfxDescription) {
            const sfx = await elevenLabsService.soundEffect({
              text: sanitizePrompt(scene.sfxDescription),
              durationSeconds: 10,
              promptInfluence: 0.4,
            });
            sceneResult.sfxUrl = await uploadAudioBuffer(
              sfx.audioBuffer,
              `sfx/${universeId}/${scene.sceneId}-${timelineId}.mp3`
            );
          }

          // Scene-specific music
          if (scene.musicPrompt) {
            const music = await falService.generateAudio({
              prompt: sanitizePrompt(scene.musicPrompt),
              model: 'fal-ai/stable-audio',
              durationSec: scene.musicDurationSec,
            });
            if (music.status === 'completed' && music.audioUrl) {
              sceneResult.musicUrl = music.audioUrl;
            }
          } else if (sharedMusicUrl) {
            sceneResult.musicUrl = sharedMusicUrl;
          }

          // Lip-sync
          if (dialogueUrl && scene.hasFaces && !scene.skipLipsync) {
            const sync = await lipSyncService.sync({
              videoUrl: scene.videoUrl,
              audioUrl: dialogueUrl,
            });
            if (sync.status === 'completed' && sync.videoUrl) {
              sceneResult.lipsyncVideoUrl = sync.videoUrl;
            }
          }

          sceneResult.status = 'completed';
          sceneResult.credits = sceneCredits;
          results.push(sceneResult as any);
        } catch (err: any) {
          results.push({
            sceneId: scene.sceneId,
            status: 'failed',
            error: err.message?.slice(0, 200),
          });
        }
      }

      // Save timeline job
      await sceneAudioCol()
        .doc(timelineId)
        .set({
          id: timelineId,
          type: 'timeline',
          universeId,
          sceneCount: scenes.length,
          completedCount: results.filter((r) => r.status === 'completed').length,
          failedCount: results.filter((r) => r.status === 'failed').length,
          sharedMusicUrl,
          results,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
        });

      return {
        id: timelineId,
        sharedMusicUrl,
        results,
        summary: {
          total: scenes.length,
          completed: results.filter((r) => r.status === 'completed').length,
          failed: results.filter((r) => r.status === 'failed').length,
        },
      };
    }),

  /**
   * Estimate credits for a scene or timeline before processing.
   */
  estimateCost: protectedProcedure
    .input(
      z.object({
        scenes: z.array(
          z.object({
            dialogueChars: z.number().default(0),
            hasSFX: z.boolean().default(false),
            hasMusic: z.boolean().default(false),
            hasDialogue: z.boolean().default(false),
            hasFaces: z.boolean().default(true),
            skipLipsync: z.boolean().default(false),
          })
        ),
        includeSharedMusic: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => {
      const { fiatMargin } = await getMargins();
      let totalCredits = 0;
      const breakdown: Array<{ scene: number; credits: number; layers: string[] }> = [];

      for (let i = 0; i < input.scenes.length; i++) {
        const s = input.scenes[i];
        let sceneCredits = 0;
        const layers: string[] = [];

        if (s.hasSFX) {
          sceneCredits += toCredits(SFX_COST_USD, fiatMargin);
          layers.push('sfx');
        }
        if (s.hasMusic) {
          sceneCredits += toCredits(MUSIC_COST_USD, fiatMargin);
          layers.push('music');
        }
        if (s.hasDialogue && s.dialogueChars > 0) {
          sceneCredits += Math.max(
            2,
            toCredits(s.dialogueChars * TTS_COST_PER_CHAR_USD, fiatMargin)
          );
          layers.push('dialogue');
          if (s.hasFaces && !s.skipLipsync) {
            sceneCredits += toCredits(LIPSYNC_COST_USD, fiatMargin);
            layers.push('lipsync');
          }
        }

        totalCredits += sceneCredits;
        breakdown.push({ scene: i, credits: sceneCredits, layers });
      }

      if (input.includeSharedMusic) {
        totalCredits += toCredits(MUSIC_COST_USD, fiatMargin);
      }

      return { totalCredits, breakdown };
    }),

  /**
   * Get audio pipeline history for a universe.
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const snap = await sceneAudioCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ══════════════════════════════════════════════════════════════════════
  // SOUND NODES — First-class audio timeline entities
  //
  // Sound nodes sit alongside video nodes on the timeline. They can be:
  //   - Short SFX (0.5s - 22s)
  //   - Long background music (5s - 47s)
  //   - Dialogue clips (any length)
  //   - Ambient loops
  //
  // Each has independent volume, can span multiple video nodes,
  // and can be repositioned/trimmed on the timeline.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Create a sound node on the timeline.
   * Generates the audio (SFX, music, or dialogue) and places it as a node.
   */
  createSoundNode: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        /** Which type of audio to generate */
        kind: z.enum(['sfx', 'music', 'dialogue', 'ambient']),
        /** Text prompt for generation (SFX description, music prompt, or dialogue text) */
        prompt: z.string().min(1).max(1000),
        /** Duration in seconds (SFX: 0.5-22, music: 5-47) */
        durationSec: z.number().min(0.5).max(47).optional(),
        /** Volume 0-1, default 1.0 */
        volume: z.number().min(0).max(1).default(1.0),
        /** Position on timeline — which video node this starts at */
        startAtNodeId: z.number().int().min(0).optional(),
        /** Offset in seconds from the start of the video node */
        offsetSec: z.number().min(0).default(0),
        /** How many video nodes this sound spans (0 = just this node) */
        spanNodes: z.number().int().min(0).max(100).default(0),
        /** Voice profile ID (required for dialogue kind) */
        voiceProfileId: z.string().optional(),
        /** Music model preference */
        musicModel: z
          .enum(['fal-ai/stable-audio', 'fal-ai/musicgen/large', 'fal-ai/musicgen/stereo-large'])
          .default('fal-ai/stable-audio'),
        /** Whether this is a looping ambient sound */
        loop: z.boolean().default(false),
        /** Optional label for the timeline UI */
        label: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin } = await getMargins();
      const nodeId = randomUUID();

      // Determine cost based on kind
      let costUsd: number;
      switch (input.kind) {
        case 'sfx':
        case 'ambient':
          costUsd = SFX_COST_USD;
          break;
        case 'music':
          costUsd = MUSIC_COST_USD;
          break;
        case 'dialogue': {
          const chars = input.prompt.length;
          costUsd = Math.max(0.02, chars * TTS_COST_PER_CHAR_USD);
          break;
        }
      }

      const credits = toCredits(costUsd, fiatMargin);
      await deductCredits(ctx.user.uid, credits);

      try {
        let audioUrl: string;

        switch (input.kind) {
          case 'sfx':
          case 'ambient': {
            const sfxResult = await elevenLabsService.soundEffect({
              text: sanitizePrompt(input.prompt),
              durationSeconds: input.durationSec ? Math.min(input.durationSec, 22) : undefined,
              promptInfluence: 0.4,
            });
            audioUrl = await uploadAudioBuffer(
              sfxResult.audioBuffer,
              `sound-nodes/${input.universeId}/${nodeId}.mp3`
            );
            break;
          }
          case 'music': {
            const musicResult = await falService.generateAudio({
              prompt: sanitizePrompt(input.prompt),
              model: input.musicModel,
              durationSec: input.durationSec || 30,
            });
            if (musicResult.status === 'failed' || !musicResult.audioUrl) {
              throw new Error(musicResult.error || 'Music generation failed');
            }
            audioUrl = musicResult.audioUrl;
            break;
          }
          case 'dialogue': {
            if (!input.voiceProfileId) {
              throw new Error('voiceProfileId is required for dialogue sound nodes');
            }
            const profileDoc = await voiceProfilesCol().doc(input.voiceProfileId).get();
            if (!profileDoc.exists) {
              throw new Error(`Voice profile ${input.voiceProfileId} not found`);
            }
            const profile = profileDoc.data()!;
            const ttsResult = await elevenLabsService.textToSpeech({
              text: sanitizePrompt(input.prompt),
              voiceId: profile.voiceId,
              modelId: 'eleven_v3',
              stability: profile.stability ?? 0.5,
              similarityBoost: 0.75,
              style: profile.style ?? 0.3,
            });
            audioUrl = await uploadAudioBuffer(
              ttsResult.audioBuffer,
              `sound-nodes/${input.universeId}/${nodeId}.mp3`
            );
            break;
          }
        }

        const soundNode = {
          id: nodeId,
          universeId: input.universeId,
          kind: input.kind,
          prompt: input.prompt,
          audioUrl,
          volume: input.volume,
          startAtNodeId: input.startAtNodeId ?? null,
          offsetSec: input.offsetSec,
          spanNodes: input.spanNodes,
          durationSec: input.durationSec ?? null,
          loop: input.loop,
          label: input.label || `${input.kind} — ${input.prompt.slice(0, 40)}`,
          voiceProfileId: input.voiceProfileId ?? null,
          musicModel: input.kind === 'music' ? input.musicModel : null,
          credits,
          createdBy: ctx.user.uid,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await soundNodesCol().doc(nodeId).set(soundNode);

        return soundNode;
      } catch (err) {
        await refundCredits(ctx.user.uid, credits, nodeId);
        throw err;
      }
    }),

  /**
   * Batch-create sound nodes for multiple selected clips.
   * User selects video clips → generates SFX + music for all at once.
   */
  batchCreateSoundNodes: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        /** Array of sound node specs to generate */
        nodes: z
          .array(
            z.object({
              kind: z.enum(['sfx', 'music', 'dialogue', 'ambient']),
              prompt: z.string().min(1).max(1000),
              durationSec: z.number().min(0.5).max(47).optional(),
              volume: z.number().min(0).max(1).default(1.0),
              startAtNodeId: z.number().int().min(0).optional(),
              offsetSec: z.number().min(0).default(0),
              spanNodes: z.number().int().min(0).max(100).default(0),
              voiceProfileId: z.string().optional(),
              label: z.string().max(100).optional(),
              loop: z.boolean().default(false),
            })
          )
          .min(1)
          .max(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin } = await getMargins();
      const results: Array<{
        id: string;
        kind: string;
        status: string;
        audioUrl?: string;
        error?: string;
      }> = [];

      for (const spec of input.nodes) {
        const nodeId = randomUUID();
        let costUsd: number;
        switch (spec.kind) {
          case 'sfx':
          case 'ambient':
            costUsd = SFX_COST_USD;
            break;
          case 'music':
            costUsd = MUSIC_COST_USD;
            break;
          case 'dialogue':
            costUsd = Math.max(0.02, spec.prompt.length * TTS_COST_PER_CHAR_USD);
            break;
        }

        const credits = toCredits(costUsd, fiatMargin);

        try {
          await deductCredits(ctx.user.uid, credits);

          let audioUrl: string;
          switch (spec.kind) {
            case 'sfx':
            case 'ambient': {
              const sfx = await elevenLabsService.soundEffect({
                text: sanitizePrompt(spec.prompt),
                durationSeconds: spec.durationSec ? Math.min(spec.durationSec, 22) : undefined,
                promptInfluence: 0.4,
              });
              audioUrl = await uploadAudioBuffer(
                sfx.audioBuffer,
                `sound-nodes/${input.universeId}/${nodeId}.mp3`
              );
              break;
            }
            case 'music': {
              const music = await falService.generateAudio({
                prompt: sanitizePrompt(spec.prompt),
                model: 'fal-ai/stable-audio',
                durationSec: spec.durationSec || 30,
              });
              if (music.status === 'failed' || !music.audioUrl) {
                throw new Error(music.error || 'Music generation failed');
              }
              audioUrl = music.audioUrl;
              break;
            }
            case 'dialogue': {
              if (!spec.voiceProfileId) throw new Error('voiceProfileId required for dialogue');
              const pDoc = await voiceProfilesCol().doc(spec.voiceProfileId).get();
              if (!pDoc.exists) throw new Error('Voice profile not found');
              const p = pDoc.data()!;
              const tts = await elevenLabsService.textToSpeech({
                text: sanitizePrompt(spec.prompt),
                voiceId: p.voiceId,
                modelId: 'eleven_v3',
                stability: p.stability ?? 0.5,
                similarityBoost: 0.75,
                style: p.style ?? 0.3,
              });
              audioUrl = await uploadAudioBuffer(
                tts.audioBuffer,
                `sound-nodes/${input.universeId}/${nodeId}.mp3`
              );
              break;
            }
          }

          await soundNodesCol()
            .doc(nodeId)
            .set({
              id: nodeId,
              universeId: input.universeId,
              kind: spec.kind,
              prompt: spec.prompt,
              audioUrl,
              volume: spec.volume,
              startAtNodeId: spec.startAtNodeId ?? null,
              offsetSec: spec.offsetSec,
              spanNodes: spec.spanNodes,
              durationSec: spec.durationSec ?? null,
              loop: spec.loop,
              label: spec.label || `${spec.kind} — ${spec.prompt.slice(0, 40)}`,
              voiceProfileId: spec.voiceProfileId ?? null,
              credits,
              createdBy: ctx.user.uid,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

          results.push({ id: nodeId, kind: spec.kind, status: 'completed', audioUrl });
        } catch (err: any) {
          results.push({
            id: nodeId,
            kind: spec.kind,
            status: 'failed',
            error: err.message?.slice(0, 200),
          });
        }
      }

      return {
        results,
        summary: {
          total: input.nodes.length,
          completed: results.filter((r) => r.status === 'completed').length,
          failed: results.filter((r) => r.status === 'failed').length,
        },
      };
    }),

  /**
   * Update a sound node's volume, position, or label.
   * Does not regenerate audio — just updates timeline placement and mix settings.
   */
  updateSoundNode: protectedProcedure
    .input(
      z.object({
        nodeId: z.string().min(1),
        volume: z.number().min(0).max(1).optional(),
        startAtNodeId: z.number().int().min(0).optional(),
        offsetSec: z.number().min(0).optional(),
        spanNodes: z.number().int().min(0).max(100).optional(),
        loop: z.boolean().optional(),
        label: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const docRef = soundNodesCol().doc(input.nodeId);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error('Sound node not found');

      const data = doc.data()!;
      if (data.createdBy !== ctx.user.uid) {
        throw new Error('Not authorized to update this sound node');
      }

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.volume !== undefined) updates.volume = input.volume;
      if (input.startAtNodeId !== undefined) updates.startAtNodeId = input.startAtNodeId;
      if (input.offsetSec !== undefined) updates.offsetSec = input.offsetSec;
      if (input.spanNodes !== undefined) updates.spanNodes = input.spanNodes;
      if (input.loop !== undefined) updates.loop = input.loop;
      if (input.label !== undefined) updates.label = input.label;

      await docRef.update(updates);
      return { id: input.nodeId, ...updates };
    }),

  /**
   * Delete a sound node.
   */
  deleteSoundNode: protectedProcedure
    .input(z.object({ nodeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const docRef = soundNodesCol().doc(input.nodeId);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error('Sound node not found');

      const data = doc.data()!;
      if (data.createdBy !== ctx.user.uid) {
        throw new Error('Not authorized to delete this sound node');
      }

      await docRef.delete();
      return { deleted: true };
    }),

  /**
   * List all sound nodes for a universe timeline.
   * Returns them ordered by position so the frontend can render them on the timeline.
   */
  listSoundNodes: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        /** Optional: filter by kind */
        kind: z.enum(['sfx', 'music', 'dialogue', 'ambient']).optional(),
      })
    )
    .query(async ({ input }) => {
      let query = soundNodesCol().where('universeId', '==', input.universeId);
      if (input.kind) {
        query = query.where('kind', '==', input.kind);
      }

      const snap = await query.orderBy('createdAt', 'asc').get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /**
   * Bulk update volume for multiple sound nodes at once.
   * Used when adjusting the mix across the timeline.
   */
  bulkUpdateVolume: protectedProcedure
    .input(
      z.object({
        updates: z.array(
          z.object({
            nodeId: z.string().min(1),
            volume: z.number().min(0).max(1),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      const batch = db.batch();
      for (const u of input.updates) {
        const ref = soundNodesCol().doc(u.nodeId);
        batch.update(ref, { volume: u.volume, updatedAt: new Date() });
      }
      await batch.commit();
      return { updated: input.updates.length };
    }),
});
