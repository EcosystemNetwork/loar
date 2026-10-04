/**
 * Tripo world-building job runner.
 *
 * Every world-building feature (entity → 3D, character puppet, parts
 * library, restyle, export, place → splat) is a short chain of Tripo tasks.
 * This module gives them one lifecycle:
 *
 *   createJob()   — writes a `threeDGenerations` doc (provider: 'tripo',
 *                   type: `tripo_<kind>`) the client polls via `tripo.getJob`
 *   runJob()      — fire-and-forget: runs the pipeline body with a `ctx`
 *                   whose `step()` submits a Tripo task, polls it, and
 *                   records per-step progress on the doc; marks the doc
 *                   `completed` / `failed`; settles the 3D spend hold.
 *
 * BYOK only (see provider-keys/dispatcher.ts) — the caller resolves the
 * user's Tripo key before anything is written. Generation credits are
 * retired, so there is no refund path; a failure only flips the doc.
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

export type TripoJobKind =
  | 'entity_model'
  | 'character_puppet'
  | 'segment'
  | 'extract_part'
  | 'restyle'
  | 'stylize'
  | 'convert'
  | 'place_splat';

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
}

export const threeDGenCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('threeDGenerations');
};

export interface TripoJobContext {
  genId: string;
  userId: string;
  apiKey: string;
  /** Submit a Tripo task, poll it to success, record it as a named step. */
  step(name: string, submit: () => Promise<{ taskId: string }>): Promise<TripoTask>;
  /** Rehost a signed Tripo URL to permanent storage (pass-through for others). */
  keep(url: string | undefined | null, filename: string): Promise<string | null>;
  /** Merge fields onto the job doc (partial results the UI can show early). */
  patch(fields: Record<string, unknown>): Promise<void>;
}

export interface CreateTripoJobInput {
  kind: TripoJobKind;
  userId: string;
  apiKey: string;
  universeId?: string | null;
  entityId?: string | null;
  sourceContentId?: string | null;
  /** Extra fields recorded on the doc at creation (inputs, labels…). */
  meta?: Record<string, unknown>;
  /** The pipeline. Its return value is merged onto the doc as `result`. */
  run: (ctx: TripoJobContext) => Promise<Record<string, unknown>>;
}

const STEP_TIMEOUT_MS = 15 * 60 * 1000;

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
        await threeDGenCol()
          .doc(genId)
          .set({
            id: genId,
            userId: input.userId,
            provider: 'tripo',
            type: `tripo_${input.kind}`,
            kind: input.kind,
            status: 'running',
            steps: [],
            entityId: input.entityId ?? null,
            universeId: input.universeId ?? null,
            sourceContentId: input.sourceContentId ?? null,
            providerCostUsd: costUsd,
            createdAt: new Date(),
            ...(input.meta ?? {}),
          });

        settleThreedJob({
          hold,
          done: runTripoJob(genId, input),
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

async function runTripoJob(genId: string, input: CreateTripoJobInput): Promise<void> {
  const ref = threeDGenCol().doc(genId);
  const steps: TripoJobStep[] = [];
  const saveSteps = () => ref.update({ steps, updatedAt: new Date() }).catch(() => undefined);

  const ctx: TripoJobContext = {
    genId,
    userId: input.userId,
    apiKey: input.apiKey,
    async step(name, submit) {
      const entry: TripoJobStep = { name, status: 'running', progress: 0 };
      steps.push(entry);
      await saveSteps();
      try {
        const { taskId } = await submit();
        entry.taskId = taskId;
        await saveSteps();
        const task = await waitWithProgress(taskId, input.apiKey, async (p) => {
          entry.progress = p;
          await saveSteps();
        });
        entry.status = 'success';
        entry.progress = 100;
        await saveSteps();
        return task;
      } catch (err) {
        entry.status = 'failed';
        await saveSteps();
        throw err;
      }
    },
    async keep(url, filename) {
      if (!url) return null;
      const { url: permanent } = await rehostEphemeralUrl(url, filename, input.userId);
      return permanent;
    },
    async patch(fields) {
      await ref.update({ ...fields, updatedAt: new Date() });
    },
  };

  try {
    const result = await input.run(ctx);
    await ref.update({ status: 'completed', result, completedAt: new Date() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[tripo-world] job ${genId} (${input.kind}) failed:`, err);
    await ref
      .update({ status: 'failed', failureReason: message.slice(0, 500), completedAt: new Date() })
      .catch(() => undefined);
  }
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
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Tripo3D task ${taskId} timed out after ${STEP_TIMEOUT_MS / 1000}s`);
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
