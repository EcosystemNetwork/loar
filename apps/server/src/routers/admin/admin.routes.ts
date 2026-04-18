/**
 * Admin Router — read and write platform-wide configuration
 *
 * All fee rates, margins, and platform parameters live in Firestore
 * (`platformConfig/fees`) and are editable here without redeployment.
 *
 * Auth: ADMIN_WALLET env var defines the authorised admin wallet address.
 * Any authenticated user whose address matches ADMIN_WALLET can call these.
 */
import { adminProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import {
  getPlatformConfig,
  invalidatePlatformConfigCache,
  DEFAULT_PLATFORM_CONFIG,
} from '../../services/platformConfig';

const configCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('platformConfig');
};
const configAuditCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('platformConfigAudit');
};

// ── Config update schema — every field optional so admins can patch ───────

const configPatchSchema = z.object({
  fiatMargin: z.number().min(1).max(3).optional(),
  loarMargin: z.number().min(1).max(3).optional(),
  loarCreditBonusFraction: z.number().min(0).max(1).optional(),
  baseCreditCostUsd: z.number().min(0.001).max(1).optional(),

  universeMintFeeEth: z.number().min(0).optional(),
  mintFeeLpFraction: z.number().min(0).max(1).optional(),
  universeMintCredits: z.number().min(0).optional(),

  marketplacePlatformFeeBps: z.number().int().min(0).max(5000).optional(), // max 50%

  collabPlatformFeeBps: z.number().int().min(0).max(5000).optional(),
  subscriptionPlatformFeeBps: z.number().int().min(0).max(5000).optional(),
  nftPlatformFeeBps: z.number().int().min(0).max(5000).optional(),

  affiliateReferrerLoar: z.number().min(0).optional(),
  affiliateNewUserLoar: z.number().min(0).optional(),
});

// ── Router ────────────────────────────────────────────────────────────────

export const adminRouter = router({
  // ── Read current config ───────────────────────────────────────────

  getConfig: adminProcedure.query(async () => {
    return getPlatformConfig();
  }),

  getConfigDefaults: adminProcedure.query(async () => {
    return DEFAULT_PLATFORM_CONFIG;
  }),

  // ── Patch individual fields ───────────────────────────────────────

  updateConfig: adminProcedure.input(configPatchSchema).mutation(async ({ input, ctx }) => {
    if (Object.keys(input).length === 0) throw new Error('No fields to update');

    const current = await getPlatformConfig();
    const updated = { ...current, ...input, updatedAt: new Date(), updatedBy: ctx.user.uid };

    await configCol().doc('fees').set(updated, { merge: true });

    // Audit trail
    await configAuditCol().add({
      changes: input,
      previousValues: Object.fromEntries(Object.keys(input).map((k) => [k, (current as any)[k]])),
      changedBy: ctx.user.uid,
      changedAt: new Date(),
    });

    invalidatePlatformConfigCache();

    return { ok: true, config: updated };
  }),

  // ── Reset to defaults ─────────────────────────────────────────────

  resetConfig: adminProcedure.mutation(async ({ ctx }) => {
    const current = await getPlatformConfig();
    const reset = { ...DEFAULT_PLATFORM_CONFIG, updatedAt: new Date(), updatedBy: ctx.user.uid };

    await configCol().doc('fees').set(reset);

    await configAuditCol().add({
      changes: DEFAULT_PLATFORM_CONFIG,
      previousValues: current,
      action: 'reset_to_defaults',
      changedBy: ctx.user.uid,
      changedAt: new Date(),
    });

    invalidatePlatformConfigCache();

    return { ok: true, config: reset };
  }),

  // ── Audit history ─────────────────────────────────────────────────

  getConfigAudit: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = configAuditCol().orderBy('changedAt', 'desc');

      // Cursor-based pagination: start after the given document
      if (input.cursor) {
        const cursorDoc = await configAuditCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.limit(input.limit).get();
      const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const nextCursor =
        snapshot.docs.length === input.limit
          ? snapshot.docs[snapshot.docs.length - 1].id
          : undefined;

      return { items, nextCursor };
    }),
});
