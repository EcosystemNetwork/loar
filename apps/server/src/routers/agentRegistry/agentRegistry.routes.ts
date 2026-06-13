/**
 * Agent Registry tRPC router — on-chain agent discovery & reputation.
 *
 * Google Cloud "On-Chain Agent Economy" track: BigQuery over the EF ERC-8004
 * registries (Identity / Reputation / Validation) on Ethereum mainnet.
 *
 *   status      — is BigQuery configured + which registries
 *   rank        — agents ranked by on-chain feedback (BigQuery)
 *   reputation  — reputation summary for one agent id (BigQuery)
 *   x402Agents  — LOAR agents that are x402-payable (have an MCP endpoint),
 *                 i.e. flag agents that support x402 payments
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../../lib/trpc';
import {
  rankAgents,
  getAgentReputation,
  isBigQueryConfigured,
  ERC8004,
} from '../../lib/bigquery-erc8004';
import { db, firebaseAvailable } from '../../lib/firebase';

function assertBq() {
  if (!isBigQueryConfigured()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'BigQuery is not configured (set GCP_PROJECT_ID + a service account).',
    });
  }
}

export const agentRegistryRouter = router({
  status: publicProcedure.query(() => ({
    configured: isBigQueryConfigured(),
    registries: ERC8004,
    dataset: 'bigquery-public-data.crypto_ethereum',
  })),

  /** Agents ranked by ERC-8004 reputation feedback volume. */
  rank: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(25) }).optional())
    .query(async ({ input }) => {
      assertBq();
      try {
        return await rankAgents(input?.limit ?? 25);
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'BigQuery rank failed',
        });
      }
    }),

  /** Reputation summary for a single agent id (ERC-8004 identifier). */
  reputation: publicProcedure
    .input(z.object({ agentId: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/) }))
    .query(async ({ input }) => {
      assertBq();
      return getAgentReputation(input.agentId);
    }),

  /**
   * Discover LOAR agents that support x402 payments — those advertising an MCP
   * endpoint via their ENS agent subname (ENSIP-26 agent-endpoint[mcp]). These
   * are the agents a payer can reach and settle with on Arc.
   */
  x402Agents: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('ensAgentSubnames')
        .limit(input?.limit ?? 50)
        .get();
      return snap.docs
        .map((d) => d.data() as Record<string, any>)
        .filter((s) => s.texts?.['agent-endpoint[mcp]'])
        .map((s) => ({
          name: s.name,
          address: s.address,
          aiAgentId: s.aiAgentId,
          mcpEndpoint: s.texts['agent-endpoint[mcp]'],
          supportsX402: true,
        }));
    }),
});
