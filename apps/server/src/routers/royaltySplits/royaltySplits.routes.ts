/**
 * Royalty Splits Router — exposes the split resolver to clients.
 *
 * Endpoints:
 *   resolve         Resolve the final split for an asset (reads Firestore lineage).
 *   preview         Pure math preview — no DB reads, takes a hypothetical chain.
 *   getPolicy       Read the policy attached to a universe (or platform default).
 *   setPolicy       Universe owner (creator, Safe signer, confirmed on-chain owner)
 *                   or platform admin sets the per-universe policy.
 *
 * The resolver is deliberately read-only — it never mints anything on-chain.
 * The on-chain settlement path lives in `contentLicensing` + `likenessMarketplace`
 * routers; this router's job is to tell them *what split to use* before they fire.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure, isAdminAddress } from '../../lib/trpc';
import { isUniverseAdminStrict } from '../../lib/safe-admin';
import {
  resolveSplitsForAsset,
  previewSplit,
  getUniversePolicy,
  setUniversePolicy,
  DEFAULT_POLICY,
  type RoyaltyPolicyConfig,
} from '../../services/royalty-splits';

const policyIdSchema = z.enum(['current_only', 'decay_7030', 'split_50_30_20', 'equal_share']);
const rightsClassSchema = z.enum(['fan', 'original', 'licensed']);

const policyConfigSchema = z.object({
  byRightsClass: z.object({
    fan: policyIdSchema,
    original: policyIdSchema,
    licensed: policyIdSchema,
  }),
  maxDepth: z.number().int().min(1).max(32),
  minShareBps: z.number().int().min(0).max(2000),
});

export const royaltySplitsRouter = router({
  /**
   * Resolve the split for a real asset id. Walks lineage.
   * Public — splits derive from lineage events that are themselves public.
   */
  resolve: publicProcedure
    .input(
      z.object({
        assetId: z.string().min(1),
        fallback: z
          .object({
            creatorUid: z.string().optional(),
            creatorAddress: z.string().nullable().optional(),
            rightsClass: rightsClassSchema.optional(),
          })
          .optional(),
      })
    )
    .query(async ({ input }) => {
      return resolveSplitsForAsset(input.assetId, input.fallback);
    }),

  /**
   * Pure preview — given a hypothetical chain length + rights class,
   * return the bps split each ancestor would receive. No DB reads.
   * Useful in publish forms to show "if you mint this, the parent
   * creator gets 21%" before any on-chain action.
   */
  preview: publicProcedure
    .input(
      z.object({
        chainLength: z.number().int().min(1).max(32),
        rightsClass: rightsClassSchema,
        universeId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const config = input.universeId ? await getUniversePolicy(input.universeId) : DEFAULT_POLICY;
      const { policyId, shares } = previewSplit(input.chainLength, input.rightsClass, config);
      return {
        policyId,
        shares,
        config,
      };
    }),

  /**
   * Read the policy for a universe (or the platform default).
   */
  getPolicy: publicProcedure
    .input(z.object({ universeId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const universeId = input?.universeId;
      const config: RoyaltyPolicyConfig = universeId
        ? await getUniversePolicy(universeId)
        : DEFAULT_POLICY;
      return { universeId: universeId ?? null, config };
    }),

  /**
   * Set per-universe policy. Allowed for the universe's owner — creator, Safe
   * signer, or (when the universe has a contract) the confirmed on-chain
   * `owner()` — and for platform admins.
   *
   * This decides who gets paid on derivative works, so it uses the STRICT
   * ownership check (fails closed if the chain can't confirm the owner) and
   * needs a real session: an API key must not be able to rewrite splits.
   * Universes with no Firestore doc are refused for non-admins — never
   * "no owner on file, so anyone may".
   *
   * NOTE: the resolver reads the policy at resolve time, so a change also
   * applies to splits computed for assets that already exist.
   */
  setPolicy: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        config: policyConfigSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.apiKeyId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Changing royalty policy requires a session token, not an API key',
        });
      }
      const address = ctx.user.address;
      if (!address) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'A wallet address is required' });
      }
      const allowed =
        isAdminAddress(address) || (await isUniverseAdminStrict(input.universeId, address));
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe owner can change its royalty policy',
        });
      }
      await setUniversePolicy(input.universeId, input.config, {
        uid: ctx.user.uid,
        address,
      });
      return { ok: true as const };
    }),

  /**
   * Authenticated convenience: returns the split for an asset alongside
   * a flag indicating whether the current viewer is a recipient.
   */
  myShare: protectedProcedure
    .input(z.object({ assetId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const split = await resolveSplitsForAsset(input.assetId);
      const mine = split.recipients.find(
        (r) =>
          r.creatorUid === ctx.user.uid ||
          (r.creatorAddress &&
            ctx.user.address &&
            r.creatorAddress.toLowerCase() === ctx.user.address.toLowerCase())
      );
      return {
        split,
        viewerIsRecipient: !!mine,
        viewerBps: mine?.bps ?? 0,
      };
    }),
});
