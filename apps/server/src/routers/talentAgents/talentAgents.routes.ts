/**
 * Talent Agents Router — Human agents who discover, represent, and broker deals for creators
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  talentAgentProfileSchema,
  proposeContractSchema,
  CONTRACT_SCOPES,
} from './talentAgents.types';
import { emitActivity, sendNotification } from '../../services/activity';
import {
  registerAgreementOnChain,
  deactivateAgreementOnChain,
} from '../../services/talentAgentRegistry';

const agentProfilesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('talentAgentProfiles');
};
const agentContractsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('agentContracts');
};
const agentCommissionsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('agentCommissions');
};

export const talentAgentsRouter = router({
  // ── Profile Management ───────────────────────────────────────────────

  register: protectedProcedure.input(talentAgentProfileSchema).mutation(async ({ input, ctx }) => {
    const uid = ctx.user.uid;
    const existing = await agentProfilesCol().doc(uid).get();
    if (existing.exists) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Already registered as a talent agent' });
    }

    const profile = {
      ...input,
      uid,
      verified: false,
      rating: null,
      totalDeals: 0,
      totalRevenueGenerated: '0',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await agentProfilesCol().doc(uid).set(profile);

    emitActivity({
      actorUid: uid,
      eventType: 'agent_contract_proposed' as any, // Will be added to activity types
      targetType: 'talentAgent',
      targetId: uid,
      metadata: { action: 'registered' },
    }).catch(() => {});

    return profile;
  }),

  updateProfile: protectedProcedure
    .input(talentAgentProfileSchema.partial())
    .mutation(async ({ input, ctx }) => {
      const ref = agentProfilesCol().doc(ctx.user.uid);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Not registered as a talent agent' });
      }

      await ref.update({ ...input, updatedAt: new Date() });
      return { ok: true };
    }),

  getProfile: publicProcedure.input(z.object({ uid: z.string() })).query(async ({ input }) => {
    const doc = await agentProfilesCol().doc(input.uid).get();
    if (!doc.exists) return null;
    const data = doc.data()!;

    // Respect visibility
    if (data.visibility === 'private') {
      return {
        uid: data.uid,
        displayName: data.displayName,
        agencyName: data.agencyName,
        avatarUrl: data.avatarUrl || null,
        visibility: 'private',
      };
    }

    return { id: doc.id, ...data };
  }),

  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const doc = await agentProfilesCol().doc(ctx.user.uid).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  discover: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        specialties: z.array(z.string()).optional(),
        verifiedOnly: z.boolean().default(false),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = agentProfilesCol()
        .where('visibility', '==', 'public')
        .orderBy('createdAt', 'desc');

      if (input.verifiedOnly) {
        query = query.where('verified', '==', true);
      }

      if (input.cursor) {
        const cursorDoc = await agentProfilesCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.limit(input.limit + 1).get();
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      let results = docs;

      // Client-side filtering for specialties and search
      if (input.specialties?.length) {
        results = results.filter((r: any) =>
          input.specialties!.some((s) => r.specialties?.includes(s))
        );
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        results = results.filter(
          (r: any) =>
            r.displayName?.toLowerCase().includes(q) ||
            r.agencyName?.toLowerCase().includes(q) ||
            r.bio?.toLowerCase().includes(q)
        );
      }

      const hasMore = results.length > input.limit;
      if (hasMore) results = results.slice(0, input.limit);

      return {
        agents: results,
        nextCursor: hasMore ? results[results.length - 1]?.id : null,
      };
    }),

  // ── Contract Management ──────────────────────────────────────────────

  proposeContract: protectedProcedure
    .input(proposeContractSchema)
    .mutation(async ({ input, ctx }) => {
      const callerUid = ctx.user.uid;
      const targetUid = input.targetUid;

      // Determine who is the agent and who is the creator
      const callerIsAgent = await agentProfilesCol().doc(callerUid).get();
      const targetIsAgent = await agentProfilesCol().doc(targetUid).get();

      let agentUid: string;
      let creatorUid: string;
      let proposedBy: 'agent' | 'creator';

      if (callerIsAgent.exists) {
        agentUid = callerUid;
        creatorUid = targetUid;
        proposedBy = 'agent';
      } else if (targetIsAgent.exists) {
        agentUid = targetUid;
        creatorUid = callerUid;
        proposedBy = 'creator';
      } else {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one party must be a registered talent agent',
        });
      }

      // Check for existing active/proposed contract
      const contractId = `${agentUid.toLowerCase()}-${creatorUid.toLowerCase()}`;
      const existingDoc = await agentContractsCol().doc(contractId).get();
      if (existingDoc.exists) {
        const status = existingDoc.data()?.status;
        if (status === 'ACTIVE' || status === 'PROPOSED') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A contract already exists with status: ${status}`,
          });
        }
      }

      // Check exclusivity conflicts
      if (input.exclusivity === 'EXCLUSIVE') {
        const existingContracts = await agentContractsCol()
          .where('creatorUid', '==', creatorUid.toLowerCase())
          .where('status', '==', 'ACTIVE')
          .get();

        for (const doc of existingContracts.docs) {
          const data = doc.data();
          const overlappingScopes = input.scope.filter((s) => data.scope?.includes(s));
          if (overlappingScopes.length > 0 && data.exclusivity === 'EXCLUSIVE') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Creator has an exclusive agent for scopes: ${overlappingScopes.join(', ')}`,
            });
          }
        }
      }

      const contract = {
        agentUid: agentUid.toLowerCase(),
        creatorUid: creatorUid.toLowerCase(),
        status: 'PROPOSED' as const,
        commissionBps: input.commissionBps,
        exclusivity: input.exclusivity,
        scope: input.scope,
        durationDays: input.durationDays,
        startDate: null,
        endDate: null,
        proposedBy,
        terms: input.terms,
        termsURI: input.termsURI || null,
        totalCommissionEarned: '0',
        dealCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await agentContractsCol().doc(contractId).set(contract);

      // Notify the other party
      sendNotification({
        recipientUid: targetUid,
        type: 'agent_contract_proposal' as any,
        actorUid: callerUid,
        message: `You have a new talent agent contract proposal`,
        targetType: 'agentContract',
        targetId: contractId,
      }).catch(() => {});

      return { id: contractId, ...contract };
    }),

  acceptContract: protectedProcedure
    .input(z.object({ contractId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = agentContractsCol().doc(input.contractId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contract not found' });

      const data = doc.data()!;
      if (data.status !== 'PROPOSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Contract is ${data.status}, not PROPOSED`,
        });
      }

      // Only the non-proposing party can accept
      const callerUid = ctx.user.uid.toLowerCase();
      const isAgent = data.agentUid === callerUid;
      const isCreator = data.creatorUid === callerUid;

      if (!isAgent && !isCreator) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a party to this contract' });
      }

      if (
        (data.proposedBy === 'agent' && isAgent) ||
        (data.proposedBy === 'creator' && isCreator)
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot accept your own proposal' });
      }

      const now = new Date();
      const endDate = new Date(now.getTime() + data.durationDays * 24 * 60 * 60 * 1000);

      await ref.update({
        status: 'ACTIVE',
        startDate: now,
        endDate,
        updatedAt: now,
      });

      // G4: register the agreement on-chain. Best-effort — if the registry
      // env var isn't set yet, or the platform Circle wallet isn't
      // provisioned, the Firestore record remains the source of truth and
      // commission routing falls back to off-chain ledger only.
      let onChainAgreementId: string | null = null;
      let registerTxHash: string | null = null;
      try {
        const reg = await registerAgreementOnChain({
          agentUid: data.agentUid,
          creatorUid: data.creatorUid,
          commissionBps: data.commissionBps,
        });
        if (reg) {
          onChainAgreementId = reg.agreementId;
          registerTxHash = reg.txHash;
          await ref.update({
            onChainAgreementId,
            onChainRegisterTxHash: registerTxHash,
          });
        }
      } catch (err) {
        console.error('[talentAgents.acceptContract] on-chain register failed:', err);
      }

      // Notify proposer
      const notifyUid = data.proposedBy === 'agent' ? data.agentUid : data.creatorUid;
      sendNotification({
        recipientUid: notifyUid,
        type: 'agent_contract_proposal' as any,
        actorUid: callerUid,
        message: 'Your talent agent contract has been accepted',
        targetType: 'agentContract',
        targetId: input.contractId,
      }).catch(() => {});

      return { ok: true, startDate: now, endDate, onChainAgreementId, registerTxHash };
    }),

  terminateContract: protectedProcedure
    .input(z.object({ contractId: z.string(), reason: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const ref = agentContractsCol().doc(input.contractId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contract not found' });

      const data = doc.data()!;
      const callerUid = ctx.user.uid.toLowerCase();

      if (data.agentUid !== callerUid && data.creatorUid !== callerUid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a party to this contract' });
      }

      if (data.status !== 'ACTIVE' && data.status !== 'PROPOSED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Contract cannot be terminated' });
      }

      await ref.update({
        status: 'TERMINATED',
        terminatedBy: callerUid,
        terminationReason: input.reason || null,
        updatedAt: new Date(),
      });

      // G4: deactivate on-chain if the agreement was previously registered.
      let deactivateTxHash: string | null = null;
      if (data.onChainAgreementId) {
        try {
          const res = await deactivateAgreementOnChain(data.agentUid, data.creatorUid);
          if (res) {
            deactivateTxHash = res.txHash;
            await ref.update({ onChainDeactivateTxHash: deactivateTxHash });
          }
        } catch (err) {
          console.error('[talentAgents.terminateContract] on-chain deactivate failed:', err);
        }
      }

      return { ok: true, deactivateTxHash };
    }),

  getContract: publicProcedure
    .input(z.object({ contractId: z.string() }))
    .query(async ({ input }) => {
      const doc = await agentContractsCol().doc(input.contractId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }),

  myContracts: protectedProcedure
    .input(
      z.object({
        status: z.enum(['PROPOSED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'ALL']).default('ALL'),
      })
    )
    .query(async ({ input, ctx }) => {
      const uid = ctx.user.uid.toLowerCase();

      const [asAgent, asCreator] = await Promise.all([
        agentContractsCol().where('agentUid', '==', uid).get(),
        agentContractsCol().where('creatorUid', '==', uid).get(),
      ]);

      let all = [...asAgent.docs, ...asCreator.docs].map((d) => ({
        id: d.id,
        ...d.data(),
        role: asAgent.docs.some((ad) => ad.id === d.id) ? 'agent' : 'creator',
      }));

      if (input.status !== 'ALL') {
        all = all.filter((c: any) => c.status === input.status);
      }

      return all;
    }),

  getClients: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.user.uid.toLowerCase();

    const snapshot = await agentContractsCol()
      .where('agentUid', '==', uid)
      .where('status', '==', 'ACTIVE')
      .get();

    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── Commission Tracking ──────────────────────────────────────────────

  getCommissions: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const uid = ctx.user.uid.toLowerCase();

      let query: FirebaseFirestore.Query = agentCommissionsCol()
        .where('agentUid', '==', uid)
        .orderBy('createdAt', 'desc');

      if (input.cursor) {
        const cursorDoc = await agentCommissionsCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.limit(input.limit + 1).get();
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      const hasMore = docs.length > input.limit;
      const results = hasMore ? docs.slice(0, input.limit) : docs;

      return {
        commissions: results,
        nextCursor: hasMore ? results[results.length - 1]?.id : null,
      };
    }),

  getCommissionStats: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.user.uid.toLowerCase();

    const snapshot = await agentCommissionsCol().where('agentUid', '==', uid).get();

    let totalEarned = BigInt(0);
    const bySource: Record<string, { count: number; total: string }> = {};

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const amount = BigInt(data.commissionAmountWei || '0');
      totalEarned += amount;

      const source = data.sourceType || 'unknown';
      if (!bySource[source]) bySource[source] = { count: 0, total: '0' };
      bySource[source].count++;
      bySource[source].total = (BigInt(bySource[source].total) + amount).toString();
    }

    return {
      totalCommissions: snapshot.size,
      totalEarnedWei: totalEarned.toString(),
      bySource,
    };
  }),
});
