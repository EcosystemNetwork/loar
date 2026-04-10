/**
 * Agent Authorization Service
 *
 * Validates that a talent agent has an active contract with a creator
 * and the required scope to act on their behalf.
 */
import { db } from '../lib/firebase';
import { TRPCError } from '@trpc/server';

export interface AgentContract {
  id: string;
  agentUid: string;
  creatorUid: string;
  status: 'PROPOSED' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  commissionBps: number;
  exclusivity: 'EXCLUSIVE' | 'NON_EXCLUSIVE';
  scope: string[];
  durationDays: number;
  startDate: Date | null;
  endDate: Date | null;
  proposedBy: 'agent' | 'creator';
  terms: string;
  termsURI: string | null;
  totalCommissionEarned: string;
  dealCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const agentContractsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('agentContracts');
};

/**
 * Validates that agentUid has an active contract with creatorUid
 * that includes the required scope. Returns the contract if valid.
 * Throws FORBIDDEN if not authorized.
 */
export async function validateAgentAuthorization(
  agentUid: string,
  creatorUid: string,
  requiredScope: string
): Promise<AgentContract> {
  const contractId = `${agentUid.toLowerCase()}-${creatorUid.toLowerCase()}`;
  const doc = await agentContractsCol().doc(contractId).get();

  if (!doc.exists) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No agent contract found with this creator',
    });
  }

  const contract = { id: doc.id, ...doc.data() } as AgentContract;

  if (contract.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Agent contract is ${contract.status}, not ACTIVE`,
    });
  }

  // Check expiration
  if (contract.endDate && new Date() > new Date(contract.endDate as any)) {
    // Auto-expire the contract
    await agentContractsCol().doc(contractId).update({
      status: 'EXPIRED',
      updatedAt: new Date(),
    });
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Agent contract has expired',
    });
  }

  // Check scope
  if (!contract.scope.includes(requiredScope)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Agent contract does not include scope: ${requiredScope}`,
    });
  }

  return contract;
}

/**
 * Records a commission earned by a talent agent from a deal.
 * Fire-and-forget — logs errors but doesn't throw.
 */
export async function recordAgentCommission(params: {
  agentContractId: string;
  agentUid: string;
  creatorUid: string;
  sourceType: 'license' | 'collab' | 'canon_license' | 'merch' | 'subscription';
  sourceId: string;
  grossAmountWei: string;
  commissionBps: number;
  txHash?: string;
}): Promise<void> {
  try {
    const commissionAmountWei =
      (BigInt(params.grossAmountWei) * BigInt(params.commissionBps)) / BigInt(10_000);

    await db.collection('agentCommissions').add({
      ...params,
      commissionAmountWei: commissionAmountWei.toString(),
      txHash: params.txHash || null,
      createdAt: new Date(),
    });

    // Update contract totals
    const contractRef = db.collection('agentContracts').doc(params.agentContractId);
    const contractDoc = await contractRef.get();
    if (contractDoc.exists) {
      const data = contractDoc.data()!;
      await contractRef.update({
        totalCommissionEarned: (
          BigInt(data.totalCommissionEarned || '0') + commissionAmountWei
        ).toString(),
        dealCount: (data.dealCount || 0) + 1,
        updatedAt: new Date(),
      });
    }

    // Update agent profile totals
    const agentRef = db.collection('talentAgentProfiles').doc(params.agentUid);
    const agentDoc = await agentRef.get();
    if (agentDoc.exists) {
      const data = agentDoc.data()!;
      await agentRef.update({
        totalDeals: (data.totalDeals || 0) + 1,
        totalRevenueGenerated: (
          BigInt(data.totalRevenueGenerated || '0') + BigInt(params.grossAmountWei)
        ).toString(),
        updatedAt: new Date(),
      });
    }
  } catch (err) {
    console.error('Failed to record agent commission:', err);
  }
}

/**
 * Resolves the effective acting UID — either the caller or the onBehalfOf target.
 * If onBehalfOfUid is provided, validates the agent contract.
 * Returns { actingUid, agentContract? }
 */
export async function resolveActingUid(
  callerUid: string,
  onBehalfOfUid: string | undefined,
  requiredScope: string
): Promise<{ actingUid: string; agentContract?: AgentContract }> {
  if (!onBehalfOfUid) {
    return { actingUid: callerUid };
  }

  const contract = await validateAgentAuthorization(callerUid, onBehalfOfUid, requiredScope);
  return { actingUid: onBehalfOfUid, agentContract: contract };
}
