/**
 * Physics tRPC router.
 *
 * `get` is public — physics is part of how a universe advertises itself.
 * `set` requires the caller to be the universe creator.
 * `validate` is public — it's a pure function over stored laws + input text.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { getUniverseLaws, setUniverseLaws, validateAgainstLaws } from './physics.handlers';
import { getUniverse } from '../universes/universes.handlers';

const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

const invariantSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  rule: z.string().min(1).max(1000),
  severity: z.enum(['must', 'should']),
});

const conservationRuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
});

async function assertUniverseCreator(universeAddress: string, caller: string | undefined) {
  if (!caller) throw new Error('Wallet address required');
  const universe = (await getUniverse(universeAddress)).data as
    | { creator?: string; address?: string }
    | undefined;
  if (!universe) throw new Error('Universe not found');
  if ((universe.creator ?? '').toLowerCase() !== caller.toLowerCase()) {
    throw new Error('Forbidden: only the universe creator can edit physics');
  }
}

export const physicsRouter = router({
  /** Read the declared physics of a universe. */
  get: publicProcedure
    .input(z.object({ universeAddress: ethereumAddress }))
    .query(async ({ input }) => {
      const laws = await getUniverseLaws(input.universeAddress);
      return { laws };
    }),

  /** Replace the stored physics. Creator-only. */
  set: protectedProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        invariants: z.array(invariantSchema).max(50).optional(),
        conservationRules: z.array(conservationRuleSchema).max(50).optional(),
        forbiddenEvents: z.array(z.string().min(1).max(200)).max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertUniverseCreator(input.universeAddress, ctx.user.address);
      const laws = await setUniverseLaws(
        input.universeAddress,
        {
          invariants: input.invariants,
          conservationRules: input.conservationRules,
          forbiddenEvents: input.forbiddenEvents,
        },
        ctx.user.address!
      );
      return { success: true, laws };
    }),

  /**
   * Check a content blob against a universe's physics. Returns every matched
   * rule; it's the caller's job to refuse / warn / display based on severity.
   */
  validate: publicProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        content: z.string().min(1).max(20_000),
      })
    )
    .query(async ({ input }) => {
      const result = await validateAgainstLaws(input.universeAddress, input.content);
      return {
        laws: result.laws,
        violations: result.violations,
        hasBlocking: result.violations.some((v) => v.severity === 'must'),
      };
    }),
});

export type PhysicsRouter = typeof physicsRouter;
