/**
 * Admin Router — read and write platform-wide configuration
 *
 * All fee rates, margins, and platform parameters live in Firestore
 * (`platformConfig/fees`) and are editable here without redeployment.
 *
 * Auth: ADMIN_WALLET env var defines the authorised admin wallet address.
 * Any authenticated user whose address matches ADMIN_WALLET can call these.
 */
import { protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import {
  getPlatformConfig,
  invalidatePlatformConfigCache,
  DEFAULT_PLATFORM_CONFIG,
} from '../../services/platformConfig';

const configCol = db.collection('platformConfig');
const configAuditCol = db.collection('platformConfigAudit');

// ── Admin guard ───────────────────────────────────────────────────────────

function requireAdmin(callerUid: string) {
  const adminWallet = (process.env.ADMIN_WALLET ?? '').toLowerCase();
  if (!adminWallet) throw new Error('ADMIN_WALLET env var is not set');
  if (callerUid.toLowerCase() !== adminWallet) {
    throw new Error('Forbidden: admin access only');
  }
}

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

  getConfig: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.uid);
    return getPlatformConfig();
  }),

  getConfigDefaults: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.uid);
    return DEFAULT_PLATFORM_CONFIG;
  }),

  // ── Patch individual fields ───────────────────────────────────────

  updateConfig: protectedProcedure.input(configPatchSchema).mutation(async ({ input, ctx }) => {
    requireAdmin(ctx.user.uid);

    if (Object.keys(input).length === 0) throw new Error('No fields to update');

    const current = await getPlatformConfig();
    const updated = { ...current, ...input, updatedAt: new Date(), updatedBy: ctx.user.uid };

    await configCol.doc('fees').set(updated, { merge: true });

    // Audit trail
    await configAuditCol.add({
      changes: input,
      previousValues: Object.fromEntries(Object.keys(input).map((k) => [k, (current as any)[k]])),
      changedBy: ctx.user.uid,
      changedAt: new Date(),
    });

    invalidatePlatformConfigCache();

    return { ok: true, config: updated };
  }),

  // ── Reset to defaults ─────────────────────────────────────────────

  resetConfig: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.uid);

    const current = await getPlatformConfig();
    const reset = { ...DEFAULT_PLATFORM_CONFIG, updatedAt: new Date(), updatedBy: ctx.user.uid };

    await configCol.doc('fees').set(reset);

    await configAuditCol.add({
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

  getConfigAudit: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input, ctx }) => {
      requireAdmin(ctx.user.uid);

      const snapshot = await configAuditCol.orderBy('changedAt', 'desc').limit(input.limit).get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
