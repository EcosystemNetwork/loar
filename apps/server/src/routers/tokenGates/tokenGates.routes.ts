/**
 * Token Gates Router
 *
 * Universe creators can define multiple token-gate rules per universe.
 * Each rule targets a specific access variable (view content, create nodes,
 * submit canon, access wiki, governance voting, etc.) with its own minimum
 * ownership threshold.
 *
 * Firestore: `tokenGates` collection, doc ID = `{universeId}_{gateTarget}`
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';

const tokenGatesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('tokenGates');
};

const universesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cinematicUniverses');
};

/** All possible gate targets — each can have its own threshold */
const gateTargets = [
  'view', // view timeline / content
  'create', // create nodes
  'canon', // submit to canon marketplace
  'wiki', // access wiki / lore
  'governance', // participate in governance
  'play', // branching player
] as const;

const gateTargetEnum = z.enum(gateTargets);

export type GateTarget = z.infer<typeof gateTargetEnum>;

const upsertGateSchema = z.object({
  universeId: z.string().min(1, 'Universe ID required'),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  target: gateTargetEnum,
  /** Minimum percentage of total supply required (e.g. 1 = 1%, 0.5 = 0.5%) */
  minPercentage: z.number().min(0).max(100),
  enabled: z.boolean().default(true),
  label: z.string().max(100).optional(),
});

const listGatesSchema = z.object({
  universeId: z.string().min(1),
});

const removeGateSchema = z.object({
  universeId: z.string().min(1),
  target: gateTargetEnum,
});

/** Helper: verify caller is the universe creator */
async function verifyCreator(universeId: string, callerAddress: string | undefined) {
  const universeDoc = await universesCol().doc(universeId.toLowerCase()).get();
  if (!universeDoc.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
  }
  const universeData = universeDoc.data();
  if (universeData?.creator?.toLowerCase() !== callerAddress?.toLowerCase()) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the universe creator can manage token gates',
    });
  }
}

export const tokenGatesRouter = router({
  /**
   * Create or update a single gate rule for a universe + target combo.
   * Only the universe creator can manage gates.
   */
  upsert: protectedProcedure.input(upsertGateSchema).mutation(async ({ ctx, input }) => {
    await verifyCreator(input.universeId, ctx.user.address);

    const docId = `${input.universeId.toLowerCase()}_${input.target}`;
    const now = new Date();

    const gateData = {
      universeId: input.universeId.toLowerCase(),
      tokenAddress: input.tokenAddress,
      target: input.target,
      minPercentage: input.minPercentage,
      enabled: input.enabled,
      label: input.label ?? null,
      updatedBy: ctx.user.address?.toLowerCase() ?? ctx.user.uid,
      updatedAt: now,
    };

    const existing = await tokenGatesCol().doc(docId).get();
    if (existing.exists) {
      await tokenGatesCol().doc(docId).update(gateData);
    } else {
      await tokenGatesCol()
        .doc(docId)
        .set({
          ...gateData,
          createdAt: now,
          createdBy: ctx.user.address?.toLowerCase() ?? ctx.user.uid,
        });
    }

    return { ok: true, gate: { id: docId, ...gateData } };
  }),

  /**
   * List all gate rules for a universe (public — needed for client-side enforcement).
   */
  list: publicProcedure.input(listGatesSchema).query(async ({ input }) => {
    const snapshot = await tokenGatesCol()
      .where('universeId', '==', input.universeId.toLowerCase())
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }),

  /**
   * Remove a specific gate rule for a universe + target.
   */
  remove: protectedProcedure.input(removeGateSchema).mutation(async ({ ctx, input }) => {
    await verifyCreator(input.universeId, ctx.user.address);

    const docId = `${input.universeId.toLowerCase()}_${input.target}`;
    const doc = await tokenGatesCol().doc(docId).get();
    if (!doc.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Gate rule not found' });
    }

    await tokenGatesCol().doc(docId).delete();
    return { ok: true };
  }),

  /**
   * Bulk upsert — set multiple gate rules at once.
   */
  bulkUpsert: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        rules: z.array(
          z.object({
            target: gateTargetEnum,
            minPercentage: z.number().min(0).max(100),
            enabled: z.boolean().default(true),
            label: z.string().max(100).optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await verifyCreator(input.universeId, ctx.user.address);

      const now = new Date();
      const batch = db.batch();

      for (const rule of input.rules) {
        const docId = `${input.universeId.toLowerCase()}_${rule.target}`;
        const ref = tokenGatesCol().doc(docId);

        batch.set(
          ref,
          {
            universeId: input.universeId.toLowerCase(),
            tokenAddress: input.tokenAddress,
            target: rule.target,
            minPercentage: rule.minPercentage,
            enabled: rule.enabled,
            label: rule.label ?? null,
            updatedBy: ctx.user.address?.toLowerCase() ?? ctx.user.uid,
            updatedAt: now,
            createdAt: now,
            createdBy: ctx.user.address?.toLowerCase() ?? ctx.user.uid,
          },
          { merge: true }
        );
      }

      await batch.commit();
      return { ok: true, count: input.rules.length };
    }),
});
