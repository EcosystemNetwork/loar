/**
 * AI Agents Router — Autonomous AI agents that create content,
 * manage universes, and execute multi-step pipelines
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { createAIAgentSchema, updateAIAgentSchema } from './aiAgents.types';
import { allocateCreditsToAgent, getAgentCreditStats } from '../../services/aiAgentCredits';
import { emitActivity } from '../../services/activity';

const aiAgentsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('aiAgents');
};
const universesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('cinematicUniverses');
};
const universeAgentAssignmentsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('universeAgentAssignments');
};

/** Check if caller is the universe creator (admin) */
async function isUniverseAdmin(universeId: string, callerUid: string): Promise<boolean> {
  const doc = await universesCol().doc(universeId.toLowerCase()).get();
  if (!doc.exists) return false;
  return doc.data()?.creator?.toLowerCase() === callerUid.toLowerCase();
}

export const aiAgentsRouter = router({
  // ── CRUD ─────────────────────────────────────────────────────────────

  create: protectedProcedure.input(createAIAgentSchema).mutation(async ({ input, ctx }) => {
    const uid = ctx.user.uid;

    // If scoped to a universe, verify caller is universe admin
    if (input.universeId) {
      const isAdmin = await isUniverseAdmin(input.universeId, uid);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe creator can add AI agents',
        });
      }
    }

    const agentId = randomUUID();
    const agent = {
      id: agentId,
      name: input.name,
      type: input.type,
      description: input.description || '',
      avatarUrl: input.avatarUrl || null,
      createdByUid: uid,
      universeId: input.universeId || null,
      permissions: input.permissions,
      creditBudgetTotal: 0,
      creditBudgetSpent: 0,
      creditBudgetPeriod: input.creditBudgetPeriod,
      creditSourceUid: uid,
      creditSourceType: 'personal' as const,
      status: 'active' as const,
      lastRunAt: null,
      totalRunCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await aiAgentsCol().doc(agentId).set(agent);

    // If universe-scoped, add to universe agent assignments
    if (input.universeId) {
      const assignRef = universeAgentAssignmentsCol().doc(input.universeId.toLowerCase());
      const assignDoc = await assignRef.get();

      const assignment = {
        aiAgentId: agentId,
        role: input.type,
        assignedAt: new Date(),
      };

      if (assignDoc.exists) {
        const existing = assignDoc.data()?.aiAgents || [];
        await assignRef.update({
          aiAgents: [...existing, assignment],
          updatedAt: new Date(),
        });
      } else {
        await assignRef.set({
          universeId: input.universeId.toLowerCase(),
          talentAgentUid: null,
          talentAgentContractId: null,
          aiAgents: [assignment],
          updatedAt: new Date(),
        });
      }
    }

    emitActivity({
      actorUid: uid,
      eventType: 'ai_agent_created' as any,
      targetType: 'aiAgent',
      targetId: agentId,
      metadata: { agentName: input.name, agentType: input.type },
    }).catch(() => {});

    return agent;
  }),

  update: protectedProcedure.input(updateAIAgentSchema).mutation(async ({ input, ctx }) => {
    const ref = aiAgentsCol().doc(input.agentId);
    const doc = await ref.get();
    if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });

    const data = doc.data()!;
    if (data.createdByUid !== ctx.user.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
    }

    const { agentId, ...updates } = input;
    await ref.update({ ...updates, updatedAt: new Date() });
    return { ok: true };
  }),

  pause: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = aiAgentsCol().doc(input.agentId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
      if (doc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
      }

      await ref.update({ status: 'paused', updatedAt: new Date() });
      return { ok: true };
    }),

  resume: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = aiAgentsCol().doc(input.agentId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
      if (doc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
      }

      await ref.update({ status: 'active', updatedAt: new Date() });
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = aiAgentsCol().doc(input.agentId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });

      const data = doc.data()!;
      if (data.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
      }

      // Remove from universe assignments if applicable
      if (data.universeId) {
        const assignRef = universeAgentAssignmentsCol().doc(data.universeId.toLowerCase());
        const assignDoc = await assignRef.get();
        if (assignDoc.exists) {
          const agents = (assignDoc.data()?.aiAgents || []).filter(
            (a: any) => a.aiAgentId !== input.agentId
          );
          await assignRef.update({ aiAgents: agents, updatedAt: new Date() });
        }
      }

      await ref.update({ status: 'disabled', updatedAt: new Date() });
      return { ok: true };
    }),

  // ── Queries ──────────────────────────────────────────────────────────

  get: publicProcedure.input(z.object({ agentId: z.string() })).query(async ({ input }) => {
    const doc = await aiAgentsCol().doc(input.agentId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  listByUniverse: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await aiAgentsCol()
        .where('universeId', '==', input.universeId)
        .where('status', 'in', ['active', 'paused'])
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  listByOwner: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await aiAgentsCol()
      .where('createdByUid', '==', ctx.user.uid)
      .where('status', 'in', ['active', 'paused'])
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── Credit Budget ────────────────────────────────────────────────────

  allocateBudget: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        amount: z.number().int().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const agentDoc = await aiAgentsCol().doc(input.agentId).get();
      if (!agentDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
      if (agentDoc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
      }

      const result = await allocateCreditsToAgent(ctx.user.uid, input.agentId, input.amount);

      // Update agent budget tracking
      const data = agentDoc.data()!;
      await aiAgentsCol()
        .doc(input.agentId)
        .update({
          creditBudgetTotal: (data.creditBudgetTotal || 0) + input.amount,
          updatedAt: new Date(),
        });

      return result;
    }),

  getUsage: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const agentDoc = await aiAgentsCol().doc(input.agentId).get();
      if (!agentDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
      if (agentDoc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
      }

      const stats = await getAgentCreditStats(input.agentId);
      const agentData = agentDoc.data()!;

      return {
        ...stats,
        creditBudgetPeriod: agentData.creditBudgetPeriod,
        totalRunCount: agentData.totalRunCount || 0,
        lastRunAt: agentData.lastRunAt,
        status: agentData.status,
      };
    }),

  // ── Universe Agent Assignments ───────────────────────────────────────

  getUniverseAssignments: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await universeAgentAssignmentsCol().doc(input.universeId.toLowerCase()).get();
      if (!doc.exists) {
        return { universeId: input.universeId, talentAgentUid: null, aiAgents: [] };
      }
      return { id: doc.id, ...doc.data() };
    }),

  assignTalentAgent: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        talentAgentUid: z.string(),
        contractId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isAdmin = await isUniverseAdmin(input.universeId, ctx.user.uid);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe creator can assign agents',
        });
      }

      const ref = universeAgentAssignmentsCol().doc(input.universeId.toLowerCase());
      const doc = await ref.get();

      if (doc.exists) {
        await ref.update({
          talentAgentUid: input.talentAgentUid,
          talentAgentContractId: input.contractId,
          updatedAt: new Date(),
        });
      } else {
        await ref.set({
          universeId: input.universeId.toLowerCase(),
          talentAgentUid: input.talentAgentUid,
          talentAgentContractId: input.contractId,
          aiAgents: [],
          updatedAt: new Date(),
        });
      }

      return { ok: true };
    }),
});
