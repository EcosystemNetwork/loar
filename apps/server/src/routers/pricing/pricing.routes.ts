/**
 * Pricing Routes — Admin endpoints for viewing and managing AI model pricing.
 *
 * Public:
 *   pricing.list — View all model prices (for transparency / UI display)
 *   pricing.status — Heartbeat status and margin config
 *
 * Admin-only:
 *   pricing.update — Manually override a model's provider cost
 *   pricing.forceCheck — Trigger an immediate price check
 *   pricing.history — View price change audit log
 */
import { z } from 'zod';
import { publicProcedure, adminProcedure, router } from '../../lib/trpc';
import {
  getAllPrices,
  getPricingStatus,
  updateModelPrice,
  forceHeartbeat,
} from '../../services/pricing/heartbeat';

export const pricingRouter = router({
  /** List all model prices with margins. Public for transparency. */
  list: publicProcedure.query(() => {
    return getAllPrices();
  }),

  /** Get pricing system status (last heartbeat, margin config). */
  status: publicProcedure.query(() => {
    return getPricingStatus();
  }),

  /** Manually update a model's provider cost. Admin only. */
  update: adminProcedure
    .input(
      z.object({
        modelId: z.string(),
        providerCostUsd: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const updated = await updateModelPrice(input.modelId, input.providerCostUsd);
      if (!updated) {
        throw new Error(`Model "${input.modelId}" not found`);
      }
      return updated;
    }),

  /** Force an immediate price check. Admin only. */
  forceCheck: adminProcedure.mutation(async () => {
    return forceHeartbeat();
  }),

  /** View recent price change logs. Admin only. */
  history: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      try {
        const { db, firebaseAvailable } = await import('../../lib/firebase');
        if (!firebaseAvailable || !db) return [];

        const snapshot = await db
          .collection('priceChangeLogs')
          .orderBy('detectedAt', 'desc')
          .limit(input.limit)
          .get();

        return snapshot.docs.map((doc) => doc.data());
      } catch {
        return [];
      }
    }),
});
