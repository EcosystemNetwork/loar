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
import { isUniverseCollaborator } from '../../lib/safe-admin';
import { buildDirectorContext } from '../../services/director-context';
import { mintVoiceSessionToken } from '../../services/voice-session';
import {
  classifyDirectorIntent,
  answerCanonQuery,
  answerAsCharacter,
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

/**
 * Shared VOICE step: resolve a plain utterance from either the typed field
 * or a pre-uploaded recording (transcribed via the existing billed
 * lipsync.transcribe). Used by both `dispatch` and `talkToCharacter` so
 * speech input works the same way in both modes.
 */
async function resolveUtterance(
  caller: any,
  input: { utterance?: string; audioUrl?: string }
): Promise<{ utterance: string; transcript: string | null }> {
  if (input.utterance) return { utterance: input.utterance, transcript: null };

  try {
    assertSafeExternalUrl(input.audioUrl!);
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: err instanceof Error ? err.message : 'audioUrl rejected',
    });
  }
  const transcription = await caller.lipsync.transcribe({ audioUrl: input.audioUrl });
  const text = transcription?.result?.text?.trim();
  if (!text) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Couldn't make out any speech in that recording.",
    });
  }
  const utterance = text.slice(0, 2000);
  return { utterance, transcript: utterance };
}

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
          // Set once the client has an eventId from an earlier create/branch
          // in this conversation — lets "actually, change that" resolve to
          // update_node instead of falling back to create_node.
          hasActiveNode: z.boolean().optional(),
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

      const { utterance, transcript } = await resolveUtterance(caller, input);

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
          hasActiveNode: input.hasActiveNode,
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
   * Character Voice mode: "Talk to Character" — answers in first person as
   * the given entity, grounded in only what that character could plausibly
   * know (see `answerAsCharacter`). Always voices the reply through that
   * character's own Hume voice unless an override is given.
   */
  talkToCharacter: protectedProcedure
    .input(
      z
        .object({
          universeId: z.string().min(1),
          entityId: z.string().min(1),
          utterance: z.string().min(1).max(2000).optional(),
          audioUrl: z.string().url().optional(),
          voice: voiceInputSchema,
        })
        .refine((v) => !!v.utterance || !!v.audioUrl, {
          message: 'Provide either utterance or audioUrl',
        })
    )
    .mutation(async ({ input, ctx }) => {
      const { appRouter } = (await import('../index')) as any;
      const caller = appRouter.createCaller({ user: ctx.user, clientIp: ctx.clientIp });

      const { utterance, transcript } = await resolveUtterance(caller, input);

      const result = await answerAsCharacter({
        utterance,
        universeId: input.universeId,
        entityId: input.entityId,
        userId: ctx.user.uid,
      });

      const voiceResult = await resolveAndSynthesizeCharacterVoice({
        text: result.answer,
        entityId: input.voice?.voiceEntityId ?? input.entityId,
        override: {
          humeVoiceId: input.voice?.humeVoiceId,
          humeVoiceName: input.voice?.humeVoiceName,
          description: input.voice?.description,
        },
      });

      return {
        transcript,
        spokenResponse: result.answer,
        hasContext: result.hasContext,
        audioUrl: voiceResult.audioUrl,
      };
    }),

  /**
   * Tool-layer read for the Pipecat voice pipeline (get_universe_context /
   * get_character / get_canon). `perspective: 'character'` returns a
   * knowledge-scoped view (no universe synopsis, no other entities) so a
   * character's persona prompt can't leak secrets it hasn't discovered.
   */
  getContext: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        entityId: z.string().optional(),
        perspective: z.enum(['director', 'character']).default('director'),
      })
    )
    .query(async ({ input }) => {
      const ctxData = await buildDirectorContext(input);
      if (!ctxData) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe or character not found' });
      }
      return ctxData;
    }),

  /**
   * submit_canon_proposal: opens a community vote on whether a story node
   * becomes canon, using the existing `polls` system (`canon_submission`
   * type) rather than a parallel store.
   */
  submitCanonProposal: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        nodeId: z.number().int().min(1),
        title: z.string().min(3).max(200),
        description: z.string().max(1500).optional(),
        durationHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 14)
          .default(72),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { appRouter } = (await import('../index')) as any;
      const caller = appRouter.createCaller({ user: ctx.user, clientIp: ctx.clientIp });

      const node = await caller.offChainNodes.get({
        universeId: input.universeId,
        nodeId: input.nodeId,
      });
      if (!node) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Story node #${input.nodeId} not found`,
        });
      }

      const endsAt = new Date(Date.now() + input.durationHours * 3_600_000).toISOString();
      const poll = await caller.polls.create({
        universeAddress: input.universeId,
        title: input.title,
        description: [
          input.description,
          node.plot ? `Story node #${input.nodeId}: ${node.plot}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 2000),
        options: ['Make it canon', 'Keep it as an alternate timeline'],
        type: 'canon_submission',
        endsAt,
        allowMultiple: false,
        tokenWeighted: false,
        linkedContentId: `offchain-node:${input.nodeId}`,
      });
      return { pollId: poll.id as string, title: poll.title as string, endsAt };
    }),

  /**
   * Mint a short-lived token + WebSocket URL for a live voice session with
   * the Pipecat pipeline. Director mode can mutate the universe, so it's
   * limited to collaborators; character mode is read-only, so any signed-in
   * user may talk to a character.
   */
  createVoiceSession: protectedProcedure
    .input(
      z
        .object({
          universeId: z.string().min(1),
          mode: z.enum(['director', 'character']),
          entityId: z.string().optional(),
        })
        .refine((v) => v.mode !== 'character' || !!v.entityId, {
          message: 'character mode requires entityId',
        })
    )
    .mutation(async ({ input, ctx }) => {
      const secret = process.env.VOICE_SESSION_SECRET;
      const wsBase = process.env.VOICE_PIPELINE_WS_URL;
      if (!secret || !wsBase) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Live voice is not configured on this server',
        });
      }

      if (input.mode === 'director') {
        const caller = ctx.user.address ?? ctx.user.uid;
        const allowed = await isUniverseCollaborator(input.universeId, caller);
        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only universe collaborators can direct by voice',
          });
        }
      }

      const { token, expiresAt } = mintVoiceSessionToken(
        {
          universeId: input.universeId,
          mode: input.mode,
          entityId: input.entityId,
          uid: ctx.user.uid,
        },
        secret
      );
      const wsUrl = `${wsBase}${wsBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
      return { wsUrl, expiresAt };
    }),

  /**
   * Execute a planned story action. Kept separate from `dispatch` so
   * `create_node`/`branch_story` (free) and `generate_scene` (spends
   * credits via `generation.generate`) both go through an explicit,
   * user-confirmed call rather than a voice misparse silently mutating
   * the universe or spending credits.
   *
   * create_node/branch_story/update_node write to `offChainNodes` — the
   * collection the timeline graph (ReactFlow canvas) actually renders from
   * for off-chain ("fun-mode") universes; `universeEvents` is a companion
   * metadata store, not the node source, so writing only there would mutate
   * canon data the UI never shows. `videoUrl` is intentionally omitted — a
   * voice-created beat can exist before a shot is generated for it
   * (`buildOffChainGraphData` renders nodes with an empty url fine). This
   * only affects off-chain universes; a minted on-chain universe's timeline
   * comes from the contract and isn't reachable from here.
   */
  executeStoryAction: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        kind: z.enum(['create_node', 'branch_story', 'update_node', 'generate_scene']),
        title: z.string().max(200).optional(),
        description: z.string().min(1).max(2000),
        /** create_node/branch_story: node to continue/branch from (0 = root). */
        previousNodeId: z.number().int().min(0).optional(),
        /** update_node only: the node to revise. */
        nodeId: z.number().int().optional(),
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

      if (input.kind === 'branch_story' && input.previousNodeId == null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'branch_story requires previousNodeId',
        });
      }

      if (input.kind === 'update_node') {
        if (input.nodeId == null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'update_node requires nodeId' });
        }
        const updated = await caller.offChainNodes.update({
          universeId: input.universeId,
          nodeId: input.nodeId,
          title: input.title,
          plot: input.description,
        });
        return { kind: 'update_node' as const, nodeId: updated.nodeId as number };
      }

      const created = await caller.offChainNodes.create({
        universeId: input.universeId,
        plot: input.description,
        title: input.title,
        previousNodeId: input.previousNodeId ?? 0,
      });
      return { kind: input.kind, nodeId: created.nodeId as number };
    }),
});
