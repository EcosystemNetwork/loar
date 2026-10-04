/**
 * Tripo world-building job runner.
 *
 * Every world-building feature (entity → 3D, character puppet, parts
 * library, restyle, export, place → splat) is a short chain of Tripo tasks.
 * This module gives them one durable lifecycle:
 *
 *   startTripoJob()  — writes a `threeDGenerations` doc (provider: 'tripo',
 *                      type: `tripo_<kind>`, status `queued`) holding the
 *                      pipeline's serialisable `pipelineArgs`, then runs it
 *                      in the background once the user has a free slot
 *                      (MAX_ACTIVE_PER_USER — Tripo 429s accounts with too
 *                      many tasks in flight).
 *   runTripoJob()    — runs the pipeline body with a `ctx` whose `step()`
 *                      submits a Tripo task, polls it, and records per-step
 *                      progress + task id on the doc; marks the doc
 *                      `completed` / `failed`.
 *   resumeStaleTripoJobs() — jobs live in process memory, so a redeploy or
 *                      crash used to strand them as `running` forever. A
 *                      sweep (boot + every few minutes) re-runs any job whose
 *                      heartbeat went stale.
 *   retryTripoJob()  — re-run a failed job.
 *
 * Resume and retry re-run the pipeline from the top, but `step()` replays
 * steps that already have a Tripo task id (polls the existing task instead
 * of submitting a new one), so finished work is never paid for twice — a
 * puppet that failed at the rig step re-uses its turnaround and body.
 * Pipelines make their persistence idempotent for the same reason.
 *
 * BYOK only (see provider-keys/dispatcher.ts) — the caller resolves the
 * user's Tripo key before anything is written; resume re-resolves it.
 *
 * Tripo output URLs are signed and expire — `ctx.keep()` rehosts a URL to
 * permanent storage and must wrap every URL that gets persisted.
 */
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { rehostEphemeralUrl } from '../../lib/rehost-ephemeral';
import { releaseHoldOnError, reserveThreedBudget, settleThreedJob } from '../../lib/threed-budget';
import { withReservation } from '../credits';
import { tripo3dService, type TripoTask } from '../tripo3d';
import { webOptimizeUrl } from './optimize';

export type TripoJobKind =
  | 'entity_model'
  | 'character_puppet'
  | 'segment'
  | 'extract_part'
  | 'restyle'
  | 'stylize'
  | 'convert'
  | 'place_splat';

export type TripoJobStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Provider cost estimates (USD) per job kind — Tripo bills $0.01/credit. */
export const TRIPO_JOB_COST_USD: Record<TripoJobKind, number> = {
  // image→model with detailed texture + PBR ≈ 30-40 credits
  entity_model: 0.4,
  // t-pose image + multiview + multiview→model + rig + 4 retargets
  character_puppet: 1.2,
  // segment + AI completion
  segment: 0.5,
  extract_part: 0.1,
  restyle: 0.3,
  stylize: 0.2,
  convert: 0.1,
  place_splat: 0.3,
};

export interface TripoJobStep {
  name: string;
  taskId?: string;
  status: 'running' | 'success' | 'failed';
  progress?: number;
  /** Replayed from an earlier run (resume/retry) — not re-billed. */
  reused?: boolean;
}

export const threeDGenCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('threeDGenerations');
};

export interface TripoJobContext {
  genId: string;
  userId: string;
  apiKey: string;
  /** Submit a Tripo task (or replay an earlier run's), poll it to success, record it. */
  step(name: string, submit: () => Promise<{ taskId: string }>): Promise<TripoTask>;
  /** Rehost a signed Tripo URL to permanent storage (pass-through for others). */
  keep(url: string | undefined | null, filename: string): Promise<string | null>;
  /** Web-delivery copy of a permanent GLB (see optimize.ts); null = use the original. */
  optimize(url: string | undefined | null, filename: string): Promise<string | null>;
  /** Merge fields onto the job doc (partial results the UI can show early). */
  patch(fields: Record<string, unknown>): Promise<void>;
}

export type TripoPipelineRun = (ctx: TripoJobContext) => Promise<Record<string, unknown>>;
/** kind → factory from the job's stored `pipelineArgs` (see pipelines.ts TRIPO_PIPELINES). */
export type TripoPipelineFactory = (args: any) => TripoPipelineRun;

export interface CreateTripoJobInput {
  kind: TripoJobKind;
  userId: string;
  apiKey: string;
  /** JSON-serialisable pipeline input — persisted so the job can resume/retry. */
  args: Record<string, unknown>;
  universeId?: string | null;
  entityId?: string | null;
  sourceContentId?: string | null;
  /** Extra fields recorded on the doc at creation (inputs, labels…). */
  meta?: Record<string, unknown>;
}

const STEP_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 4000;
export const MAX_ACTIVE_PER_USER = 3;
const HEARTBEAT_MS = 30 * 1000;
/** A running/queued job whose heartbeat is older than this is presumed orphaned. */
export const STALE_AFTER_MS = 3 * 60 * 1000;
const MAX_RESUMES = 3;

/** Test seam: shrink poll/heartbeat intervals. */
export const runnerTiming = { pollMs: POLL_MS, heartbeatMs: HEARTBEAT_MS };

async function loadPipelines(): Promise<Partial<Record<TripoJobKind, TripoPipelineFactory>>> {
  // Dynamic import: pipelines.ts imports this module's types/helpers.
  const { TRIPO_PIPELINES } = await import('./pipelines');
  return TRIPO_PIPELINES;
}

// ── Per-user concurrency ─────────────────────────────────────────────────

const activeByUser = new Map<string, number>();
const waitingByUser = new Map<string, Array<() => void>>();
/** Jobs executing in this process — the resume sweep never touches them. */
const localJobs = new Set<string>();

async function withUserSlot<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if ((activeByUser.get(userId) ?? 0) >= MAX_ACTIVE_PER_USER) {
    await new Promise<void>((resolve) => {
      const q = waitingByUser.get(userId) ?? [];
      q.push(resolve);
      waitingByUser.set(userId, q);
    });
  }
  activeByUser.set(userId, (activeByUser.get(userId) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const left = (activeByUser.get(userId) ?? 1) - 1;
    if (left > 0) activeByUser.set(userId, left);
    else activeByUser.delete(userId);
    const q = waitingByUser.get(userId);
    const next = q?.shift();
    if (q && !q.length) waitingByUser.delete(userId);
    next?.();
  }
}

// ── Start / retry ────────────────────────────────────────────────────────

/**
 * Create the job doc, then run the pipeline in the background. Returns as
 * soon as the doc exists; throws (with nothing billed) when the kill switch
 * or a 3D spend cap refuses the job.
 */
export async function startTripoJob(input: CreateTripoJobInput): Promise<{ jobId: string }> {
  const genId = randomUUID();
  const costUsd = TRIPO_JOB_COST_USD[input.kind];
  const hold = await reserveThreedBudget('tripo', costUsd);

  return releaseHoldOnError(hold, () =>
    withReservation(
      {
        userId: input.userId,
        modelId: `tripo-${input.kind}`,
        provider: 'tripo',
        estimatedCredits: 0,
        byok: true,
        meta: { genId, kind: input.kind },
      },
      async () => {
        const now = new Date();
        await threeDGenCol()
          .doc(genId)
          .set({
            id: genId,
            userId: input.userId,
            provider: 'tripo',
            type: `tripo_${input.kind}`,
            kind: input.kind,
            status: 'queued' satisfies TripoJobStatus,
            steps: [],
            pipelineArgs: input.args,
            entityId: input.entityId ?? null,
            universeId: input.universeId ?? null,
            sourceContentId: input.sourceContentId ?? null,
            providerCostUsd: costUsd,
            createdAt: now,
            heartbeatAt: now,
            ...(input.meta ?? {}),
          });

        settleThreedJob({
          hold,
          done: runTripoJob(genId, input.kind, input.userId, input.apiKey, input.args),
          provider: 'tripo',
          model: `tripo-${input.kind}`,
          costUsd,
          readStatus: async () =>
            (await threeDGenCol().doc(genId).get()).data()?.status as string | undefined,
          extra: { generationId: genId },
        });
        return { result: { jobId: genId } };
      }
    )
  );
}

/**
 * Re-run a failed job. Steps that already produced a Tripo task are
 * replayed, so only the failed step (and what follows) is billed again.
 */
export async function retryTripoJob(genId: string, userId: string, apiKey: string): Promise<void> {
  const ref = threeDGenCol().doc(genId);
  const snap = await ref.get();
  const d = snap.data();
  if (!d || d.userId !== userId || d.provider !== 'tripo') throw new Error('Job not found');
  if (d.status !== 'failed') throw new Error('Only failed jobs can be retried');
  if (!d.pipelineArgs) throw new Error('This job predates retries — start it again instead');

  const kind = d.kind as TripoJobKind;
  const costUsd = TRIPO_JOB_COST_USD[kind];
  const hold = await reserveThreedBudget('tripo', costUsd);
  await releaseHoldOnError(hold, async () => {
    const now = new Date();
    await ref.update({
      status: 'queued' satisfies TripoJobStatus,
      failureReason: null,
      completedAt: null,
      retryCount: (d.retryCount ?? 0) + 1,
      heartbeatAt: now,
      updatedAt: now,
    });
    settleThreedJob({
      hold,
      done: runTripoJob(genId, kind, userId, apiKey, d.pipelineArgs),
      provider: 'tripo',
      model: `tripo-${kind}`,
      costUsd,
      readStatus: async () => (await ref.get()).data()?.status as string | undefined,
      extra: { generationId: genId, retry: true },
    });
  });
}

// ── Execution ────────────────────────────────────────────────────────────

/** Never rejects — failures are recorded on the job doc. */
export function runTripoJob(
  genId: string,
  kind: TripoJobKind,
  userId: string,
  apiKey: string,
  args: Record<string, unknown>
): Promise<void> {
  localJobs.add(genId);
  return withUserSlot(userId, () => executeJob(genId, kind, userId, apiKey, args))
    .catch((err) => console.error(`[tripo-world] job ${genId} crashed:`, err))
    .finally(() => localJobs.delete(genId));
}

async function executeJob(
  genId: string,
  kind: TripoJobKind,
  userId: string,
  apiKey: string,
  args: Record<string, unknown>
): Promise<void> {
  const ref = threeDGenCol().doc(genId);
  const prior = ((await ref.get()).data()?.steps ?? []) as TripoJobStep[];
  const steps: TripoJobStep[] = [];
  const saveSteps = () =>
    ref.update({ steps, updatedAt: new Date(), heartbeatAt: new Date() }).catch(() => undefined);

  const startedAt = new Date();
  await ref.update({ status: 'running', startedAt, heartbeatAt: startedAt, updatedAt: startedAt });
  const heartbeat = setInterval(() => {
    void ref.update({ heartbeatAt: new Date() }).catch(() => undefined);
  }, runnerTiming.heartbeatMs);
  heartbeat.unref?.();

  const ctx: TripoJobContext = {
    genId,
    userId,
    apiKey,
    async step(name, submit) {
      const idx = steps.length;
      const earlier = prior[idx];
      const entry: TripoJobStep = { name, status: 'running', progress: 0 };
      steps.push(entry);
      // Replay: same step, already has a task that didn't fail → poll it.
      if (earlier?.name === name && earlier.taskId && earlier.status !== 'failed') {
        entry.taskId = earlier.taskId;
        entry.reused = true;
        await saveSteps();
        try {
          return await finishStep(entry, apiKey, saveSteps);
        } catch (err) {
          // Tripo garbage-collects old tasks; fall through to a fresh submit.
          console.warn(`[tripo-world] job ${genId}: replay of ${name} failed, resubmitting:`, err);
          entry.reused = false;
          entry.status = 'running';
          entry.progress = 0;
        }
      }
      await saveSteps();
      try {
        const { taskId } = await submit();
        entry.taskId = taskId;
        await saveSteps();
        return await finishStep(entry, apiKey, saveSteps);
      } catch (err) {
        entry.status = 'failed';
        await saveSteps();
        throw err;
      }
    },
    async keep(url, filename) {
      if (!url) return null;
      const { url: permanent } = await rehostEphemeralUrl(url, filename, userId);
      return permanent;
    },
    optimize(url, filename) {
      return webOptimizeUrl(url, filename, userId);
    },
    async patch(fields) {
      await ref.update({ ...fields, updatedAt: new Date() });
    },
  };

  try {
    const factory = (await loadPipelines())[kind];
    if (!factory) throw new Error(`No pipeline registered for ${kind}`);
    const result = await factory(args)(ctx);
    await ref.update({ status: 'completed', result, completedAt: new Date() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[tripo-world] job ${genId} (${kind}) failed:`, err);
    await ref
      .update({ status: 'failed', failureReason: message.slice(0, 500), completedAt: new Date() })
      .catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
  }
}

async function finishStep(
  entry: TripoJobStep,
  apiKey: string,
  saveSteps: () => Promise<unknown>
): Promise<TripoTask> {
  const task = await waitWithProgress(entry.taskId!, apiKey, async (p) => {
    entry.progress = p;
    await saveSteps();
  });
  entry.status = 'success';
  entry.progress = 100;
  await saveSteps();
  return task;
}

/** Poll a task, reporting progress changes; same failure semantics as waitForTask. */
async function waitWithProgress(
  taskId: string,
  apiKey: string,
  onProgress: (p: number) => Promise<void>
): Promise<TripoTask> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = -1;
  while (Date.now() < deadline) {
    const task = await tripo3dService.getTask(taskId, apiKey);
    if (task.status === 'success') return task;
    if (task.status !== 'queued' && task.status !== 'running') {
      throw new Error(
        `Tripo3D task ${taskId} ${task.status}: ${task.error_message || task.error_code || 'unknown'}`
      );
    }
    const p = task.progress ?? 0;
    if (p !== last) {
      last = p;
      await onProgress(p);
    }
    await new Promise((r) => setTimeout(r, runnerTiming.pollMs));
  }
  throw new Error(`Tripo3D task ${taskId} timed out after ${STEP_TIMEOUT_MS / 1000}s`);
}

// ── Resume orphaned jobs ─────────────────────────────────────────────────

const toMillis = (v: any): number =>
  v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : 0;

/**
 * Pick up queued/running jobs nobody is executing (server restarted
 * mid-job, or a crash). Claims each in a transaction so concurrent replicas
 * never double-run a job. Returns how many it resumed / failed.
 */
export async function resumeStaleTripoJobs(
  resolveKey: (userId: string) => Promise<string | undefined | null> = defaultResolveKey
): Promise<{ resumed: number; failed: number }> {
  const out = { resumed: 0, failed: 0 };
  const col = threeDGenCol();
  const snaps = await Promise.all(
    (['queued', 'running'] as const).map((s) =>
      col.where('provider', '==', 'tripo').where('status', '==', s).limit(200).get()
    )
  );
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const doc of snaps.flatMap((s) => s.docs)) {
    if (localJobs.has(doc.id)) continue;
    const d = doc.data();
    const lastBeat = toMillis(d.heartbeatAt) || toMillis(d.updatedAt) || toMillis(d.createdAt);
    if (lastBeat > cutoff) continue;

    // Claim: re-check staleness inside a transaction and bump the heartbeat.
    const claimed = await db
      .runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const f = fresh.data();
        if (!f || (f.status !== 'queued' && f.status !== 'running')) return null;
        const beat = toMillis(f.heartbeatAt) || toMillis(f.updatedAt) || toMillis(f.createdAt);
        if (beat > cutoff) return null;
        tx.update(doc.ref, { heartbeatAt: new Date(), resumeCount: (f.resumeCount ?? 0) + 1 });
        return f;
      })
      .catch(() => null);
    if (!claimed) continue;

    const fail = async (reason: string) => {
      await doc.ref
        .update({ status: 'failed', failureReason: reason, completedAt: new Date() })
        .catch(() => undefined);
      out.failed++;
    };
    if (!claimed.pipelineArgs) {
      await fail('Interrupted by a server restart — run it again.');
      continue;
    }
    if ((claimed.resumeCount ?? 0) >= MAX_RESUMES) {
      await fail('Interrupted repeatedly — retry it.');
      continue;
    }
    const apiKey = await resolveKey(claimed.userId).catch(() => null);
    if (!apiKey) {
      await fail('Interrupted, and your Tripo key is no longer available — re-add it and retry.');
      continue;
    }
    console.log(`[tripo-world] resuming orphaned job ${doc.id} (${claimed.kind})`);
    void runTripoJob(doc.id, claimed.kind, claimed.userId, apiKey, claimed.pipelineArgs);
    out.resumed++;
  }
  return out;
}

async function defaultResolveKey(userId: string) {
  const { resolveProviderKey } = await import('../../lib/byok');
  return resolveProviderKey(userId, 'tripo');
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
/** Boot hook: sweep shortly after start (lets a draining old replica finish), then periodically. */
export function startTripoResumeJob(): void {
  if (sweepTimer || process.env.TRIPO_RESUME_OFF === '1' || !db) return;
  const sweep = () =>
    resumeStaleTripoJobs()
      .then((r) => {
        if (r.resumed || r.failed) console.log('[tripo-world] resume sweep:', r);
      })
      .catch((err) => console.warn('[tripo-world] resume sweep failed:', err));
  setTimeout(sweep, 45_000).unref?.();
  sweepTimer = setInterval(sweep, STALE_AFTER_MS);
  sweepTimer.unref?.();
}

/** Extension of a URL's path (`glb`, `spz`, `ply`…), or the fallback. */
export function urlExt(url: string, fallback: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : fallback;
  } catch {
    return fallback;
  }
}
