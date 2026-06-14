/**
 * ENS tRPC router — identity layer for users + AI agents.
 *
 *   reverse / resolve / profile  — read ENS for any address or name
 *   agentCard                    — read an ENS name as an ENSIP-25/26 agent
 *   claimAgentSubname            — give a LOAR agent a gasless ENS subname
 *                                  (served via the CCIP-Read gateway)
 *   myAgentSubnames              — list the caller's claimed agent names
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import {
  lookupAddress,
  lookupAddressProfile,
  resolveName,
  getProfile,
  getAgentCard,
} from '../../lib/ens';
import {
  registerAgentSubname,
  listAgentSubnamesByOwner,
  agentParentName,
  isValidLabel,
  normalizeLabel,
} from '../../lib/ens-agent-registry';

const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x address');
const NAME = z.string().min(3).max(255);

function requireEvmAddress(address: string | undefined): string {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This account has no EVM address.' });
  }
  return address;
}

export const ensRouter = router({
  /** Reverse-resolve an address → primary ENS name (forward-verified). */
  reverse: publicProcedure
    .input(z.object({ address: ADDR }))
    .query(({ input }) => lookupAddress(input.address)),

  /** Reverse-resolve an address → primary ENS name + avatar (for display). */
  reverseProfile: publicProcedure
    .input(z.object({ address: ADDR }))
    .query(({ input }) => lookupAddressProfile(input.address)),

  /** Forward-resolve a name → address. */
  resolve: publicProcedure
    .input(z.object({ name: NAME }))
    .query(({ input }) => resolveName(input.name)),

  /** Full display profile (address, avatar, url, socials). */
  profile: publicProcedure
    .input(z.object({ name: NAME }))
    .query(({ input }) => getProfile(input.name)),

  /** Read an ENS name as an agent (ENSIP-25/26 endpoints + card). */
  agentCard: publicProcedure
    .input(z.object({ name: NAME }))
    .query(({ input }) => getAgentCard(input.name)),

  /** The parent name agent subnames are issued under. */
  agentParent: publicProcedure.query(() => ({ parent: agentParentName() })),

  /**
   * Claim a gasless ENS subname for one of the caller's AI agents. The name
   * resolves (via CCIP-Read) to the caller's wallet and advertises ENSIP-26
   * agent endpoints pointing at LOAR's MCP surface, so the agent becomes
   * discoverable by ENS.
   */
  claimAgentSubname: protectedProcedure
    .input(
      z.object({
        label: z.string().min(1).max(63),
        aiAgentId: z.string().min(1),
        description: z.string().max(500).optional(),
        avatar: z.string().url().optional(),
        /** MCP endpoint the agent is reachable at (ENSIP-26 agent-endpoint[mcp]). */
        mcpEndpoint: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const label = normalizeLabel(input.label);
      if (!isValidLabel(label)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Label must be 1–63 chars of a–z, 0–9, hyphen (not leading/trailing).',
        });
      }
      const address = requireEvmAddress(ctx.user.address);
      const mcp =
        input.mcpEndpoint ??
        `${process.env.PUBLIC_BASE_URL ?? 'https://loar.fun'}/api/mcp/agents/${input.aiAgentId}`;

      const texts: Record<string, string> = {
        'agent-endpoint[mcp]': mcp,
        url: `${process.env.PUBLIC_BASE_URL ?? 'https://loar.fun'}/agents/${input.aiAgentId}`,
      };
      if (input.description) texts.description = input.description;
      if (input.avatar) texts.avatar = input.avatar;

      try {
        const rec = await registerAgentSubname({
          label,
          address,
          aiAgentId: input.aiAgentId,
          ownerUid: ctx.user.uid,
          texts,
        });
        return rec;
      } catch (err) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: err instanceof Error ? err.message : 'Could not claim subname',
        });
      }
    }),

  /** List the caller's claimed agent subnames. */
  myAgentSubnames: protectedProcedure.query(({ ctx }) => listAgentSubnamesByOwner(ctx.user.uid)),
});
