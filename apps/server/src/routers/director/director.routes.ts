/**
 * LOAR Director Router — voice/text intent routing.
 *
 * Single entry point for the VOICE → LOAR DIRECTOR step: classifies an
 * utterance as a canon query or a story action and returns a response
 * shaped for the Character Voice → HUME leg (a short spoken-ready string
 * plus the structured data behind it).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../../lib/trpc';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';
import {
  classifyDirectorIntent,
  answerCanonQuery,
  planStoryAction,
  resolveAndSynthesizeCharacterVoice,
} from '../../services/loar-director';

const voiceInputSchema = z
  .object({
    // Explicit overrides. If both are omitted, the voice is resolved from
    // the target entity's own `metadata.humeVoiceId`/`humeVoiceName`
    // (voiceEntityId if given, else the request's top-level entityId).
    humeVoiceId: z.string().optional(),
    humeVoiceName: z.string().optional(),
    description: z.string().max(200).optional(),
    voiceEntityId: z.string().optional(),
  })
  .optional();

export const directorRouter = router({
  dispatch: protectedProcedure
    .input(
      z
        .object({
          universeId: z.string().min(1),
          entityId: z.string().optional(),
          // The VOICE step: either a already-transcribed line, or a
          // recording URL (pre-uploaded by the client) to transcribe here.
          utterance: z.string().min(1).max(2000).optional(),
          audioUrl: z.string().url().optional(),
          // Character Voice → HUME: when set, the spoken response is also
          // synthesized to audio through Hume. Omit to get text only.
          voice: voiceInputSchema,
        })
        .refine((v) => !!v.utterance || !!v.audioUrl, {
          message: 'Provide either utterance or audioUrl',
        })
    )
    .mutation(async ({ input, ctx }) => {
      // Lazy import — break the index → directorRouter → index cycle
      // (same trick as routers/marketing/marketing.routes.ts).
      const { appRouter } = (await import('../index')) as any;
      const caller = appRouter.createCaller({ user: ctx.user, clientIp: ctx.clientIp });

      let utterance = input.utterance ?? null;
      let transcript: string | null = null;

      if (!utterance) {
        try {
          assertSafeExternalUrl(input.audioUrl!);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err instanceof Error ? err.message : 'audioUrl rejected',
          });
        }
        // Billed transcription — reuses lipsync.transcribe so credits and
        // `generation.lipsync` permission checks apply exactly as they
        // would for any other caller of that endpoint.
        const transcription = await caller.lipsync.transcribe({ audioUrl: input.audioUrl });
        const text = transcription?.result?.text?.trim();
        if (!text) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Couldn't make out any speech in that recording.",
          });
        }
        utterance = text.slice(0, 2000);
        transcript = utterance;
      }
      if (!utterance) {
        // Unreachable: the zod refine + the branch above guarantee a value.
        // Narrows `string | null` → `string` for the calls below.
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No utterance resolved' });
      }

      const classification = await classifyDirectorIntent({
        utterance,
        userId: ctx.user.uid,
      });

      let spokenResponse: string;
      let payload:
        | { intent: 'story_action'; storyAction: Awaited<ReturnType<typeof planStoryAction>> }
        | { intent: 'canon_query'; canonQuery: Awaited<ReturnType<typeof answerCanonQuery>> };

      if (classification.intent === 'story_action') {
        const plan = await planStoryAction({
          utterance,
          universeId: input.universeId,
          userId: ctx.user.uid,
        });
        spokenResponse = plan.spokenAck;
        payload = { intent: 'story_action', storyAction: plan };
      } else {
        const result = await answerCanonQuery({
          utterance,
          universeId: input.universeId,
          entityId: input.entityId,
          userId: ctx.user.uid,
        });
        spokenResponse = result.answer;
        payload = { intent: 'canon_query', canonQuery: result };
      }

      const voiceResult = input.voice
        ? await resolveAndSynthesizeCharacterVoice({
            text: spokenResponse,
            entityId: input.voice.voiceEntityId ?? input.entityId,
            override: {
              humeVoiceId: input.voice.humeVoiceId,
              humeVoiceName: input.voice.humeVoiceName,
              description: input.voice.description,
            },
          })
        : null;

      return {
        ...payload,
        confidence: classification.confidence,
        transcript,
        spokenResponse,
        audioUrl: voiceResult?.audioUrl ?? null,
      };
    }),

  /**
   * Execute a planned story action. Kept separate from `dispatch` so
   * `create_node`/`branch_story` (free) and `generate_scene` (spends
   * credits via `generation.generate`) both go through an explicit,
   * user-confirmed call rather than a voice misparse silently mutating
   * the universe or spending credits.
   */
  executeStoryAction: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        kind: z.enum(['create_node', 'branch_story', 'generate_scene']),
        title: z.string().max(200).optional(),
        description: z.string().min(1).max(2000),
        /** branch_story only: the event this branches off of. */
        previousEventId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Lazy import — break the index → directorRouter → index cycle
      // (same trick as routers/marketing/marketing.routes.ts).
      const { appRouter } = (await import('../index')) as any;
      const caller = appRouter.createCaller({ user: ctx.user, clientIp: ctx.clientIp });

      if (input.kind === 'generate_scene') {
        const generation = await caller.generation.generate({
          prompt: input.description,
          mode: 'text_to_video',
          durationSec: 5,
          resolution: '720p',
          aspectRatio: '16:9',
          audio: false,
          universeId: input.universeId,
          useWikiContext: true,
          routingMode: 'auto',
        });
        return { kind: 'generate_scene' as const, generation };
      }

      if (input.kind === 'branch_story' && !input.previousEventId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'branch_story requires previousEventId',
        });
      }

      const { randomUUID } = await import('crypto');
      const eventId = randomUUID();
      await caller.universeEvents.upsert({
        universeId: input.universeId,
        events: {
          [eventId]: {
            title: input.title || '',
            description: input.description,
            sourceType: 'voice_director',
            branchOf: input.kind === 'branch_story' ? input.previousEventId : null,
            createdAt: new Date().toISOString(),
            createdBy: ctx.user.uid,
          },
        },
      });
      return { kind: input.kind, eventId };
    }),
});
