/**
 * Unified Jobs Router — polymorphic status + cancel across all async
 * generation backends (video, image, voice, 3D, studio packs).
 *
 * Exists so the MCP server can poll ONE endpoint for any tool's progress
 * and translate the normalized shape into `notifications/progress` back to
 * the agent. See docs/prd-mcp-integration.md §5 and B-2 in the Week 1 audit.
 *
 * Kind resolution: we probe the five collections in priority order. The
 * first match wins. Callers pass an optional `kind` hint to skip probes.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { protectedProcedure, router } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { logFailedRefund } from '../../lib/refund-audit';
import { enqueueWebhook } from '../../lib/webhooks';

export const JOB_KINDS = ['video', 'image', 'voice', '3d', 'studio'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const JOB_COLLECTIONS: Record<JobKind, string> = {
  video: 'videoGenerations',
  image: 'imageGenerations',
  voice: 'voiceGenerations',
  '3d': 'threeDGenerations',
  studio: 'studioJobs',
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

type NormalizedStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface NormalizedJob {
  jobId: string;
  kind: JobKind;
  status: NormalizedStatus;
  progress: number | null; // 0..100 when known
  message: string | null;
  resultUrl: string | null;
  resultUrls: string[] | null;
  errorCode: string | null;
  userId: string;
  createdAt: unknown;
  completedAt: unknown;
}

function ensureFirestore() {
  if (!firebaseAvailable || !db) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Firebase not configured',
    });
  }
}

function coerceStatus(raw: unknown): NormalizedStatus {
  if (raw === 'completed' || raw === 'failed' || raw === 'cancelled' || raw === 'running') {
    return raw;
  }
  return 'queued';
}

function normalize(kind: JobKind, jobId: string, data: Record<string, any>): NormalizedJob {
  const status = coerceStatus(data.status);

  // Extract a result URL per kind — different shapes in each collection.
  let resultUrl: string | null = null;
  let resultUrls: string[] | null = null;
  switch (kind) {
    case 'video':
      resultUrl = data.permanentVideoUrl ?? data.videoUrl ?? null;
      break;
    case 'image':
      resultUrls =
        Array.isArray(data.imageUrls) && data.imageUrls.length > 0 ? data.imageUrls : null;
      resultUrl = resultUrls?.[0] ?? null;
      break;
    case 'voice':
      resultUrl = data.audioUrl ?? null;
      break;
    case '3d':
      // Meshy model URL field varies — check a few likely shapes
      resultUrl = data.modelUrl ?? data.glbUrl ?? null;
      break;
    case 'studio':
      // Studio packs don't produce a single URL — the frontend renders tasks[]
      resultUrl = null;
      break;
  }

  const progress =
    status === 'completed' ? 100 : status === 'failed' || status === 'cancelled' ? 100 : null;

  const message =
    status === 'failed'
      ? (data.failureReason ?? null)
      : status === 'cancelled'
        ? (data.cancelReason ?? 'cancelled')
        : null;

  const errorCode = status === 'failed' ? 'UPSTREAM_TIMEOUT' : null;

  return {
    jobId,
    kind,
    status,
    progress,
    message,
    resultUrl,
    resultUrls,
    errorCode,
    userId: data.userId ?? '',
    createdAt: data.createdAt ?? null,
    completedAt: data.completedAt ?? null,
  };
}

async function findJob(jobId: string, kindHint?: JobKind): Promise<NormalizedJob | null> {
  ensureFirestore();
  const probeOrder: JobKind[] = kindHint
    ? [kindHint, ...JOB_KINDS.filter((k) => k !== kindHint)]
    : [...JOB_KINDS];

  for (const kind of probeOrder) {
    const doc = await db!.collection(JOB_COLLECTIONS[kind]).doc(jobId).get();
    if (doc.exists) {
      return normalize(kind, doc.id, doc.data() ?? {});
    }
  }
  return null;
}

// ── Router ─────────────────────────────────────────────────────────────

export const jobsRouter = router({
  /**
   * Poll for normalized job status. The MCP server calls this every 2s
   * while streaming `notifications/progress` to the agent. Probes all
   * 5 generation collections by default; pass `kind` to skip probes.
   */
  status: protectedProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
        kind: z.enum(JOB_KINDS).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const job = await findJob(input.jobId, input.kind);
      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      }
      if (job.userId && job.userId.toLowerCase() !== ctx.user.uid.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the job owner' });
      }
      return job;
    }),

  /**
   * Cross-collection cancel. Marks the Firestore record as cancelled,
   * refunds unconsumed credits where possible, and returns an idempotent
   * no-op for terminal jobs. Background workers (studio, 3d) check the
   * `status` field at safe points and skip remaining work.
   */
  cancel: protectedProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
        kind: z.enum(JOB_KINDS).optional(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      ensureFirestore();
      const job = await findJob(input.jobId, input.kind);
      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      }
      if (job.userId && job.userId.toLowerCase() !== ctx.user.uid.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the job owner' });
      }

      if (TERMINAL_STATUSES.has(job.status)) {
        return {
          ok: true,
          refunded: 0,
          alreadyTerminal: true as const,
          status: job.status,
          kind: job.kind,
        };
      }

      const ref = db!.collection(JOB_COLLECTIONS[job.kind]).doc(job.jobId);
      const snap = await ref.get();
      const d = (snap.data() ?? {}) as any;

      // Refund credits: video/image/voice/3d use `creditsCharged`; studio uses `totalCreditsCharged`.
      const creditsToRefund =
        (job.kind === 'studio' ? d.totalCreditsCharged : d.creditsCharged) ?? 0;

      let refunded = 0;
      if (creditsToRefund > 0 && !d.creditsRefunded) {
        try {
          const userCreditsRef = db!.collection('userCredits').doc(ctx.user.uid);
          await userCreditsRef.update({
            balance: FieldValue.increment(creditsToRefund),
            totalSpent: FieldValue.increment(-creditsToRefund),
            updatedAt: new Date(),
          });
          refunded = creditsToRefund;
        } catch (err) {
          logFailedRefund({
            userId: ctx.user.uid,
            credits: creditsToRefund,
            source: `jobs.cancel:${job.kind}`,
            generationId: job.jobId,
            error: err instanceof Error ? err.message : 'Unknown',
          });
        }
      }

      await ref.update({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: input.reason ?? null,
        creditsRefunded: refunded > 0 ? true : (d.creditsRefunded ?? false),
        completedAt: new Date(),
      });

      // Fire webhook if the job was registered with one.
      if (typeof d.webhookUrl === 'string' && d.webhookUrl.length > 0) {
        void enqueueWebhook({
          ownerUid: ctx.user.uid,
          url: d.webhookUrl,
          clientToken: typeof d.clientToken === 'string' ? d.clientToken : undefined,
          event: 'job.cancelled',
          payload: {
            jobId: job.jobId,
            kind: job.kind,
            status: 'cancelled',
            reason: input.reason ?? null,
            creditsRefunded: refunded,
          },
        });
      }

      return {
        ok: true,
        refunded,
        alreadyTerminal: false as const,
        status: 'cancelled' as const,
        kind: job.kind,
      };
    }),
});
