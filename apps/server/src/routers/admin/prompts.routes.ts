/**
 * admin.prompts — the platform prompt corpus.
 *
 * Read-only admin surface over the `promptLog` collection written by
 * `capturePrompt()` (services/prompt-log), which is wired into
 * `sanitizePrompt()` and therefore captures every user-submitted generation
 * prompt across every generation route.
 *
 * Powers /admin/prompts: browse, filter, full-text (substring) search,
 * headline stats, and an NDJSON export of the corpus for downstream use
 * (e.g. model training, per the Terms of Service §5 model-training license).
 *
 * Auth: adminProcedure (VITE_ADMIN_ADDRESSES allowlist, enforced server-side).
 */
import { z } from 'zod';
import { router, adminProcedure } from '../../lib/trpc';
import {
  listPrompts,
  getPromptById,
  getPromptStats,
  exportPrompts,
} from '../../services/prompt-log';

const kindEnum = z.enum(['video', 'image', 'audio', 'threed', 'text', 'edit', 'other']);

export const adminPromptsRouter = router({
  // ── Browse / filter / search ──────────────────────────────────────
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
        userId: z.string().optional(),
        kind: kindEnum.optional(),
        universeAddress: z.string().optional(),
        routeKey: z.string().max(40).optional(),
        search: z.string().max(200).optional(),
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
      })
    )
    .query(({ input }) => listPrompts(input)),

  // ── Single row (full, untruncated-in-store prompt) ─────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getPromptById(input.id)),

  // ── Headline stats + trend ────────────────────────────────────────
  stats: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }).default({ days: 30 }))
    .query(({ input }) => getPromptStats(input.days)),

  // ── NDJSON corpus export ──────────────────────────────────────────
  export: adminProcedure
    .input(
      z.object({
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
        kind: kindEnum.optional(),
        limit: z.number().int().min(1).max(50_000).default(10_000),
      })
    )
    .mutation(({ input }) => exportPrompts(input)),
});
