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
  type PlatformConfig,
} from '../../services/platformConfig';
import { sendSlackAlert } from '../../lib/slack';

// Kill-switch fields that warrant a Slack alert when flipped.
const ALERT_FIELDS = [
  'generationEnabled',
  'mintingEnabled',
  'purchaseEnabled',
  'registrationEnabled',
  'monthlySpendCapEnabled',
] as const;
type AlertField = (typeof ALERT_FIELDS)[number];

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

  // Feature kill switches — flip to false to instantly stop the matching path.
  generationEnabled: z.boolean().optional(),
  mintingEnabled: z.boolean().optional(),
  purchaseEnabled: z.boolean().optional(),
  registrationEnabled: z.boolean().optional(),

  // Per-wallet monthly spend cap (measured in credits across a rolling 30 days).
  monthlySpendCapEnabled: z.boolean().optional(),
  monthlySpendCapCredits: z.number().int().min(0).max(1_000_000).optional(),
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

    // Fire a Slack alert when a kill-switch or the spend-cap toggle flips.
    // Only report fields whose NEW value differs from the old one — a PATCH
    // can include a field without changing it (e.g. resending the same
    // value from the admin UI).
    const flips: Array<{ field: AlertField; from: unknown; to: unknown }> = [];
    for (const field of ALERT_FIELDS) {
      if (field in input) {
        const before = (current as PlatformConfig)[field];
        const after = (input as Record<string, unknown>)[field];
        if (before !== after) flips.push({ field, from: before, to: after });
      }
    }
    if (flips.length > 0) {
      const critical = flips.some((f) => f.to === false && f.field !== 'monthlySpendCapEnabled');
      void sendSlackAlert({
        title: critical
          ? `Kill switch flipped OFF: ${flips.map((f) => f.field).join(', ')}`
          : `Platform config toggles changed: ${flips.map((f) => f.field).join(', ')}`,
        body:
          `Changed by \`${ctx.user.uid}\`.\n` +
          `Effect propagates server-wide within ~60s (platformConfig cache TTL).`,
        fields: flips.map((f) => ({
          label: f.field,
          value: `\`${String(f.from)}\` → \`${String(f.to)}\``,
        })),
        severity: critical ? 'critical' : 'warn',
      });
    }

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

  // ── Abuse flags (anomaly-detector output) ─────────────────────────

  listAbuseFlags: adminProcedure
    .input(
      z.object({
        status: z.enum(['open', 'dismissed', 'confirmed']).optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const col = db.collection('abuseFlags');
      let query = col.orderBy('lastDetectedAt', 'desc');
      if (input.status) query = query.where('status', '==', input.status) as typeof query;
      if (input.cursor) {
        const cursorDoc = await col.doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }
      const snap = await query.limit(input.limit).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const nextCursor =
        snap.docs.length === input.limit ? snap.docs[snap.docs.length - 1].id : undefined;
      return { items, nextCursor };
    }),

  updateAbuseFlag: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        status: z.enum(['dismissed', 'confirmed']),
        note: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = db.collection('abuseFlags').doc(input.id);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Flag not found');
      await ref.update({
        status: input.status,
        resolvedBy: ctx.user.uid,
        resolvedAt: new Date().toISOString(),
        resolutionNote: input.note ?? null,
      });
      return { ok: true };
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
