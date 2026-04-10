/**
 * Universe Generation Config Router
 *
 * Lets universe creators define AI generation parameters:
 * approved models, style constraints, lore rules, credit pricing, access control.
 * Generators see these constraints; the generation flow enforces them.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { universeGenConfigSchema } from './universeGenConfig.types';
import { getVisibleModels } from '../../services/video-models';

const genConfigsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('universeGenConfigs');
};

export const universeGenConfigRouter = router({
  /** Get generation config for a universe (public — generators need to see constraints) */
  get: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const doc = await genConfigsCol().doc(input.universeId.toLowerCase()).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  /** Create or update generation config (universe admin only) */
  upsert: protectedProcedure.input(universeGenConfigSchema).mutation(async ({ input, ctx }) => {
    const isAdmin = await isUniverseAdmin(input.universeAddress, ctx.user.uid);
    if (!isAdmin) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the universe admin can configure generation settings',
      });
    }

    const docId = input.universeAddress.toLowerCase();
    const ref = genConfigsCol().doc(docId);
    const existing = await ref.get();

    const config = {
      ...input,
      universeAddress: docId,
      creatorUid: ctx.user.uid,
      updatedAt: new Date(),
    };

    if (existing.exists) {
      await ref.update(config);
    } else {
      await ref.set({ ...config, createdAt: new Date() });
    }

    // Sync the split BPS to splitConfigs collection
    if (db) {
      const splitRef = db.collection('splitConfigs').doc(docId);
      const splitDoc = await splitRef.get();
      const splitData = {
        universeId: docId,
        universeCreatorAddress: ctx.user.address || null,
        universeCreatorBps: input.universeCreatorSplitBps,
        platformBps: 1000,
        generatorBps: 10000 - input.universeCreatorSplitBps - 1000,
        creatorUid: ctx.user.uid,
        updatedAt: new Date(),
      };
      if (splitDoc.exists) {
        await splitRef.update(splitData);
      } else {
        await splitRef.set({ ...splitData, createdAt: new Date() });
      }
    }

    return { ok: true, id: docId };
  }),

  /** Check if caller has access to generate in this universe */
  checkAccess: protectedProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await genConfigsCol().doc(input.universeId.toLowerCase()).get();

      // No config = public access
      if (!doc.exists) return { hasAccess: true, reason: 'No config — public access' };

      const config = doc.data()!;

      if (config.accessType === 'PUBLIC') {
        return { hasAccess: true, reason: 'Public access' };
      }

      if (config.accessType === 'WHITELISTED') {
        const address = ctx.user.address?.toLowerCase();
        const whitelisted = (config.whitelistedAddresses || []).map((a: string) => a.toLowerCase());
        if (address && whitelisted.includes(address)) {
          return { hasAccess: true, reason: 'Whitelisted' };
        }
        // Also allow universe admin
        const isAdmin = await isUniverseAdmin(input.universeId, ctx.user.uid);
        if (isAdmin) return { hasAccess: true, reason: 'Universe admin' };
        return { hasAccess: false, reason: 'Not whitelisted for this universe' };
      }

      if (config.accessType === 'HOLDERS') {
        // Token balance check is done client-side (on-chain read).
        // Server returns the requirement so the client can validate.
        return {
          hasAccess: null, // client must verify on-chain
          reason: 'Token holder check required',
          requiredTokenBalance: config.requiredTokenBalance || 1,
          universeAddress: config.universeAddress,
        };
      }

      return { hasAccess: true, reason: 'Unknown access type — defaulting to public' };
    }),

  /** Get approved models for this universe (filtered from available models) */
  getApprovedModels: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await genConfigsCol().doc(input.universeId.toLowerCase()).get();
      const allModels = getVisibleModels();

      if (!doc.exists) {
        return { models: allModels, isFiltered: false };
      }

      const config = doc.data()!;
      const approved: string[] = config.approvedModelIds || [];
      const blocked: string[] = config.blockedModelIds || [];

      let filtered = allModels;

      // If approved list is set, only show those
      if (approved.length > 0) {
        filtered = filtered.filter((m: any) => approved.includes(m.id));
      }

      // Remove blocked models
      if (blocked.length > 0) {
        filtered = filtered.filter((m: any) => !blocked.includes(m.id));
      }

      return { models: filtered, isFiltered: approved.length > 0 || blocked.length > 0 };
    }),
});
