/**
 * admin.cost — admin-only cost visibility, margin monitoring, and controls.
 *
 * Read paths pull from `costAggregates/` + `costLedger/` (populated by
 * `recordProviderCost` on every paid API call). Write paths flow through
 * `setControls()` and invalidate the in-proc cache so enforcement picks up
 * the new value within one cache window (default 30s).
 *
 * Target margin: 30% (configurable via COST_MARGIN_TARGET).
 */

import { z } from 'zod';
import { router, adminProcedure } from '../../lib/trpc';
import {
  computeMargin,
  getOverview,
  getByUser,
  getByApiKey,
  getByUniverse,
  getRecentLedger,
  marginTarget,
  getControls,
  setControls,
  invalidateControlsCache,
  runAlertSweep,
  listRecentAlerts,
  acknowledgeAlert,
  getPlatformTrend,
  getComparison,
  getTopMovers,
  getByModel,
  type CostControls,
} from '../../services/cost-tracker';

const periodString = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'period must be YYYY-MM or YYYY-MM-DD');

function defaultPeriod(window: 'day' | 'month'): string {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  return window === 'day' ? day : day.slice(0, 7);
}

const controlsPatchSchema = z
  .object({
    pausedProviders: z.array(z.string().max(40)).max(20).optional(),
    caps: z
      .object({
        platformDailyUsd: z.number().min(0).nullable().optional(),
        userDailyUsd: z.number().min(0).nullable().optional(),
        apiKeyDailyUsd: z.number().min(0).nullable().optional(),
        universeDailyUsd: z.number().min(0).nullable().optional(),
      })
      .optional(),
    overrides: z
      .object({
        userDailyUsd: z.record(z.string(), z.number().min(0)).optional(),
        apiKeyDailyUsd: z.record(z.string(), z.number().min(0)).optional(),
        universeDailyUsd: z.record(z.string(), z.number().min(0)).optional(),
      })
      .optional(),
    alert: z
      .object({
        enabled: z.boolean().optional(),
        marginThreshold: z.number().min(0).max(1).nullable().optional(),
        cooldownMinutes: z.number().int().min(5).max(1440).optional(),
      })
      .optional(),
  })
  .strict();

export const adminCostRouter = router({
  // ── Margin + overview ─────────────────────────────────────────────

  margin: adminProcedure
    .input(z.object({ window: z.enum(['day', 'month']).default('day') }))
    .query(async ({ input }) => {
      const m = await computeMargin(input.window);
      return { ...m, target: marginTarget() };
    }),

  overview: adminProcedure
    .input(
      z
        .object({
          window: z.enum(['day', 'month']).default('day'),
          period: periodString.optional(),
        })
        .default({ window: 'day' })
    )
    .query(async ({ input }) => {
      const period = input.period ?? defaultPeriod(input.window);
      const [overview, margin] = await Promise.all([
        getOverview(period),
        computeMargin(input.window),
      ]);
      return {
        period,
        window: input.window,
        total: overview.total,
        byProvider: overview.byProvider,
        margin,
        target: marginTarget(),
      };
    }),

  trend: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const series = await getPlatformTrend(input.days);
      return { series, target: marginTarget() };
    }),

  comparison: adminProcedure
    .input(z.object({ window: z.enum(['day', 'week', 'month']).default('week') }))
    .query(async ({ input }) => getComparison(input.window)),

  byModel: adminProcedure
    .input(
      z.object({
        window: z.enum(['day', 'month']).default('day'),
        period: periodString.optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const period = input.period ?? defaultPeriod(input.window);
      return { period, rows: await getByModel(period, input.limit) };
    }),

  // ── Per-scope leaderboards ─────────────────────────────────────────

  byUser: adminProcedure
    .input(
      z.object({
        window: z.enum(['day', 'month']).default('month'),
        period: periodString.optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const period = input.period ?? defaultPeriod(input.window);
      return { period, rows: await getByUser(period, input.limit) };
    }),

  byApiKey: adminProcedure
    .input(
      z.object({
        window: z.enum(['day', 'month']).default('month'),
        period: periodString.optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const period = input.period ?? defaultPeriod(input.window);
      return { period, rows: await getByApiKey(period, input.limit) };
    }),

  byUniverse: adminProcedure
    .input(
      z.object({
        window: z.enum(['day', 'month']).default('month'),
        period: periodString.optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const period = input.period ?? defaultPeriod(input.window);
      return { period, rows: await getByUniverse(period, input.limit) };
    }),

  topMovers: adminProcedure
    .input(
      z.object({
        scope: z.enum(['user', 'apiKey', 'universe']).default('user'),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => getTopMovers(input)),

  // ── Ledger ─────────────────────────────────────────────────────────

  ledger: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(500).default(100),
        userId: z.string().optional(),
        apiKeyId: z.string().optional(),
        universeAddress: z.string().optional(),
        provider: z.string().optional(),
      })
    )
    .query(async ({ input }) => getRecentLedger(input)),

  // ── Controls (kill-switches + per-scope caps) ──────────────────────

  controls: router({
    get: adminProcedure.query(async () => getControls()),

    update: adminProcedure.input(controlsPatchSchema).mutation(async ({ ctx, input }) => {
      const next = await setControls(input as Partial<CostControls>, ctx.user.uid.toLowerCase());
      return next;
    }),

    invalidate: adminProcedure.mutation(async () => {
      invalidateControlsCache();
      return { ok: true };
    }),

    pauseProvider: adminProcedure
      .input(z.object({ provider: z.string().min(1).max(40) }))
      .mutation(async ({ ctx, input }) => {
        const current = await getControls();
        if (current.pausedProviders.includes(input.provider)) return current;
        return setControls(
          { pausedProviders: [...current.pausedProviders, input.provider] },
          ctx.user.uid.toLowerCase()
        );
      }),

    resumeProvider: adminProcedure
      .input(z.object({ provider: z.string().min(1).max(40) }))
      .mutation(async ({ ctx, input }) => {
        const current = await getControls();
        return setControls(
          {
            pausedProviders: current.pausedProviders.filter((p) => p !== input.provider),
          },
          ctx.user.uid.toLowerCase()
        );
      }),
  }),

  // ── Alerts ─────────────────────────────────────────────────────────

  alerts: router({
    list: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ input }) => listRecentAlerts(input.limit)),

    acknowledge: adminProcedure
      .input(z.object({ alertId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await acknowledgeAlert(input.alertId, ctx.user.uid.toLowerCase());
        return { ok: true };
      }),

    runNow: adminProcedure.mutation(async () => {
      const fired = await runAlertSweep();
      return { fired };
    }),
  }),
});
