/**
 * Z.AI router — hackathon-grade integration of the Z.AI devpack into LOAR.
 *
 * Surfaces:
 *   - chat               — direct GLM passthrough (with deep-thinking flag)
 *   - worldbuild         — prompt → JSON entity bundle, auto-persisted
 *   - seedFromUrl        — Web Reader → entity bundle (lore from real sources)
 *   - webSearch          — Z.AI Web Search tool, surfaced for canon-research UI
 *   - generateImage      — CogView-4 / GLM-Image, rehosted via StorageManager
 *   - generateVideo      — CogVideoX-3, rehosted via StorageManager
 *   - talkingScene       — image + script → CogVideoX video (provider-alt to OmniHuman)
 *   - canonCheck         — vision + reasoning consistency score before publish
 *   - governanceAgent    — summarize on-chain proposal + recommend vote rationale
 *   - transcribe         — GLM-ASR for voice memos
 *   - episodeFromVoice   — voice → transcript → structured episode draft
 *
 * Every mutation auto-prefers the user's BYOK Z.AI key (via userSecrets) and
 * falls back to the platform ZAI_API_KEY env. No plaintext key ever leaves
 * server memory.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  protectedProcedure,
  publicProcedure,
  router,
  expensiveProcedure,
  requirePermission,
} from '../../lib/trpc';
import { zaiService } from '../../services/zai';
import { getUserSecret } from '../../services/userSecrets';
import { getStorageManager } from '../../services/storage';
import { runEpisodeCanonCheck } from '../../services/canon-check';
import { createEntity } from '../entities/entities.handlers';
import { ENTITY_KINDS, type EntityKind } from '../entities/entities.types';
import { db, firebaseAvailable } from '../../lib/firebase';

// ── Helpers ───────────────────────────────────────────────────────────────

async function resolveKey(uid: string): Promise<string | undefined> {
  const byok = await getUserSecret(uid, 'zai').catch(() => null);
  return byok ?? undefined;
}

async function rehostUrl(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string
): Promise<string> {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return fileUrl;
    const buf = Buffer.from(await res.arrayBuffer());
    const manifest = await getStorageManager().upload(buf, filename, mimeType, userId);
    return manifest.uploads[0]?.url ?? fileUrl;
  } catch (err) {
    console.warn('[zai] rehost failed, returning original url', err);
    return fileUrl;
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────

const chatModelSchema = z
  .enum([
    'glm-4.5-air',
    'glm-4.5',
    'glm-4.5v',
    'glm-4.6',
    'glm-4.6v',
    'glm-5',
    'glm-5-turbo',
    'glm-5.1',
    'glm-5v-turbo',
  ])
  .default('glm-4.6');

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

// ── Worldbuild bundle JSON shape ─────────────────────────────────────────

interface WorldbuildBundle {
  universe: { name: string; logline: string; tone: string };
  entities: Array<{
    kind: EntityKind;
    name: string;
    description: string;
    metadata?: Record<string, string>;
  }>;
}

const WORLDBUILD_SYSTEM = `You are LOAR's worldbuilding planner. Output **only** JSON matching this TypeScript interface:

interface Bundle {
  universe: { name: string; logline: string; tone: string };
  entities: Array<{
    kind: "person" | "place" | "thing" | "faction" | "event" | "lore" | "species" | "vehicle" | "technology" | "organization";
    name: string;
    description: string;
    metadata?: Record<string, string>;
  }>;
}

Rules:
- Generate 6–12 entities covering at least 3 distinct kinds.
- Names must be evocative and unique.
- Descriptions are 1–3 sentences each, written as canonical fiction.
- Output **JSON only**, no prose, no code fences.`;

// ── Router ────────────────────────────────────────────────────────────────

export const zaiRouter = router({
  // Public health probe — does the platform have any Z.AI key configured?
  status: publicProcedure.query(() => ({
    platformKey: zaiService.isConfigured(),
  })),

  /**
   * 0. Diagnostic — pings every Z.AI surface with a minimal payload and
   *    captures pass/fail + a truncated raw sample so you can spot when
   *    the live response shape differs from what we parse. No retries,
   *    no caching — runs end-to-end on every invocation.
   *
   *    Notes on parallelism:
   *    Each step is awaited sequentially so a 401 on the first call doesn't
   *    rate-limit a fan-out across 6 endpoints simultaneously. Total budget
   *    is ~8s (chat ~1s, image ~5s, video submit ~1s, search/reader ~1s each).
   */
  diagnostic: protectedProcedure.mutation(async ({ ctx }) => {
    const apiKey = await resolveKey(ctx.user.uid);
    const platformConfigured = zaiService.isConfigured(apiKey);
    const usingByok = !!apiKey;

    type Step = {
      name: string;
      status: 'pass' | 'fail' | 'skip';
      latencyMs: number;
      detail?: string;
      sample?: unknown;
    };
    const steps: Step[] = [];

    async function run<T>(name: string, fn: () => Promise<T>, sampler?: (r: T) => unknown) {
      const t0 = Date.now();
      try {
        const result = await fn();
        steps.push({
          name,
          status: 'pass',
          latencyMs: Date.now() - t0,
          sample: sampler ? sampler(result) : truncateForLog(result),
        });
        return result;
      } catch (err) {
        steps.push({
          name,
          status: 'fail',
          latencyMs: Date.now() - t0,
          detail: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    if (!platformConfigured) {
      return {
        ok: false,
        platformConfigured,
        usingByok,
        steps: [
          {
            name: 'config',
            status: 'fail' as const,
            latencyMs: 0,
            detail:
              'No Z.AI API key. Set ZAI_API_KEY in root .env or paste a key in /settings/api-keys.',
          },
        ],
      };
    }

    // 1. Chat — cheapest sanity check (GLM-4.5-Air, 4 tokens).
    await run('chat (glm-4.5-air)', () =>
      zaiService.chat({
        apiKey,
        model: 'glm-4.5-air',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 4,
      })
    );

    // 2. Chat with structured JSON output — the worldbuilder's contract.
    await run('chat json mode (glm-4.6)', () =>
      zaiService.chatJson<{ ok: boolean }>({
        apiKey,
        model: 'glm-4.6',
        maxTokens: 50,
        messages: [
          {
            role: 'system',
            content: 'Reply with strict JSON: {"ok": true}. JSON only.',
          },
          { role: 'user', content: 'go' },
        ],
      })
    );

    // 3. Vision — uses a tiny public placeholder so failure means the
    //    parameter contract changed, not that the image is bad.
    await run('vision (glm-4.5v)', () =>
      zaiService.vision({
        apiKey,
        model: 'glm-4.5v',
        maxTokens: 80,
        prompt: 'In one short sentence, describe what you see.',
        imageUrls: ['https://placehold.co/256x256/png'],
      })
    );

    // 4. Image generation — `glm-image` is the only id Z.AI's paas/v4
    //    surface accepts; `cogview-*` returns code 1211. Smallest size.
    await run(
      'image (glm-image)',
      () =>
        zaiService.generateImage({
          apiKey,
          prompt: 'a single red square on white background',
          model: 'glm-image',
          size: '1024x1024',
        }),
      (r) => ({
        status: r.status,
        imageCount: r.images.length,
        firstUrl: r.images[0]?.url ? truncateString(r.images[0].url, 80) : null,
        error: r.error ?? null,
      })
    );

    // 5. Video submit — fire-and-forget, returns task id only. Uses
    //    `viduq1-text` (the only T2V model id Z.AI exposes; `cogvideox-*`
    //    is rejected). 5s is the minimum supported duration.
    await run(
      'video submit (viduq1-text)',
      () =>
        zaiService.submitVideo({
          apiKey,
          prompt: 'a single dot pulsing on a black background',
          model: 'viduq1-text',
          duration: 5,
          aspectRatio: '1:1',
        }),
      (r) => ({ status: r.status, taskId: r.id, error: r.error ?? null })
    );

    // 6. Web search.
    await run(
      'web search',
      () => zaiService.webSearch({ apiKey, query: 'ping', count: 1 }),
      (r) => ({
        resultCount: r.results.length,
        first: r.results[0]?.title?.slice(0, 80),
      })
    );

    // 7. Web reader (uses example.com — known-stable target).
    await run(
      'web reader',
      () => zaiService.webReader({ apiKey, url: 'https://example.com' }),
      (r) => ({ contentLength: r.content.length, title: r.title })
    );

    // 8. ASR — requires an actual audio source so we mark it skipped
    //    rather than fail when no public clip is configured. Set the env
    //    var ZAI_DIAG_AUDIO_URL to a public mp3/wav to enable.
    const diagAudioUrl = process.env.ZAI_DIAG_AUDIO_URL?.trim() || '';
    if (diagAudioUrl) {
      await run('asr (glm-asr)', () => zaiService.transcribe({ apiKey, url: diagAudioUrl }));
    } else {
      steps.push({
        name: 'asr (glm-asr)',
        status: 'skip',
        latencyMs: 0,
        detail: 'Set ZAI_DIAG_AUDIO_URL to a public mp3/wav URL to test transcription.',
      });
    }

    const passes = steps.filter((s) => s.status === 'pass').length;
    const fails = steps.filter((s) => s.status === 'fail').length;
    return {
      ok: fails === 0,
      platformConfigured,
      usingByok,
      summary: { total: steps.length, passes, fails },
      steps,
    };
  }),

  /**
   * 1. Generic chat — full GLM-5.x access. Powers the lab page and any
   *    downstream agent surface that wants raw model access.
   */
  chat: protectedProcedure
    .use(requirePermission('generation.create'))
    .input(
      z.object({
        model: chatModelSchema.optional(),
        messages: z.array(messageSchema).min(1),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().max(8192).optional(),
        thinking: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const result = await zaiService.chat({
        apiKey,
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        thinking: input.thinking,
      });
      return {
        content: result.content,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    }),

  /**
   * 2. Worldbuild — prompt → entity bundle → auto-create in Firestore.
   *    The "seed a Universe in 30 seconds" demo moment.
   */
  worldbuild: expensiveProcedure
    .use(requirePermission('entities.create'))
    .input(
      z.object({
        prompt: z.string().min(8).max(2000),
        universeAddress: z.string().nullable().optional(),
        persist: z.boolean().default(true),
        model: chatModelSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);

      const { data } = await zaiService.chatJson<WorldbuildBundle>({
        apiKey,
        model: input.model ?? 'glm-4.6',
        temperature: 0.85,
        maxTokens: 4000,
        messages: [
          { role: 'system', content: WORLDBUILD_SYSTEM },
          { role: 'user', content: input.prompt },
        ],
      });

      const validKinds = new Set(ENTITY_KINDS as readonly string[]);
      const filtered = (data.entities ?? []).filter((e) => validKinds.has(e.kind));
      if (filtered.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Z.AI returned an empty or invalid worldbuild bundle',
        });
      }

      let createdIds: string[] = [];
      if (input.persist) {
        const creator = ctx.user.address ?? ctx.user.uid;
        const created = await Promise.all(
          filtered.map((e) =>
            createEntity(
              {
                kind: e.kind,
                name: e.name,
                description: e.description,
                metadata: e.metadata ?? {},
                universeAddress: input.universeAddress ?? null,
                parentId: null,
                nodeIds: [],
                imageUrl: null,
                monetized: false,
              } as Parameters<typeof createEntity>[0],
              creator
            ).catch((err) => {
              console.warn('[zai.worldbuild] entity create failed', e.name, err);
              return null;
            })
          )
        );
        createdIds = created.flatMap((r) => (r ? [r.id] : []));
      }

      return {
        universe: data.universe,
        entityCount: filtered.length,
        entityIds: createdIds,
        entities: filtered,
      };
    }),

  /**
   * 3. Seed-from-URL — Web Reader fetches a page, GLM-4.6 turns it into an
   *    entity bundle. "Wikipedia article → playable Universe in one click."
   */
  seedFromUrl: expensiveProcedure
    .use(requirePermission('entities.create'))
    .input(
      z.object({
        url: z.string().url(),
        universeAddress: z.string().nullable().optional(),
        persist: z.boolean().default(true),
        model: chatModelSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const reader = await zaiService.webReader({ apiKey, url: input.url });
      if (!reader.content) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Z.AI Web Reader could not extract content from ${input.url}`,
        });
      }

      const { data } = await zaiService.chatJson<WorldbuildBundle>({
        apiKey,
        model: input.model ?? 'glm-4.6',
        temperature: 0.7,
        maxTokens: 4000,
        messages: [
          { role: 'system', content: WORLDBUILD_SYSTEM },
          {
            role: 'user',
            content: `Article title: ${reader.title ?? '(untitled)'}\nSource URL: ${reader.url}\n\n---\n${reader.content.slice(0, 12000)}\n\n---\nTurn this real-world source into an evocative LOAR universe with 6–10 entities. Keep proper nouns where they appear, but you may invent supporting characters.`,
          },
        ],
      });

      const validKinds = new Set(ENTITY_KINDS as readonly string[]);
      const filtered = (data.entities ?? []).filter((e) => validKinds.has(e.kind));

      let createdIds: string[] = [];
      if (input.persist && filtered.length > 0) {
        const creator = ctx.user.address ?? ctx.user.uid;
        const created = await Promise.all(
          filtered.map((e) =>
            createEntity(
              {
                kind: e.kind,
                name: e.name,
                description: e.description,
                metadata: { ...(e.metadata ?? {}), sourceUrl: input.url },
                universeAddress: input.universeAddress ?? null,
                parentId: null,
                nodeIds: [],
                imageUrl: null,
                monetized: false,
              } as Parameters<typeof createEntity>[0],
              creator
            ).catch(() => null)
          )
        );
        createdIds = created.flatMap((r) => (r ? [r.id] : []));
      }

      return {
        universe: data.universe,
        sourceTitle: reader.title,
        entityCount: filtered.length,
        entityIds: createdIds,
        entities: filtered,
      };
    }),

  /**
   * 4. Web Search — direct surface for canon-research UIs. Returns top
   *    results with snippets so a creator can ground their lore in real facts.
   */
  webSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(500),
        engine: z.enum(['search_std', 'search_pro', 'search_pro_sogou']).optional(),
        count: z.number().int().min(1).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const out = await zaiService.webSearch({
        apiKey,
        query: input.query,
        searchEngine: input.engine,
        count: input.count,
      });
      return out.results;
    }),

  /**
   * 5. Generate image (CogView-4 / GLM-Image), rehosted on the LOAR
   *    storage stack so judges see canonical loar.fun URLs in the gallery.
   */
  generateImage: expensiveProcedure
    .use(requirePermission('generation.create'))
    .input(
      z.object({
        prompt: z.string().min(2).max(2000),
        model: z.enum(['glm-image']).default('glm-image'),
        size: z.string().optional(),
        n: z.number().int().min(1).max(4).optional(),
        imageUrl: z.string().url().optional(),
        rehost: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const result = await zaiService.generateImage({
        apiKey,
        prompt: input.prompt,
        model: input.model,
        size: input.size,
        n: input.n,
        imageUrl: input.imageUrl,
        userId: ctx.user.uid,
      });

      if (result.status !== 'completed' || result.images.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error ?? 'Z.AI image generation failed',
        });
      }

      const userId = ctx.user.address ?? ctx.user.uid;
      const finalImages = await Promise.all(
        result.images.map(async (img, idx) => {
          if (!img.url) return img;
          if (!input.rehost) return { url: img.url };
          const filename = `zai-img-${Date.now()}-${idx}.png`;
          const url = await rehostUrl(img.url, filename, 'image/png', userId);
          return { url };
        })
      );

      return {
        model: input.model,
        prompt: input.prompt,
        images: finalImages,
      };
    }),

  /**
   * 6. Generate video (CogVideoX-3 / Vidu Q1). Long-running — polled inside
   *    the service. Output is rehosted via StorageManager so it lives on
   *    Pinata/Lighthouse alongside every other generation.
   */
  generateVideo: expensiveProcedure
    .use(requirePermission('generation.create'))
    .input(
      z.object({
        prompt: z.string().min(2).max(2000),
        model: z.enum(['viduq1-text', 'viduq1-image']).default('viduq1-text'),
        imageUrl: z.string().url().optional(),
        endImageUrl: z.string().url().optional(),
        duration: z.number().int().min(2).max(15).optional(),
        quality: z.enum(['720p', '1080p']).optional(),
        aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']).optional(),
        withAudio: z.boolean().optional(),
        style: z.string().max(80).optional(),
        rehost: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const result = await zaiService.generateVideo({
        apiKey,
        prompt: input.prompt,
        model: input.model,
        imageUrl: input.imageUrl,
        endImageUrl: input.endImageUrl,
        duration: input.duration,
        quality: input.quality,
        aspectRatio: input.aspectRatio,
        withAudio: input.withAudio,
        style: input.style,
        userId: ctx.user.uid,
      });

      if (result.status !== 'completed' || !result.videoUrl) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error ?? 'Z.AI video generation failed',
        });
      }

      const userId = ctx.user.address ?? ctx.user.uid;
      const finalUrl = input.rehost
        ? await rehostUrl(result.videoUrl, `zai-vid-${result.id}.mp4`, 'video/mp4', userId)
        : result.videoUrl;
      const finalCover = result.coverUrl
        ? input.rehost
          ? await rehostUrl(result.coverUrl, `zai-vid-${result.id}-cover.jpg`, 'image/jpeg', userId)
          : result.coverUrl
        : null;

      return {
        id: result.id,
        model: input.model,
        videoUrl: finalUrl,
        coverUrl: finalCover,
      };
    }),

  /**
   * 6b. Async video generation — kick off, return job id immediately, poll
   *     from the frontend. Persists progress to `zaiVideoJobs/{taskId}` so
   *     refreshing the page never loses an in-flight render.
   */
  startVideo: expensiveProcedure
    .use(requirePermission('generation.create'))
    .input(
      z.object({
        prompt: z.string().min(2).max(2000),
        model: z.enum(['viduq1-text', 'viduq1-image']).default('viduq1-text'),
        imageUrl: z.string().url().optional(),
        endImageUrl: z.string().url().optional(),
        duration: z.number().int().min(2).max(15).optional(),
        quality: z.enum(['720p', '1080p']).optional(),
        aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']).optional(),
        withAudio: z.boolean().optional(),
        style: z.string().max(80).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const submitted = await zaiService.submitVideo({
        apiKey,
        ...input,
        userId: ctx.user.uid,
      });
      if (submitted.status === 'failed' || !submitted.id) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: submitted.error ?? 'Z.AI did not return a task id',
        });
      }
      if (firebaseAvailable) {
        await db
          .collection('zaiVideoJobs')
          .doc(submitted.id)
          .set({
            taskId: submitted.id,
            status: 'pending',
            prompt: input.prompt,
            model: input.model,
            imageUrl: input.imageUrl ?? null,
            aspectRatio: input.aspectRatio ?? null,
            duration: input.duration ?? null,
            ownerUid: ctx.user.uid,
            ownerAddress: (ctx.user.address ?? ctx.user.uid).toLowerCase(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            videoUrl: null,
            coverUrl: null,
            error: null,
          })
          .catch((err) => console.warn('[zai.startVideo] persist failed', err));
      }
      return { taskId: submitted.id };
    }),

  /**
   * 6c. Job poller. Live-checks Z.AI when the cached row is still pending,
   *     rehosts the resulting video on LOAR storage on first completion, and
   *     caches everything in Firestore so refreshes are free.
   */
  videoJob: protectedProcedure
    .input(z.object({ taskId: z.string().min(4) }))
    .query(async ({ ctx, input }) => {
      const ref = firebaseAvailable ? db.collection('zaiVideoJobs').doc(input.taskId) : null;
      const cached = ref ? ((await ref.get()).data() ?? null) : null;

      // Authorization: only the owner can read job state.
      if (cached && cached.ownerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your job' });
      }

      // Terminal cached states short-circuit — no Z.AI roundtrip.
      if (cached && (cached.status === 'completed' || cached.status === 'failed')) {
        return cached as Record<string, unknown>;
      }

      const apiKey = await resolveKey(ctx.user.uid);
      const status = await zaiService.getVideoStatus(input.taskId, apiKey);

      let rehostedVideoUrl: string | null = null;
      let rehostedCoverUrl: string | null = null;
      if (status.status === 'completed' && status.videoUrl) {
        const userId = ctx.user.address ?? ctx.user.uid;
        rehostedVideoUrl = await rehostUrl(
          status.videoUrl,
          `zai-vid-${status.id}.mp4`,
          'video/mp4',
          userId
        );
        if (status.coverUrl) {
          rehostedCoverUrl = await rehostUrl(
            status.coverUrl,
            `zai-vid-${status.id}-cover.jpg`,
            'image/jpeg',
            userId
          );
        }
      }

      const merged = {
        ...(cached ?? {}),
        taskId: input.taskId,
        status: status.status,
        videoUrl: rehostedVideoUrl ?? cached?.videoUrl ?? null,
        coverUrl: rehostedCoverUrl ?? cached?.coverUrl ?? null,
        error: status.error ?? null,
        updatedAt: new Date().toISOString(),
      };

      if (ref) {
        await ref.set(merged, { merge: true }).catch(() => {});
      }
      return merged;
    }),

  /**
   * 6d. List the caller's recent Z.AI video jobs (most recent first).
   */
  listVideoJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('zaiVideoJobs')
        .where('ownerUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => d.data() as Record<string, unknown>);
    }),

  /**
   * 7. Talking scene via CogVideoX — alternative to ByteDance OmniHuman.
   *    Pass an actor portrait + line of dialogue, get a talking video back.
   *    The motion-prompt phrasing is curated for lip-sync-friendly output.
   */
  talkingScene: expensiveProcedure
    .use(requirePermission('generation.create'))
    .input(
      z.object({
        actorImageUrl: z.string().url(),
        line: z.string().min(2).max(500),
        emotion: z.string().max(40).optional(),
        aspectRatio: z.enum(['1:1', '16:9', '9:16']).default('9:16'),
        duration: z.number().int().min(4).max(10).default(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const motionPrompt =
        `Close-up portrait of the subject speaking the line: "${input.line}". ` +
        (input.emotion ? `Emotion: ${input.emotion}. ` : '') +
        'Natural lip movement synchronized to the dialogue, subtle head motion, expressive eyes. Keep the subject identity and clothing identical to the reference image.';

      const result = await zaiService.generateVideo({
        apiKey,
        prompt: motionPrompt,
        // viduq1-image is image-conditioned (we always pass actorImageUrl).
        // viduq1 doesn't currently expose inline audio — talkingScene voice
        // can be layered post-hoc via the existing lipsync/elevenlabs flow.
        model: 'viduq1-image',
        imageUrl: input.actorImageUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        userId: ctx.user.uid,
      });

      if (result.status !== 'completed' || !result.videoUrl) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error ?? 'Z.AI talking-scene generation failed',
        });
      }

      const userId = ctx.user.address ?? ctx.user.uid;
      const finalUrl = await rehostUrl(
        result.videoUrl,
        `zai-talk-${result.id}.mp4`,
        'video/mp4',
        userId
      );
      return {
        id: result.id,
        videoUrl: finalUrl,
        line: input.line,
      };
    }),

  /**
   * 8. Canon consistency check — vision model scores an image (or frame
   *    extracted from a clip) against a universe's lore. Returns a 0–100
   *    score + flagged contradictions. Wire this into the publish-to-canon
   *    gesture as a soft gate.
   */
  canonCheck: protectedProcedure
    .input(
      z.object({
        imageUrls: z.array(z.string().url()).min(1).max(6),
        universeName: z.string().min(1).max(120),
        loreSummary: z.string().min(8).max(8000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const result = await zaiService.vision({
        apiKey,
        model: 'glm-4.5v',
        maxTokens: 1200,
        prompt: `You are LOAR's canon consistency reviewer for the universe "${input.universeName}".

Lore summary:
"""
${input.loreSummary.slice(0, 6000)}
"""

Look at the attached image(s). Score 0-100 how well they fit the universe's canonical lore (visual style, period, characters, technology). Then list up to 5 specific contradictions with the lore. Respond with strict JSON:

{
  "score": number,                       // 0-100
  "verdict": "canonical" | "borderline" | "off-canon",
  "contradictions": Array<{ severity: "low" | "med" | "high", note: string }>,
  "summary": string                       // one short paragraph
}

Output JSON only.`,
        imageUrls: input.imageUrls,
      });

      let parsed: {
        score: number;
        verdict: string;
        contradictions: Array<{ severity: string; note: string }>;
        summary: string;
      };
      try {
        const stripped = result.content
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();
        parsed = JSON.parse(stripped);
      } catch {
        parsed = {
          score: 50,
          verdict: 'borderline',
          contradictions: [],
          summary: result.content.slice(0, 500),
        };
      }
      return parsed;
    }),

  /**
   * 8b. Episode-aware canon preview — extracts a real frame from the first
   *     clip and runs it against the universe lore. UI calls this before the
   *     publishAsCanon click so creators see the score in advance.
   */
  canonCheckEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await runEpisodeCanonCheck(input.episodeId, ctx.user.uid);
      if (!result) {
        return {
          skipped: true as const,
          reason:
            'Canon check skipped — Z.AI not configured, no playable first clip, or thumbnail extraction failed.',
        };
      }
      return { skipped: false as const, ...result };
    }),

  /**
   * 9. Governance agent — for Track 4. Summarizes an on-chain proposal
   *    (or any plain-English motion) against the universe's charter and
   *    returns a recommended vote with reasoning. Designed to be invoked
   *    by an OpenClaw-style agent or directly from the UI.
   */
  governanceAgent: protectedProcedure
    .input(
      z.object({
        proposalTitle: z.string().min(1).max(200),
        proposalBody: z.string().min(8).max(8000),
        charter: z.string().max(4000).optional(),
        proposerAddress: z.string().optional(),
        voterAddress: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = await resolveKey(ctx.user.uid);
      const { data } = await zaiService.chatJson<{
        recommendation: 'for' | 'against' | 'abstain';
        confidence: number;
        rationale: string;
        risks: string[];
        charterAlignment: string;
      }>({
        apiKey,
        model: 'glm-4.6',
        temperature: 0.4,
        maxTokens: 1200,
        thinking: true,
        messages: [
          {
            role: 'system',
            content:
              'You are LOAR\'s governance reviewer. Evaluate a DAO proposal on its merits. Output strict JSON: { recommendation: "for"|"against"|"abstain", confidence: 0-1, rationale: string, risks: string[], charterAlignment: string }. JSON only.',
          },
          {
            role: 'user',
            content: `Universe charter:\n${input.charter ?? '(not provided)'}\n\nProposal title: ${input.proposalTitle}\nProposer: ${input.proposerAddress ?? 'unknown'}\nVoter: ${input.voterAddress ?? 'unknown'}\n\nProposal body:\n${input.proposalBody}`,
          },
        ],
      });
      return data;
    }),

  /**
   * 10. Transcribe — GLM-ASR for voice memos and uploaded clips.
   */
  transcribe: protectedProcedure
    .input(
      z.object({
        url: z.string().url().optional(),
        base64: z.string().optional(),
        mimeType: z.string().optional(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.url && !input.base64) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'url or base64 required' });
      }
      const apiKey = await resolveKey(ctx.user.uid);
      const out = await zaiService.transcribe({
        apiKey,
        url: input.url,
        base64: input.base64,
        mimeType: input.mimeType,
        language: input.language,
      });
      return { text: out.text, language: out.language, segments: out.segments };
    }),

  /**
   * 11. Episode-from-voice — voice memo → ASR → GLM-4.6 → structured
   *     episode draft (title, logline, scene list, dialogue). Mobile-first
   *     creator flow: tap-and-hold to record an idea, ship a fully formed
   *     episode skeleton.
   */
  episodeFromVoice: expensiveProcedure
    .use(requirePermission('generation.create'))
    .input(
      z.object({
        url: z.string().url().optional(),
        base64: z.string().optional(),
        mimeType: z.string().optional(),
        language: z.string().optional(),
        universeAddress: z.string().nullable().optional(),
        persistDraft: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.url && !input.base64) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'url or base64 required' });
      }
      const apiKey = await resolveKey(ctx.user.uid);

      const transcript = await zaiService.transcribe({
        apiKey,
        url: input.url,
        base64: input.base64,
        mimeType: input.mimeType,
        language: input.language,
      });

      if (!transcript.text) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Empty transcript from Z.AI ASR',
        });
      }

      const { data } = await zaiService.chatJson<{
        title: string;
        logline: string;
        tone: string;
        scenes: Array<{ heading: string; action: string; dialogue?: string }>;
      }>({
        apiKey,
        model: 'glm-4.6',
        temperature: 0.7,
        maxTokens: 2000,
        messages: [
          {
            role: 'system',
            content:
              "You are LOAR's episode-draft writer. Convert a creator voice transcript into a structured episode draft. Output strict JSON: { title, logline, tone, scenes: Array<{ heading, action, dialogue? }> } with 3–6 scenes. JSON only.",
          },
          { role: 'user', content: transcript.text },
        ],
      });

      let draftId: string | null = null;
      if (input.persistDraft && firebaseAvailable) {
        try {
          const ref = await db.collection('episodeDrafts').add({
            ...data,
            transcript: transcript.text,
            universeAddress: input.universeAddress ?? null,
            creator: (ctx.user.address ?? ctx.user.uid).toLowerCase(),
            source: 'zai-voice',
            createdAt: new Date(),
          });
          draftId = ref.id;
        } catch (err) {
          console.warn('[zai.episodeFromVoice] draft persist failed', err);
        }
      }

      return {
        transcript: transcript.text,
        language: transcript.language,
        draft: data,
        draftId,
      };
    }),
});

export type ZaiRouter = typeof zaiRouter;

// ── Diagnostic helpers ───────────────────────────────────────────────────

function truncateString(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Best-effort sample for the diagnostic UI: returns at most 1KB of JSON, with
 * any obvious credential-shaped fields stripped. Never throws — if the value
 * isn't serializable, returns "[unserializable]".
 */
function truncateForLog(v: unknown): unknown {
  try {
    const json = JSON.stringify(
      v,
      (_k, val) => {
        if (typeof val === 'string' && val.length > 200) return `${val.slice(0, 200)}…`;
        return val;
      },
      0
    );
    if (json.length > 1024) return `${json.slice(0, 1024)}…`;
    return JSON.parse(json);
  } catch {
    return '[unserializable]';
  }
}
