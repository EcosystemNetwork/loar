/**
 * API Keys Router — Manage programmatic access keys for AI agents and integrations
 */
import { protectedProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  generateApiKey,
  revokeApiKey,
  listApiKeys,
  getApiKeyUsage,
  API_KEY_SCOPES,
} from '../../lib/apiKeys';

// Scopes that should never be offered to external keys via the UI.
// `admin.all` is internal-only; everything else in API_KEY_SCOPES is
// fair game (including `mcp_server`, used by MCP relays like Hermes).
const HIDDEN_SCOPES = new Set<string>(['admin.all']);

export const apiKeysRouter = router({
  /**
   * Generate a new API key. The raw key is returned only once.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        aiAgentId: z.string().optional(),
        permissions: z.array(z.string()).min(1),
        rateLimitPerMinute: z.number().min(1).max(1000).default(60),
        expiresInDays: z.number().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // If linking to an AI agent, verify ownership
      if (input.aiAgentId) {
        const { db } = await import('../../lib/firebase');
        if (db) {
          const agentDoc = await db.collection('aiAgents').doc(input.aiAgentId).get();
          if (!agentDoc.exists) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
          }
          if (agentDoc.data()?.createdByUid !== ctx.user.uid) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
          }
        }
      }

      const result = await generateApiKey({
        name: input.name,
        ownerUid: ctx.user.uid,
        aiAgentId: input.aiAgentId,
        permissions: input.permissions,
        rateLimitPerMinute: input.rateLimitPerMinute,
        expiresInDays: input.expiresInDays,
      });

      return {
        rawKey: result.rawKey, // Only returned on creation
        keyId: result.keyDoc.id,
        keyPrefix: result.keyDoc.keyPrefix,
        name: result.keyDoc.name,
        permissions: result.keyDoc.permissions,
        rateLimitPerMinute: result.keyDoc.rateLimitPerMinute,
        expiresAt: result.keyDoc.expiresAt,
      };
    }),

  /**
   * List all API keys for the current user (hashed keys are never returned)
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return listApiKeys(ctx.user.uid);
  }),

  /**
   * Revoke an API key
   */
  revoke: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await revokeApiKey(input.keyId, ctx.user.uid);
      return { ok: true };
    }),

  /**
   * Get usage history for a specific key
   */
  getUsage: protectedProcedure
    .input(
      z.object({
        keyId: z.string(),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify ownership
      const keys = await listApiKeys(ctx.user.uid);
      if (!keys.some((k) => k.id === input.keyId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the key owner' });
      }

      return getApiKeyUsage(input.keyId, input.limit);
    }),

  /**
   * Get available permissions for API key creation
   */
  availablePermissions: protectedProcedure.query(() => {
    return (Object.keys(API_KEY_SCOPES) as (keyof typeof API_KEY_SCOPES)[])
      .filter((p) => !HIDDEN_SCOPES.has(p))
      .map((p) => ({
        value: p,
        label: p.replace(/[._]/g, ' → '),
        description: API_KEY_SCOPES[p],
        category: p.split('.')[0],
      }));
  }),
});
